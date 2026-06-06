#!/usr/bin/env node
/**
 * DXC Push Server — push Đề Xuất Chi từ bảng 57 sang Approval [KAI] Đề xuất chi.
 *
 * Endpoints:
 *   GET  /              health check
 *   POST /push          body: { dxc_id: "LC2343K1" } → push 1 LC
 *   POST /push-batch    body: { dxc_ids: ["LC...", ...] } → push nhiều
 *   POST /push-base     body: { record_id } (from Base Automation) → resolve DXC-ID then push
 *
 * Run: node ~/dxc-push/server.js
 * Logs to ~/dxc-push/server.log
 */
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 3200;
const SCRIPT = path.join(__dirname, 'push_batch.py');
const LOG_FILE = path.join(__dirname, 'server.log');
const PUBLIC_DIR = path.join(__dirname, 'public');
const https = require('https');

// Sync status từ Approval [KAI] về bảng 57
const LARK = '/opt/homebrew/bin/lark-cli';
const PROFILE_BASE = 'cli_a80df38cc639d02f';
const BASE_TOKEN = 'RcX6wwhnZiJsQrkx7TPl9OlCglc';
const TBL_57 = 'tblp36MD9kmWmZRO';
const F_INSTANCE = 'Instance';
const F_STATUS = 'Status 1';
const NOTI_WEBHOOK = process.env.NOTI_WEBHOOK || '';
const STATUS_MAP = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELED: 'Canceled',
  DELETED: 'Deleted',
  REVERTED: 'Reverted',
};
const STATUS_THEME = {
  APPROVED: { template: 'green',  icon: '✅', title: 'đã được duyệt' },
  REJECTED: { template: 'red',    icon: '❌', title: 'đã bị từ chối' },
  CANCELED: { template: 'grey',   icon: '🚫', title: 'đã bị hủy' },
  DELETED:  { template: 'grey',   icon: '🚫', title: 'đã bị xóa' },
  REVERTED: { template: 'orange', icon: '↩️', title: 'đã bị trả về' },
};

function findRecordByInstance(instanceCode) {
  try {
    const body = JSON.stringify({filter:{conjunction:'and',conditions:[
      {field_name: F_INSTANCE, operator:'is', value:[instanceCode]}
    ]}});
    const out = execFileSync(LARK, [
      '--profile', PROFILE_BASE, 'api', 'POST',
      `/open-apis/bitable/v1/apps/${BASE_TOKEN}/tables/${TBL_57}/records/search`,
      '--as','bot','--params','{"page_size":1}','--data', body,
    ], { encoding:'utf8', env: { ...process.env, PATH:'/opt/homebrew/bin:'+process.env.PATH } });
    const j = JSON.parse(out);
    const items = (j && j.data && j.data.items) || [];
    return items.length ? items[0].record_id : null;
  } catch (e) {
    log(`findRecord err: ${e.message}`); return null;
  }
}

function updateDxcStatus(recordId, status) {
  const txt = STATUS_MAP[status] || status;
  try {
    const body = JSON.stringify({fields:{[F_STATUS]: txt}});
    execFileSync(LARK, [
      '--profile', PROFILE_BASE, 'api', 'PUT',
      `/open-apis/bitable/v1/apps/${BASE_TOKEN}/tables/${TBL_57}/records/${recordId}`,
      '--as','bot','--data', body,
    ], { encoding:'utf8', env: { ...process.env, PATH:'/opt/homebrew/bin:'+process.env.PATH } });
    log(`status update OK ${recordId} → ${txt}`);
  } catch (e) {
    log(`status update err ${recordId}: ${e.message}`);
  }
}

function fetchRecordFields(recordId) {
  // Search POST trả enriched format ({type, value:[...]}) — KHÔNG dùng GET single record
  // vì GET --as bot trả raw option ID (vd 'optMF7vL7M' thay vì 'VND').
  try {
    const body = JSON.stringify({automatic_fields:false});
    const out = execFileSync(LARK, [
      '--profile', PROFILE_BASE, 'api', 'POST',
      `/open-apis/bitable/v1/apps/${BASE_TOKEN}/tables/${TBL_57}/records/batch_get`,
      '--as','bot','--data', JSON.stringify({record_ids:[recordId]}),
    ], { encoding:'utf8', env: { ...process.env, PATH:'/opt/homebrew/bin:'+process.env.PATH } });
    const items = ((JSON.parse(out).data || {}).records) || [];
    return (items[0] || {}).fields || {};
  } catch (e) { log(`fetchRecordFields err: ${e.message}`); return {}; }
}

// Trả về string từ value Lark Base (text/select/formula/link), null nếu rỗng
function asText(v) {
  if (v == null) return null;
  if (Array.isArray(v)) {
    if (!v.length) return null;
    const e = v[0];
    if (e == null) return null;
    if (typeof e === 'object') return e.text || e.name || e.link || null;
    return String(e);
  }
  if (typeof v === 'object') {
    // Nested formula: {type:1, value:[{text:'VND'}]}
    if (Array.isArray(v.value)) return asText(v.value);
    return v.text || v.name || v.link || null;
  }
  return String(v);
}
function asTextOr(v, fb) { const t = asText(v); return t || fb; }

function sendStatusNoti(recordId, instanceCode, status) {
  const theme = STATUS_THEME[status] || { template:'grey', icon:'ℹ️', title:`status=${status}` };
  const f = fetchRecordFields(recordId);
  const dxc = asTextOr(f['DXC-ID'], '-');
  const requester = (f['Requester'] && f['Requester'][0] && f['Requester'][0].name) || '-';
  const dept = asTextOr(f['1F_Phòng ban'], null) || asTextOr(f['4F_Phòng ban'], null) || asTextOr(f['Phòng ban 2 (manual)'], '-');
  const c3 = asTextOr(f['4F_Tên TK C3'], '-');
  const mota = asTextOr(f['Mô tả'], null) || asTextOr(f['Mô tả Lô Chi'], null) || asTextOr(f['1F_NDCK'], '-');
  // Amount: formula text → parse number
  const amtRaw = asText(f['4F_Số tiền']);
  const amtNum = amtRaw != null ? Number(String(amtRaw).replace(/,/g, '')) : null;
  const cur = asTextOr(f['4F_Tiền tệ'], 'VND');
  const amtStr = (amtNum != null && !isNaN(amtNum)) ? `${amtNum.toLocaleString('en-US')} ${cur}` : '-';
  // Link record bảng 57
  const linkDxc = asText(f['1A_Link ĐXC']);
  // QR link if available
  const qrLink = asText(f['4F_Link QR 1']) || asText(f['4F_Link QR 2']);
  // Request No.
  const reqNo = asTextOr(f['Request No.'], asTextOr(f['1L_Request No. 1'], '-'));
  const now = new Date();
  const t = new Date(now.getTime() + 7*3600*1000);
  const stamp = `${String(t.getUTCHours()).padStart(2,'0')}:${String(t.getUTCMinutes()).padStart(2,'0')} ${String(t.getUTCDate()).padStart(2,'0')}/${String(t.getUTCMonth()+1).padStart(2,'0')}/${t.getUTCFullYear()}`;
  const lines = [
    `**LC ID:** ${linkDxc ? `[${dxc}](${linkDxc})` : dxc}`,
    `**Request No.:** ${reqNo}`,
    `**Người đề xuất:** ${requester}`,
    `**Phòng ban:** ${dept}`,
    `**TK C3:** ${c3}`,
    `**Số tiền:** ${amtStr}`,
    `**Nội dung:** ${mota}`,
  ];
  if (qrLink) lines.push(`**QR:** [Open QR](${qrLink})`);
  const body = lines.join('\n');
  const card = {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `${theme.icon} ĐXC ${theme.title} — ${dxc}` },
        template: theme.template,
      },
      elements: [
        { tag:'div', text:{ tag:'lark_md', content: body } },
        { tag:'note', elements:[{ tag:'lark_md', content: `🤖 Lark Approval • ${stamp}` }] },
      ],
    },
  };
  const data = JSON.stringify(card);
  const url = new URL(NOTI_WEBHOOK);
  const req = https.request({
    host: url.host, path: url.pathname + url.search, method: 'POST',
    headers: { 'Content-Type':'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) },
  });
  req.on('error', (e) => log(`status noti err: ${e.message}`));
  req.write(data); req.end();
  log(`status noti sent ${dxc} → ${status}`);
}

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  process.stdout.write(line);
}

function runPush(dxcIds) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [SCRIPT, ...dxcIds], {
      env: { ...process.env, PATH: '/opt/homebrew/bin:' + process.env.PATH },
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());
    proc.on('close', code => {
      if (code !== 0 && !stdout) return reject(new Error(`exit ${code}: ${stderr}`));
      const lines = stdout.trim().split('\n').filter(Boolean);
      const results = lines.map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
      resolve(results);
    });
  });
}

async function resolveDxcId(recordId) {
  // Call lark-cli to fetch record from bảng 57 and return its DXC-ID
  return new Promise((resolve, reject) => {
    const args = ['api','GET',
      `/open-apis/bitable/v1/apps/RcX6wwhnZiJsQrkx7TPl9OlCglc/tables/tblp36MD9kmWmZRO/records/${recordId}`,
      '--as','user'];
    const proc = spawn('/opt/homebrew/bin/lark-cli', args, {
      env: { ...process.env, PATH: '/opt/homebrew/bin:' + process.env.PATH },
    });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => {
      try {
        const data = JSON.parse(out);
        const dxc = data?.data?.record?.fields?.['DXC-ID'];
        const code = Array.isArray(dxc) ? dxc[0]?.text : (dxc?.value?.[0]?.text || dxc?.text);
        if (!code) return reject(new Error('DXC-ID not found in record'));
        resolve(code);
      } catch (e) { reject(e); }
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
  });
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj, null, 2));
}

const server = http.createServer(async (req, res) => {
  log(`${req.method} ${req.url}`);
  try {
    if (req.method === 'GET' && req.url.startsWith('/img/')) {
      const file = path.join(PUBLIC_DIR, path.basename(req.url));
      if (fs.existsSync(file)) {
        const ext = path.extname(file).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.jpg' ? 'image/jpeg' : ext === '.pdf' ? 'application/pdf' : 'application/octet-stream';
        res.writeHead(200, {'Content-Type': mime, 'Cache-Control': 'public, max-age=86400'});
        fs.createReadStream(file).pipe(res);
      } else {
        res.writeHead(404); res.end('Not found');
      }
      return;
    }
    if (req.method === 'GET' && req.url === '/') {
      return send(res, 200, { ok:true, name:'dxc-push', endpoints:['POST /push','POST /push-batch','POST /push-base','GET /img/:filename'] });
    }
    if (req.method === 'POST' && req.url === '/push') {
      const body = await readBody(req);
      if (!body.dxc_id) return send(res, 400, { error:'missing dxc_id' });
      log(`push dxc=${body.dxc_id}`);
      const results = await runPush([body.dxc_id]);
      return send(res, 200, results[0] || {});
    }
    if (req.method === 'POST' && req.url === '/event') {
      const body = await readBody(req);
      if (body && body.type === 'url_verification' && body.challenge) {
        log('URL verification ok'); return send(res, 200, { challenge: body.challenge });
      }
      const header = body && body.header;
      const ev = body && body.event;
      if (!ev) { log('no event payload'); return send(res, 200, { code:0 }); }
      const eventType = (header && header.event_type) || ev.type;
      const instCode = ev.instance_code;
      const status = ev.status;
      log(`event ${eventType||'(no-type)'} inst=${instCode} status=${status}`);
      if (eventType === 'approval_instance' && instCode && status) {
        (async () => {
          for (let i=0; i<6; i++) {
            const recId = findRecordByInstance(instCode);
            if (recId) {
              updateDxcStatus(recId, status);
              // Noti card cho status FINAL — bỏ qua PENDING (đã có push card)
              if (status !== 'PENDING') {
                try { sendStatusNoti(recId, instCode, status); } catch (e) { log(`noti err: ${e.message}`); }
              }
              return;
            }
            await new Promise(r => setTimeout(r, 3000));
          }
          log(`no bảng 57 record matching after retries inst=${instCode}`);
        })();
      }
      return send(res, 200, { code:0 });
    }
    if (req.method === 'POST' && req.url === '/push-batch') {
      const body = await readBody(req);
      if (!Array.isArray(body.dxc_ids) || !body.dxc_ids.length) return send(res, 400, { error:'missing dxc_ids array' });
      log(`push-batch n=${body.dxc_ids.length}`);
      const results = await runPush(body.dxc_ids);
      return send(res, 200, { count: results.length, results });
    }
    if (req.method === 'POST' && req.url === '/auto-push-hoan-ung') {
      log('auto-push-hoan-ung triggered');
      const result = await new Promise((resolve) => {
        const proc = spawn('python3', [path.join(__dirname, 'auto_push_hoan_ung.py')], {
          env: { ...process.env, PATH: '/opt/homebrew/bin:' + process.env.PATH },
        });
        let stdout = '';
        proc.stdout.on('data', d => stdout += d.toString());
        proc.on('close', () => {
          const lines = stdout.trim().split('\n').filter(Boolean);
          try { resolve(JSON.parse(lines[lines.length-1])); } catch { resolve({ raw: stdout }); }
        });
      });
      return send(res, 200, result);
    }
    if (req.method === 'POST' && req.url === '/sync-cong-no') {
      log('sync-cong-no triggered');
      const result = await new Promise((resolve, reject) => {
        const proc = spawn('python3', [path.join(__dirname, 'sync_cong_no.py')], {
          env: { ...process.env, PATH: '/opt/homebrew/bin:' + process.env.PATH },
        });
        let stdout = '', stderr = '';
        proc.stdout.on('data', d => stdout += d.toString());
        proc.stderr.on('data', d => stderr += d.toString());
        proc.on('close', code => {
          const lines = stdout.trim().split('\n').filter(Boolean);
          try { resolve(JSON.parse(lines[lines.length-1])); } catch { resolve({ stdout, stderr, code }); }
        });
      });
      return send(res, 200, result);
    }
    if (req.method === 'POST' && req.url === '/push-base') {
      const body = await readBody(req);
      if (!body.record_id) return send(res, 400, { error:'missing record_id' });
      const dxc = await resolveDxcId(body.record_id);
      log(`push-base rec=${body.record_id} dxc=${dxc}`);
      const results = await runPush([dxc]);
      return send(res, 200, results[0] || {});
    }
    send(res, 404, { error:'not found' });
  } catch (e) {
    log(`ERROR ${e.message}`);
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  log(`dxc-push server listening on 127.0.0.1:${PORT}`);
});
