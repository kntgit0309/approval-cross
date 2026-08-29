#!/usr/bin/env node
'use strict';
/**
 * notify-server.js — Auto-trigger noti cross-tenant (Phase 2, plan §7 bước 2B)
 *
 * Nhận event approval_instance forward từ approval-push:3100 → DM card tới
 * NGƯỜI ĐỀ XUẤT trong ĐÚNG org của họ (custom app per-org, phase2-fanout).
 *
 *   Lark → approval-push:3100 ─forward─► :3600/event
 *     → /track/data (:3400, người đề xuất thật + field)
 *     → email-org.json (tên → email + org)
 *     → getTenantToken(org) → resolveOpenId(email) → buildStatusCard → DM
 *
 * DRY-RUN mặc định: NOTI_DRY != '0' → chỉ log "[DRY] would send…", KHÔNG gửi.
 * Bật gửi thật: NOTI_DRY=0 node notify-server.js  (hoặc sửa plist launchd).
 *
 * Endpoints:
 *   POST /event                 — event Lark (forward từ :3100), xử lý async
 *   POST /test {instance, sys}  — chạy pipeline cho 1 đơn có sẵn (tôn trọng NOTI_DRY)
 *   GET  /health                — {ok, dry, orgs}
 */
process.env.PROVIDER_MODE = 'custom';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createClient } = require('./src/lark-client');
const { createTokenManager } = require('./src/token-manager');
const { createOpenIdResolver } = require('./src/resolve-open-id');
const { createMessageSender } = require('./src/send-message');
const { buildStatusCard } = require('./src/build-card');
const idempotency = require('./src/idempotency');

const PORT = 3600;
const DRY = process.env.NOTI_DRY !== '0';
const TRACK = 'http://127.0.0.1:3400';
const LOG_FILE = path.join(__dirname, 'notify.log');
const CONF_DIR = path.join(__dirname, 'config');

const SYS_BY_CODE = {
  'DAD13F4B-3D66-4597-8263-1031A80D7FEF': 'dxc',
  'E6D2C2C3-32D5-4D7A-9C88-731AABB92D9E': 'hr',
};
const STATUS_MAP = { approved: 'APPROVED', rejected: 'REJECTED', in_progress: 'PENDING', pending: 'PENDING', canceled: 'CANCELED', deleted: 'DELETED', reverted: 'REVERTED', terminated: 'TERMINATED' };

function log(...a) {
  const line = new Date().toISOString() + ' ' + a.join(' ');
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
}

/* ── email-org lookup (đọc tươi mỗi event, khớp tên chịu lỗi dấu/đảo initials) ── */
const strip = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
function nameKeys(name) {
  const base = strip(String(name || '').split('.')[0]).replace(/[^a-z\s]/g, ' ').trim();
  const toks = base.split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const keys = new Set();
  const variants = [
    { given: toks[0], rest: toks.slice(1) },                 // "Khoa NHT" (tên trước)
    { given: toks[toks.length - 1], rest: toks.slice(0, -1) }, // "Nguyễn Hồ Trọng Khoa" (tên sau)
  ];
  for (const v of variants) {
    if (!v.rest.length) { keys.add(v.given + '|'); continue; }
    const cluster = v.rest.join('').split('').sort().join('');       // "nht" nguyên cụm
    const initials = v.rest.map(t => t[0]).sort().join('');          // chữ cái đầu mỗi từ
    keys.add(v.given + '|' + cluster);
    keys.add(v.given + '|' + initials);
  }
  return [...keys];
}
function loadDirectory() {
  const eo = JSON.parse(fs.readFileSync(path.join(CONF_DIR, 'email-org.json'), 'utf8'));
  const map = new Map(); // nameKey → {email, org, uname}
  for (const [uname, info] of Object.entries(eo.byUsername || {})) {
    for (const k of nameKeys(uname)) if (!map.has(k)) map.set(k, { ...info, uname });
  }
  return { map, byEmail: eo.byEmail || {} };
}
function findUser(name) {
  const { map } = loadDirectory();
  for (const k of nameKeys(name)) { const hit = map.get(k); if (hit) return hit; }
  return null;
}

const APPID_BY_ORG = (() => {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(CONF_DIR, 'credentials.json'), 'utf8'));
    const out = {};
    for (const [tenant, v] of Object.entries(c.byTenant || {})) out['org' + tenant.replace(/\D/g, '')] = v.app_id;
    return out;
  } catch (e) { return {}; }
})();

function getJson(p) {
  return new Promise((res, rej) => {
    http.get(TRACK + p, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); })
      .on('error', rej);
  });
}

const client = createClient();
const tokenMgr = createTokenManager(client, 'custom');
const resolver = createOpenIdResolver(client);
const sender = createMessageSender(client);
const drySeen = new Set(); // chống spam log khi Lark retry event (dry mode)

async function notifyInstance(instCode, sys, evStatus, source) {
  // 1. data thật từ tracking-ui (retry — instance có thể chưa settle)
  let d = null;
  for (let i = 0; i < 4; i++) {
    try { d = await getJson('/track/data?instance=' + encodeURIComponent(instCode) + (sys ? '&sys=' + sys : '')); if (d && !d.error) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 4000));
  }
  if (!d || d.error) { log('SKIP ' + instCode + ' — /track/data không trả về (' + ((d && d.error) || 'timeout') + ')'); return { ok: false, skipped: 'no-track-data' }; }

  const status = STATUS_MAP[(d.status || evStatus || '').toLowerCase()] || (evStatus || 'PENDING').toUpperCase();
  const requester = (d.submitter && d.submitter.name) || '';
  if (!requester || requester === '—') { log('SKIP ' + instCode + ' — không có tên người đề xuất'); return { ok: false, skipped: 'no-requester' }; }

  // 2. tên → email + org
  const user = findUser(requester);
  if (!user) { log('SKIP ' + instCode + ' — "' + requester + '" chưa có trong email-org.json'); return { ok: false, skipped: 'unmapped', requester }; }

  const dedupeKey = instCode + '|' + status + '|' + user.email;
  if (DRY) {
    if (drySeen.has(dedupeKey)) return { ok: true, skipped: 'dry-duplicate' };
  } else if (idempotency.seen(instCode, status + '|' + user.email)) {
    log('SKIP ' + instCode + ' ' + status + ' — đã gửi rồi (idempotent)');
    return { ok: true, skipped: 'duplicate' };
  }

  // 3. card
  const meta = {}; (d.meta || []).forEach(m => { meta[m.label] = m.value; });
  const loai = (d.tags && d.tags[0] && d.tags[0].label) || '';
  const title = (d.title || '').replace(/^.*?—\s*/, '') || instCode.slice(0, 8);
  const fields = [
    { label: 'Loại đơn', value: loai },
    { label: 'Người đề xuất', value: requester },
    { label: 'Phòng ban', value: (d.submitter && d.submitter.dept) || '' },
    { label: 'Số tiền', value: meta['Số tiền'] },
    { label: 'Hạn thanh toán', value: meta['Hạn thanh toán'] },
    { label: 'Thời gian nghỉ', value: meta['Thời gian nghỉ'] },
  ].filter(f => f.value);
  const appId = APPID_BY_ORG[user.org];
  const detailUrl = appId
    ? 'https://applink.larksuite.com/client/web_app/open?appId=' + appId + '&path=track/v/' + (sys || d.system) + '/' + instCode
    : 'https://atrack.kntmcptools.online/track?instance=' + instCode + (sys ? '&sys=' + sys : '');
  const card = buildStatusCard(status, { type: sys === 'hr' ? 'Đơn HR' : 'Đề Xuất Chi', title, fields, detailUrl });

  // 4. gửi (hoặc dry log)
  if (DRY) {
    drySeen.add(dedupeKey);
    log('[DRY] would send ' + status + ' "' + title + '" → ' + user.email + ' @' + user.org + ' (khớp "' + requester + '"→"' + user.uname + '", src=' + source + ')');
    return { ok: true, dry: true, status, title, email: user.email, org: user.org };
  }
  const tenant = 'TENANT_ORG' + user.org.replace(/\D/g, '');
  const token = await tokenMgr.getTenantToken(tenant);
  const openId = await resolver.resolveOpenId({ tenantKey: tenant, businessId: user.email, token });
  const mid = await sender.sendCard({ token, openId, card });
  idempotency.mark(instCode, status + '|' + user.email, { mid });
  log('SENT ' + status + ' "' + title + '" → ' + user.email + ' @' + user.org + ' mid=' + mid);
  return { ok: true, sent: true, mid, status, email: user.email, org: user.org };
}

function readBody(req) {
  return new Promise((res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch (e) { res({}); } }); });
}
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }

http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return send(res, 200, { ok: true, dry: DRY, orgs: Object.keys(APPID_BY_ORG).sort() });
    }
    if (req.method === 'POST' && req.url === '/event') {
      const body = await readBody(req);
      if (body && body.type === 'url_verification' && body.challenge) return send(res, 200, { challenge: body.challenge });
      const header = body && body.header;
      const ev = body && body.event;
      if (!ev) return send(res, 200, { code: 0 });
      const eventType = (header && header.event_type) || ev.type;
      const instCode = ev.instance_code;
      const status = ev.status;
      const sys = SYS_BY_CODE[ev.approval_code];
      if (eventType === 'approval_instance' && instCode && sys) {
        log('event ' + sys + ' inst=' + instCode + ' status=' + status + (DRY ? ' [DRY mode]' : ''));
        notifyInstance(instCode, sys, status, 'event').catch(e => log('ERR ' + instCode + ': ' + e.message));
      }
      return send(res, 200, { code: 0 });
    }
    if (req.method === 'POST' && req.url === '/test') {
      const body = await readBody(req);
      if (!body.instance) return send(res, 400, { error: 'missing instance' });
      const r = await notifyInstance(body.instance, body.sys, body.status, 'test');
      return send(res, 200, r);
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { log('ERROR ' + e.message); send(res, 500, { error: e.message }); }
}).listen(PORT, '127.0.0.1', () => log('phase2 notify-server :' + PORT + ' | DRY=' + DRY + ' | orgs=' + Object.keys(APPID_BY_ORG).sort().join(',')));
