#!/usr/bin/env node
/**
 * tracking-ui/server.js — Approval Tracking server (standalone, port 3400, đổi qua env PORT)
 *
 * Cung cấp UI theo dõi phê duyệt nhiều cấp cho NHÂN VIÊN (người đề xuất),
 * dùng chung cho cả HR (form E6D2C2C3) và DXC (form DAD13F4B).
 *
 * Endpoints:
 *   GET  /                      health check
 *   GET  /track?instance=CODE&sys=hr|dxc   → trả H5 page (public/track.html)
 *   GET  /track/data?instance=CODE&sys=…   → canonical JSON (H5 fetch cái này)
 *   GET  /track/card?instance=CODE&sys=…   → preview card JSON (debug)
 *   POST /send   body {instance, to, sys}  → build card + DM nhân viên, lưu map để patch
 *   POST /event  Lark approval_instance event → re-fetch + PATCH card đã gửi (auto-update)
 *
 * Deploy: PORT=3400 node tracking-ui/server.js  → Cloudflare tunnel atrack.kntmcptools.online → 127.0.0.1:3400
 * Run:    pm2 start tracking-ui/server.js --name track   (hoặc launchd như 2 server kia)
 *
 * LƯU Ý: PORT (local) độc lập với TRACK_BASE_URL (hostname public qua tunnel).
 *   - Port 3400 chọn vì TRỐNG trên mini (3100 hr, 3200 dxc, 3300 support, 3401 home, 18790 goclaw đều BẬN).
 *   - track.* đã bị SPA khác chiếm → dùng hostname riêng atrack.kntmcptools.online, thêm ingress
 *     `atrack.* → http://127.0.0.1:3400` vào ~/.cloudflared/config.yml + route DNS cho tunnel mini.
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const sso = require('./sso');

const PORT = process.env.PORT || 3400;
const PUBLIC_DIR = path.join(__dirname, 'public');
const LOG_FILE = path.join(__dirname, 'server.log');
// Base URL công khai để gắn vào nút "Xem chi tiết" trong card (đổi qua env cho khớp tunnel của bạn)
const TRACK_BASE_URL = process.env.TRACK_BASE_URL || 'https://atrack.kntmcptools.online';
// Custom-bot webhook Lark để /track/push tự bắn card (set qua env khi chạy server)
const TRACK_WEBHOOK = process.env.TRACK_WEBHOOK || '';

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
  process.stdout.write(line);
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => { if (!b) return resolve({}); try { resolve(JSON.parse(b)); } catch { resolve({ _raw: b }); } });
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj, null, 2));
}

function trackUrlFor(code, sys) {
  return `${TRACK_BASE_URL}/track?instance=${encodeURIComponent(code)}${sys ? '&sys=' + encodeURIComponent(sys) : ''}`;
}

// POST card JSON vào custom-bot webhook Lark ({msg_type, card})
function postWebhook(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const u = new URL(webhookUrl);
    const r = https.request({
      host: u.host, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) },
    }, (resp) => { let b = ''; resp.on('data', c => b += c); resp.on('end', () => resolve(b)); });
    r.on('error', reject); r.write(data); r.end();
  });
}

// Lấy canonical JSON: chỉ DEMO khi instance='DEMO'; rỗng → lỗi (KHÔNG fallback DEMO)
function getCanonical(instanceCode, sys) {
  if (instanceCode === 'DEMO') return lib.DEMO;
  if (!instanceCode) throw new Error('thiếu mã đơn (instance)');
  const inst = lib.fetchInstance(instanceCode);
  return lib.normalize(inst, sys || lib.SYS_BY_CODE[inst.approval_code]);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  log(`${req.method} ${req.url}`);

  try {
    // ── Health (JSON) ──
    if (req.method === 'GET' && (p === '/health' || p === '/healthz')) {
      return sendJson(res, 200, { ok: true, name: 'approval-tracking', port: PORT });
    }

    // ── Trang chủ web app: danh sách đơn của user ──
    if (req.method === 'GET' && p === '/') {
      try {
        const html = fs.readFileSync(path.join(PUBLIC_DIR, 'home.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(html);
      } catch {
        return sendJson(res, 200, { ok: true, name: 'approval-tracking', note: 'home.html chưa có' });
      }
    }

    // ── H5 page ──
    if (req.method === 'GET' && (p === '/track' || p === '/track/')) {
      const file = path.join(PUBLIC_DIR, 'track.html');
      const html = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(html);
    }

    // ── Canonical JSON cho H5 ──
    if (req.method === 'GET' && p === '/track/data') {
      const code = (u.searchParams.get('instance') || u.searchParams.get('id') || '').trim();
      const sys = u.searchParams.get('sys') || '';
      if (!code) return sendJson(res, 200, { error: 'Không truy cập được — thiếu mã đơn (instance).' });
      try {
        return sendJson(res, 200, getCanonical(code, sys));
      } catch (e) {
        log(`data err ${code}: ${e.message}`);
        return sendJson(res, 200, { error: `Không truy cập được — không đọc được đề xuất (${code}). Mã sai hoặc đơn đã xoá.` });
      }
    }

    // ── List đơn của user (cho trang chủ web app) ──
    if (req.method === 'GET' && p === '/track/list') {
      const email = (u.searchParams.get('email') || u.searchParams.get('u') || '').trim();
      try {
        return sendJson(res, 200, lib.listApprovals(email || null));
      } catch (e) {
        log(`list err: ${e.message}`);
        return sendJson(res, 200, { error: e.message, items: [] });
      }
    }

    // ── Debug beacon từ client SSO (để soi log) ──
    if (req.method === 'GET' && p === '/track/ssolog') {
      log(`SSOLOG ${(u.searchParams.get('m') || '').slice(0, 220)}`);
      return sendJson(res, 200, { ok: true });
    }

    // ── SSO 免登: app_id cho page + đổi authCode → email viewer ──
    if (req.method === 'GET' && p === '/track/auth/start') {
      return sendJson(res, 200, { configured: sso.configured, appId: sso.appId || null });
    }
    if (req.method === 'GET' && p === '/track/auth') {
      const code = (u.searchParams.get('code') || '').trim();
      if (!code) return sendJson(res, 400, { error: 'missing code' });
      try {
        const v = await sso.resolveViewer(code);
        log(`sso auth → ${v.email || '(no email)'} src=${v.source}`);
        return sendJson(res, 200, v);
      } catch (e) {
        log(`sso err: ${e.message}`);
        return sendJson(res, 200, { error: e.message, email: null });
      }
    }

    // ── Preview card JSON (debug) ──
    if (req.method === 'GET' && p === '/track/card') {
      const code = u.searchParams.get('instance') || u.searchParams.get('id');
      const sys = u.searchParams.get('sys') || '';
      const data = getCanonical(code, sys);
      return sendJson(res, 200, lib.buildCard(data, trackUrlFor(code || 'DEMO', data.system)));
    }

    // ── Gửi card P2P cho user (mặc định: requester của đơn) bằng bot BOT_PROFILE ──
    if (req.method === 'POST' && p === '/send') {
      const body = await readBody(req);
      const code = body.instance || body.instance_code;
      if (!code) return sendJson(res, 400, { error: 'missing instance' });
      const to = body.to || body.receive_id || lib.resolveRequester(code);
      if (!to) return sendJson(res, 400, { error: 'không xác định được người nhận (truyền "to" hoặc đảm bảo bảng 57 có Requester open_id)' });
      const data = getCanonical(code, body.sys);
      const card = lib.buildCard(data, trackUrlFor(code, data.system));
      try {
        const messageId = lib.sendCard(to, card);
        lib.putSent(code, { message_id: messageId, receive_id: to, sys: data.system });
        log(`sent ${code} → ${to} msg=${messageId}`);
        return sendJson(res, 200, { ok: true, instance: code, to, message_id: messageId });
      } catch (e) {
        log(`send err ${code} → ${to}: ${e.message}`);
        return sendJson(res, 500, { error: e.message, instance: code, to });
      }
    }

    // ── Auto-push card vào webhook (cho Lark Base Automation gọi) ──
    // body: { instance } (+ optional webhook, sys, force). Chống gửi trùng multi-K bằng store.
    if (req.method === 'POST' && p === '/track/push') {
      const body = await readBody(req);
      const code = body.instance || body.instance_code;
      const webhook = body.webhook || TRACK_WEBHOOK;
      if (!code) return sendJson(res, 400, { error: 'missing instance' });
      if (!webhook) return sendJson(res, 400, { error: 'missing webhook (body.webhook hoặc env TRACK_WEBHOOK)' });
      const prev = lib.getSent(code);
      if (prev && prev.pushed && !body.force) {
        log(`push skip (đã gửi) ${code}`);
        return sendJson(res, 200, { ok: true, skipped: 'already_pushed', instance: code });
      }
      const data = getCanonical(code, body.sys);
      const card = lib.buildCard(data, trackUrlFor(code, data.system));
      const resp = await postWebhook(webhook, { msg_type: 'interactive', card });
      lib.putSent(code, { pushed: true, sys: data.system });
      log(`pushed ${code} (${data.status}) → webhook`);
      return sendJson(res, 200, { ok: true, instance: code, status: data.status, webhook_resp: resp });
    }

    // ── Lark event → auto-patch card đã gửi ──
    if (req.method === 'POST' && p === '/event') {
      const body = await readBody(req);
      if (body && body.type === 'url_verification' && body.challenge) {
        log('URL verification ok'); return sendJson(res, 200, { challenge: body.challenge });
      }
      const header = body && body.header;
      const ev = body && body.event;
      const eventType = (header && header.event_type) || (ev && ev.type);
      const instCode = ev && ev.instance_code;
      const status = ev && ev.status;
      log(`event ${eventType || '(no-type)'} inst=${instCode} status=${status}`);
      if (eventType === 'approval_instance' && instCode) {
        const sent = lib.getSent(instCode);
        if (sent && sent.message_id) {
          // re-fetch + patch (fire-and-forget, có retry nhẹ vì event có thể tới trước khi instance settle)
          (async () => {
            for (let i = 0; i < 3; i++) {
              try {
                const data = lib.normalize(lib.fetchInstance(instCode), sent.sys);
                const card = lib.buildCard(data, trackUrlFor(instCode, data.system));
                lib.patchCard(sent.message_id, card);
                log(`patched ${instCode} → ${data.status}`);
                return;
              } catch (e) { log(`patch try ${i} err ${instCode}: ${e.message}`); await new Promise(r => setTimeout(r, 2500)); }
            }
          })();
        } else {
          log(`no sent card for ${instCode}, skip patch`);
        }
      }
      return sendJson(res, 200, { code: 0 });
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    log(`ERROR ${e.message}`);
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => log(`approval-tracking server listening on 127.0.0.1:${PORT}`));
