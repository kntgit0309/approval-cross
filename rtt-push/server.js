#!/usr/bin/env node
/**
 * rtt-push server — Duyệt thủ tục hành chính (bảng 28.1 → approval 9C770ED9, tenant KAI)
 * Port 3503 (localhost, chưa cần tunnel).
 *
 * Routes:
 *   GET  /health — healthcheck
 *   POST /push   — { record_id } từ Base Automation (28.1) → spawn push_rtt.js --commit
 *
 * Luồng tự động = Base Automation (record mới → HTTP request tới /push, qua tunnel
 * rtt-push.kntmcptools.online). Poller quét bảng MẶC ĐỊNH TẮT — chỉ bật khi chạy với
 * env RTT_POLL=1 (backup khi automation hụt).
 */
'use strict';
const http = require('http');
const { spawn, execFile } = require('child_process');
const path = require('path');

const PORT = 3503;
const PUSH_SCRIPT = path.join(__dirname, 'push_rtt.js');
const LARK = '/opt/homebrew/bin/lark-cli';
const BASE_TOKEN = 'DLewbVqU7aZM65sAW6mlcOpngse';
const TABLE_ID = 'tbl3SBngNF198w1U';
const PROFILE_BASE = 'cli_a80df38cc639d02f';

const POLL_ENABLED = process.env.RTT_POLL === '1';
const POLL_MS = 60 * 1000;
const MAX_ATTEMPTS = 8;           // sau 8 lần lỗi thì bỏ (đến khi restart server)
const BACKOFF_MS = 5 * 60 * 1000; // từ lần lỗi thứ 3 trở đi: giãn 5 phút/lần

function log(...args) { console.log(new Date().toISOString(), ...args); }

function jsonRes(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => {
      try { resolve(JSON.parse(buf)); return; } catch {}
      try { resolve(JSON.parse(buf.replace(/:\s*(rec[\w]+)/g, ':"$1"'))); }
      catch { resolve(buf); }
    });
  });
}

// ── Poller: record chưa có 1A_InstanceCode → push ──
const inFlight = new Set();
const attempts = new Map(); // record_id → { n, last }

function runPush(recordId, source) {
  if (inFlight.has(recordId)) return;
  const a = attempts.get(recordId) || { n: 0, last: 0 };
  if (source === 'poll') {
    if (a.n >= MAX_ATTEMPTS) return;
    if (a.n >= 2 && Date.now() - a.last < BACKOFF_MS) return;
  }
  inFlight.add(recordId);
  attempts.set(recordId, { n: a.n + 1, last: Date.now() });
  log(`push [${source}] ${recordId} (lần ${a.n + 1})`);
  const child = spawn('node', [PUSH_SCRIPT, recordId, '--commit'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (out += c));
  child.on('exit', (code) => {
    inFlight.delete(recordId);
    if (code === 0) {
      attempts.delete(recordId);
      const m = out.match(/instance=([\w-]+)/);
      log(`push OK ${recordId}${m ? ' instance=' + m[1] : ''}`);
    } else {
      const err = (out.match(/ERROR: (.+)/) || [])[1] || ('exit ' + code);
      log(`push FAIL ${recordId}: ${err}`);
      if ((attempts.get(recordId) || {}).n >= MAX_ATTEMPTS) log(`  → ${recordId} đạt ${MAX_ATTEMPTS} lần lỗi, ngừng retry (restart server để thử lại)`);
    }
  });
}

function poll() {
  execFile(LARK, [
    '--profile', PROFILE_BASE, 'api', 'POST',
    `/open-apis/bitable/v1/apps/${BASE_TOKEN}/tables/${TABLE_ID}/records/search`,
    '--params', JSON.stringify({ page_size: 50 }),
    '--data', JSON.stringify({
      filter: { conjunction: 'and', conditions: [
        { field_name: '1A_InstanceCode', operator: 'isEmpty', value: [] },
      ] },
      field_names: ['RQ-ID'],
    }),
    '--as', 'bot',
  ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PATH: '/opt/homebrew/bin:' + (process.env.PATH || '') } },
  (err, stdout) => {
    if (err) { log('poll err', err.message.slice(0, 200)); return; }
    let j; try { j = JSON.parse(stdout); } catch { log('poll parse err'); return; }
    const items = (j.data && j.data.items) || [];
    for (const r of items) runPush(r.record_id, 'poll');
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return jsonRes(res, 200, { ok: true, name: 'rtt-push', port: PORT, inFlight: [...inFlight] });
  }
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'method not allowed' });

  const body = await readBody(req);
  if (req.url === '/push') {
    const recordId = (body && (body.record_id || body.recordId)) || (typeof body === 'string' ? body : null);
    if (!recordId) return jsonRes(res, 400, { error: 'missing record_id', received: body });
    attempts.delete(recordId); // trigger tay/automation → reset backoff
    runPush(recordId, 'http');
    return jsonRes(res, 200, { ok: true, record_id: recordId });
  }
  return jsonRes(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  log(`rtt-push server listening on 127.0.0.1:${PORT} (poll: ${POLL_ENABLED ? POLL_MS / 1000 + 's' : 'OFF — Base Automation mode'})`);
  if (POLL_ENABLED) {
    setTimeout(poll, 5000);
    setInterval(poll, POLL_MS);
  }
});
