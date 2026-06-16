#!/usr/bin/env node
'use strict';
/**
 * hdld-tool/server.js — Server sinh HĐLĐ (standalone, port 3502, đổi qua env PORT).
 *
 * Endpoints:
 *   GET  /                       health check
 *   POST /generate  {record_id}  → sinh tài liệu cho 1 record bảng 24, ghi link về File Docs
 *                    (cũng nhận ?record_id= trên query / form field cho tiện gọi từ Base Automation)
 *
 * Deploy: PORT=3502 node server.js → Cloudflare tunnel hdld.kntmcptools.online → 127.0.0.1:3502
 * Run:    launchd (xem install-launchd.sh) — KeepAlive, tự bật lại như hr/dxc/track.
 *
 * KHÔNG secret trong code: Lark qua lark-cli profile (env LARK_PROFILE),
 * Google qua service account (env GOOGLE_SA_KEY).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { generate } = require('./generate');

const PORT = process.env.PORT || 3502;
const LOG_FILE = path.join(__dirname, 'server.log');
// Token bảo vệ endpoint public (Lark Base Automation gửi kèm). Để trống = không yêu cầu (nội bộ).
const HDLD_TOKEN = process.env.HDLD_TOKEN || '';

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
  process.stdout.write(line);
}

function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => (b += c));
    req.on('end', () => {
      if (!b) return resolve({});
      try { return resolve(JSON.parse(b)); } catch {}
      // fallback: x-www-form-urlencoded
      const o = {};
      b.split('&').forEach(kv => {
        const [k, v] = kv.split('=');
        if (k) o[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '));
      });
      resolve(o);
    });
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/') {
    return sendJson(res, 200, { ok: true, service: 'hdld-tool', port: Number(PORT) });
  }

  if (req.method === 'POST' && url.pathname === '/generate') {
    const body = await readBody(req);
    // Token: chấp nhận qua body.token, query ?token=, hoặc header Authorization: Bearer
    const tok = body.token || url.searchParams.get('token') || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (HDLD_TOKEN && tok !== HDLD_TOKEN) {
      log(`[gen] 401 sai token`);
      return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    }
    log(`/generate nhận: record_id=${JSON.stringify(body.record_id || body.recordId || '')} stt=${JSON.stringify(body.stt || '')} force=${body.force === true || body.force === '1'}`);
    let recordId = body.record_id || body.recordId || url.searchParams.get('record_id');
    const force = body.force === true || body.force === '1' || url.searchParams.get('force') === '1';
    // Fallback: Base Automation chỉ gửi được 1F_STT thì resolve ra record_id
    const sttIn = body.stt || url.searchParams.get('stt');
    if (!recordId && sttIn) {
      try { recordId = require('./lib').findRecordIdByStt(sttIn); } catch {}
      log(`/generate stt=${JSON.stringify(sttIn)} → record_id=${JSON.stringify(recordId)}`);
    }
    if (!recordId) return sendJson(res, 400, { ok: false, error: 'thiếu record_id (hoặc stt)' });
    // Trigger "record created": field formula/lookup chưa settle → đợi tối đa ~20s rồi đọc lại.
    // force (nút tạo lại) thì khỏi đợi. Có thể override qua body.settle_wait_ms.
    const settleWaitMs = force ? 0 : (Number(body.settle_wait_ms) || 20000);
    try {
      const r = await generate(recordId, { log, force, settleWaitMs });
      if (r.skipped) log(`[gen] ${recordId} skipped=${r.skipped}`);
      if (r.unresolved && r.unresolved.length) log(`[gen] ${recordId} unresolved: ${r.unresolved.map(u => u.bId).join(',')}`);
      (r.warnings || []).forEach(w => log(`[gen] ${recordId} WARN ${w}`));
      return sendJson(res, 200, r);
    } catch (e) {
      log(`[gen] ✗ ${recordId} ${e.message}`);
      return sendJson(res, 500, { ok: false, record_id: recordId, error: e.message });
    }
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => log(`hdld-tool listening on 127.0.0.1:${PORT}`));
