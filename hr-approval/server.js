#!/usr/bin/env node
/**
 * Relay server for approval-push
 * Port 3100 (via Cloudflare Tunnel: approval-push.kntmcptools.online)
 *
 * Routes:
 *   POST /push   — { record_id } from Base workflow → spawn push.js
 *   POST /event  — Lark event callback (URL verification + approval events)
 */
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const path = require('path');

const PORT = 3100;
const PUSH_SCRIPT = path.join(__dirname, 'push.js');
const LARK = '/opt/homebrew/bin/lark-cli';
const BASE_TOKEN = 'DLewbVqU7aZM65sAW6mlcOpngse';
const TABLE_ID = 'tblM0vdS8gVCb68z';
const PROFILE_BASE = 'cli_a80df38cc639d02f';

// Forward events of non-HR approval codes to dedicated servers
const APPROVAL_FORWARD = {
  'DAD13F4B-3D66-4597-8263-1031A80D7FEF': { host: '127.0.0.1', port: 3200, label: 'dxc' },
};

function forwardEvent(target, body) {
  try {
    const data = JSON.stringify(body);
    const r = http.request({
      host: target.host, port: target.port, path: '/event', method: 'POST',
      headers: { 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(data) },
    });
    r.on('error', (e) => log('forward err', target.label, e.message));
    r.write(data); r.end();
    log('forwarded event →', target.label);
  } catch (e) { log('forward exc', target.label, e.message); }
}

// Field: Status 2 (manual) - fldgLVVQ5J (select)
const F_STATUS = 'Status 2 (manual)';
const F_INSTANCE = '1A_InstanceCode';

// Map Lark approval status → Base select value
const STATUS_MAP = {
  PENDING: 'Under review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELED: 'Canceled',
  DELETED: 'Canceled',
  REVERTED: 'Under review',
};

function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => {
      try { resolve(JSON.parse(buf)); return; } catch {}
      // Lark base workflow sometimes sends unquoted values e.g. {"record_id":recXXX}
      try {
        const fixed = buf.replace(/:\s*(rec[\w]+)/g, ':"$1"');
        resolve(JSON.parse(fixed));
      } catch {
        resolve(buf);
      }
    });
  });
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function jsonRes(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Find base record_id by approval instance_code
function findRecordByInstance(instanceCode) {
  try {
    const out = execFileSync(LARK, [
      '--profile', PROFILE_BASE,
      'base', '+record-list',
      '--base-token', BASE_TOKEN, '--table-id', TABLE_ID,
      '--limit', '500',
      '--field-id', F_INSTANCE,
      '--as', 'bot',
    ], { encoding: 'utf8' });
    const j = JSON.parse(out);
    const ids = j.data.record_id_list || [];
    const data = j.data.data || [];
    for (let i = 0; i < ids.length; i++) {
      if (data[i] && data[i][0] === instanceCode) return ids[i];
    }
  } catch (e) {
    log('findRecord err', e.message);
  }
  return null;
}

function updateStatus(recordId, status) {
  const statusText = STATUS_MAP[status] || status;
  try {
    const out = execFileSync(LARK, [
      '--profile', PROFILE_BASE,
      'base', '+record-upsert',
      '--base-token', BASE_TOKEN, '--table-id', TABLE_ID,
      '--record-id', recordId,
      '--json', JSON.stringify({ [F_STATUS]: statusText }),
      '--as', 'bot',
    ], { encoding: 'utf8' });
    log('status update OK', recordId, statusText);
  } catch (e) {
    log('status update err', recordId, e.message);
  }
}

const server = http.createServer(async (req, res) => {
  log(req.method, req.url);

  if (req.method === 'GET' && req.url === '/health') {
    return jsonRes(res, 200, { ok: true });
  }

  if (req.method !== 'POST') {
    return jsonRes(res, 405, { error: 'method not allowed' });
  }

  const body = await readBody(req);

  // --- Lark URL verification + events ---
  if (req.url === '/event' || req.url === '/') {
    // URL verification challenge
    if (body && body.type === 'url_verification' && body.challenge) {
      log('URL verification ok');
      return jsonRes(res, 200, { challenge: body.challenge });
    }
    // v1 & v2 event — extract event payload
    const header = body && body.header;        // v2
    const ev = body && body.event;             // v1 or v2 inner
    if (ev) {
      const eventType = (header && header.event_type) || ev.type;
      const instCode = ev.instance_code;
      const status = ev.status;
      const approvalCode = ev.approval_code;
      log('event', eventType || '(no-type)', 'inst=' + instCode, 'status=' + status, 'code=' + approvalCode);
      // Route to dedicated server if approval_code is forwarded
      if (approvalCode && APPROVAL_FORWARD[approvalCode]) {
        forwardEvent(APPROVAL_FORWARD[approvalCode], body);
        return jsonRes(res, 200, { code: 0, forwarded: APPROVAL_FORWARD[approvalCode].label });
      }
      // Only instance-level status represents overall approval outcome
      if (eventType === 'approval_instance' && instCode && status) {
        // Retry lookup — push.js may still be writing instance_code back to base
        (async () => {
          for (let i = 0; i < 6; i++) {
            const recId = findRecordByInstance(instCode);
            if (recId) { updateStatus(recId, status); return; }
            await new Promise(r => setTimeout(r, 3000));
          }
          log('no base record matching after retries', instCode);
        })();
      }
      return jsonRes(res, 200, { code: 0 });
    }
    if (body && body.challenge) {
      return jsonRes(res, 200, { challenge: body.challenge });
    }
    log('unknown event payload', JSON.stringify(body).slice(0, 300));
    return jsonRes(res, 200, { code: 0 });
  }

  // --- Base workflow → push ---
  if (req.url === '/push') {
    log('push body type=', typeof body, 'raw=', JSON.stringify(body).slice(0, 500));
    const recordId = (body && (body.record_id || body.recordId)) || (typeof body === 'string' ? body : null);
    if (!recordId) return jsonRes(res, 400, { error: 'missing record_id', received: body });
    log('push spawn', recordId);
    const child = spawn('node', [PUSH_SCRIPT, recordId], {
      detached: true, stdio: 'ignore',
    });
    child.unref();
    return jsonRes(res, 200, { ok: true, record_id: recordId });
  }

  // --- HRM Base 35V2 → 46.2 upsert (Lark Automation on 35V2) ---
  if (req.url === '/upsert-46-2') {
    log('upsert-46-2 body=', JSON.stringify(body).slice(0, 300));
    const recordId = (body && (body.record_id || body.recordId)) || (typeof body === 'string' ? body : null);
    if (!recordId) return jsonRes(res, 400, { error: 'missing record_id', received: body });
    log('upsert-46-2 spawn', recordId);
    const child = spawn('/usr/bin/python3', ['/Users/duong/hrm-ac-latemoney/upsert_46_2.py', recordId], {
      detached: true,
      stdio: ['ignore',
              require('fs').openSync('/tmp/upsert_46_2.log', 'a'),
              require('fs').openSync('/tmp/upsert_46_2.log', 'a')],
      env: { ...process.env,
        LARK_APP_ID: 'cli_a80df38cc639d02f',
        LARK_APP_SECRET: 'bbBCT1IEuSe3HIuO3eAk7bWT53UEBHpN',
        LARK_HOST: 'https://open.larksuite.com',
      },
    });
    child.unref();
    return jsonRes(res, 200, { ok: true, record_id: recordId, route: 'upsert-46-2' });
  }

  // --- CFM Base 100 → 46.3 GDT sync (Lark Automation on CFM) ---
  if (req.url === '/sync-gdt-late') {
    log('sync-gdt-late body=', JSON.stringify(body).slice(0, 300));
    const recordId = (body && (body.record_id || body.recordId)) || (typeof body === 'string' ? body : null);
    if (!recordId) return jsonRes(res, 400, { error: 'missing record_id', received: body });
    log('sync-gdt-late spawn', recordId);
    const child = spawn('/usr/bin/python3', ['/Users/duong/hrm-ac-latemoney/sync_gdt_late.py', recordId], {
      detached: true,
      stdio: ['ignore',
              require('fs').openSync('/tmp/sync_gdt_run.log', 'a'),
              require('fs').openSync('/tmp/sync_gdt_run.log', 'a')],
      env: { ...process.env,
        LARK_APP_ID: 'cli_a80df38cc639d02f',
        LARK_APP_SECRET: 'bbBCT1IEuSe3HIuO3eAk7bWT53UEBHpN',
        LARK_HOST: 'https://open.larksuite.com',
      },
    });
    child.unref();
    return jsonRes(res, 200, { ok: true, record_id: recordId, route: 'sync-gdt-late' });
  }

  // --- HRM Base 35V2 → QR upload (Lark Automation) — SYNCHRONOUS ---
  if (req.url === '/qr') {
    log('qr body=', JSON.stringify(body).slice(0, 300));
    const recordId = (body && (body.record_id || body.recordId)) || (typeof body === 'string' ? body : null);
    if (!recordId) return jsonRes(res, 400, { error: 'missing record_id', received: body });
    log('qr run-sync', recordId);
    const child = spawn('/usr/bin/python3', ['/Users/duong/hrm-ac-latemoney/qr_to_attachment.py', recordId], {
      env: { ...process.env,
        LARK_APP_ID: 'cli_a80df38cc639d02f',
        LARK_APP_SECRET: 'bbBCT1IEuSe3HIuO3eAk7bWT53UEBHpN',
        LARK_APP_TOKEN: 'DLewbVqU7aZM65sAW6mlcOpngse',
        LARK_TABLE_ID: 'tblGenoyiigzBJFV',
        LARK_HOST: 'https://open.larksuite.com',
      },
    });
    let stdoutBuf = '';
    let stderrBuf = '';
    child.stdout.on('data', d => stdoutBuf += d);
    child.stderr.on('data', d => stderrBuf += d);
    // Append to log file as well
    const logFd = require('fs').openSync('/tmp/qr_run.log', 'a');
    child.stdout.on('data', d => require('fs').writeSync(logFd, d));
    child.stderr.on('data', d => require('fs').writeSync(logFd, d));
    // Safety timeout: 25s (Lark HTTP timeout typically 30s)
    const timer = setTimeout(() => {
      log('qr timeout, killing', recordId);
      child.kill('SIGKILL');
    }, 25000);
    child.on('close', (code) => {
      clearTimeout(timer);
      try { require('fs').closeSync(logFd); } catch {}
      log('qr done', recordId, 'exit=' + code);
      const msg = (stdoutBuf || '').split('\n').filter(Boolean).slice(-3).join(' | ');
      jsonRes(res, code === 0 ? 200 : 500, {
        ok: code === 0,
        record_id: recordId,
        route: 'qr',
        exit: code,
        msg: msg.slice(0, 300),
      });
    });
    return; // response will be sent by close handler
  }


  // --- Lark IM event: forwarded approval card → reply with summary ---
  if (req.url === '/event/im-message') {
    if (body && body.type === 'url_verification' && body.challenge) {
      log('IM URL verification ok');
      return jsonRes(res, 200, { challenge: body.challenge });
    }
    const header = body && body.header;
    const ev = body && body.event;
    const eventType = (header && header.event_type) || (ev && ev.type);
    if (eventType === 'im.message.receive_v1' && ev && ev.message) {
      const msg = ev.message;
      const chatId = msg.chat_id;
      const content = msg.content || '';
      log('im event chat=', chatId, 'type=', msg.message_type, 'len=', content.length);
      // Restrict to direct chat with Khoa
      if (chatId !== 'oc_2143502a2d7a6e66cc7ea30d99e79a66') {
        log('skip chat', chatId);
        return jsonRes(res, 200, { code: 0 });
      }
      // Extract UUID (instance_code pattern) from message
      const uuidMatch = content.match(/[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i);
      if (uuidMatch) {
        const instanceCode = uuidMatch[0];
        log('extracted instance_code:', instanceCode);
        // Fire-and-forget summary reply
        require('child_process').spawn('/opt/homebrew/bin/node', [
          path.join(__dirname, 'reply-instance-summary.js'),
          instanceCode,
          chatId,
        ], { detached: true, stdio: ['ignore',
          require('fs').openSync('/tmp/im-reply.log', 'a'),
          require('fs').openSync('/tmp/im-reply.log', 'a')] }).unref();
      }
    }
    return jsonRes(res, 200, { code: 0 });
  }

  jsonRes(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  log(`relay server listening on localhost:${PORT}`);
});
