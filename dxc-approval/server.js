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
const BASE_TOKEN = 'WYJUbZpsbaOTeesvOBPlSEVDg5c';
const TBL_57 = 'tblp36MD9kmWmZRO';
const F_INSTANCE = 'Instance';
const F_STATUS = 'Status 1';
const NOTI_WEBHOOK = 'https://open.larksuite.com/open-apis/bot/v2/hook/cd0c70bd-1e37-4c42-9185-639d4948cdcf';
const VI_WEBHOOK = 'https://open.larksuite.com/open-apis/bot/v2/hook/ad0f7c2e-3e37-4ebb-bca7-e2e9f03c3a45'; // bot noti Vĩ — nhận kết quả duyệt final
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

// Số từ field formula ("1,234" / 1234 / null) → Number|null
function asNum(v) {
  const t = asText(v);
  if (t == null || t === '') return null;
  const n = Number(String(t).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

// Dòng QR cho card: 4F_Link QR là field CHỐT, tự chọn đúng CHIỀU tiền theo 4F_Loại hoàn ứng
// (NV hoàn trả → QR về TK công ty; Công ty trả/đơn thường → QR về TK người nhận).
// Trước đây đọc '4F_Link QR 1' (luôn là QR TK cá nhân) + '4F_Link QR 2' (field không tồn tại)
// → đơn Hoàn ứng "NV hoàn trả" bị gắn QR NGƯỢC chiều: quét vào là chi cho NV thay vì thu về.
function qrLine(f) {
  const qr = asText(f['4F_Link QR']);
  if (!qr) return null;
  const cur = asTextOr(f['4F_Tiền tệ'], 'VND');
  const amt = asNum(f['1F_Chênh lệch']);
  const amtStr = amt != null ? `${Math.abs(amt).toLocaleString('en-US')} ${cur}` : '-';
  const nvTra = asText(f['4F_Loại hoàn ứng']) === 'NV hoàn trả';
  const tk = nvTra
    ? `${asTextOr(f['4L_Bank của TKT (55)'], '?')} ${asTextOr(f['4L_Email/STK TKT'], '?')} — ${asTextOr(f['4L_Tên TK TKT'], '?')} (TK công ty)`
    : `${asTextOr(f['4F_English Bank Name'], '?')} ${asTextOr(f['4F_Email - STK'], '?')} — ${asTextOr(f['4F_Chủ tài khoản'], '?')}`;
  const huong = nvTra ? '🔻 NV hoàn trả về công ty' : '🔺 Công ty chi cho người nhận';
  return `**💸 QR chuyển khoản:** ${huong} — **${amtStr}**\n${tk}\n[Mở QR](${qr})`;
}

async function sendStatusNoti(recordId, instanceCode, status, opts = {}) {
  const theme = STATUS_THEME[status] || { template:'grey', icon:'ℹ️', title:`status=${status}` };
  let f = fetchRecordFields(recordId);
  // QR là formula phụ thuộc rollup (4L_Status của cả LC + 1F_Chênh lệch) → chưa settle ngay
  // lúc event APPROVED về. Chỉ đợi khi đơn THỰC SỰ còn tiền phải chuyển (chênh lệch ≠ 0);
  // chênh lệch = 0 nghĩa là đã tất toán, QR sẽ không bao giờ sinh → khỏi đợi.
  if (status === 'APPROVED') {
    for (let i = 0; i < 5; i++) {
      const ch = asNum(f['1F_Chênh lệch']);
      if (!ch || asText(f['4F_Link QR'])) break;
      await sleep(8000);
      f = fetchRecordFields(recordId);
      if (i === 4) log(`noti QR vẫn rỗng sau 40s ${recordId}`);
    }
  }
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
  const qr = qrLine(f);
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
  if (qr) lines.push(qr);
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
  // --dry-noti: in card ra stdout để kiểm thử, KHÔNG bắn vào group
  if (opts.dry) { console.log(JSON.stringify(card, null, 2)); return; }
  const url = new URL(NOTI_WEBHOOK);
  const req = https.request({
    host: url.host, path: url.pathname + url.search, method: 'POST',
    headers: { 'Content-Type':'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) },
  });
  req.on('error', (e) => log(`status noti err: ${e.message}`));
  req.write(data); req.end();
  const urlVi = new URL(VI_WEBHOOK);
  const reqVi = https.request({
    host: urlVi.host, path: urlVi.pathname + urlVi.search, method: 'POST',
    headers: { 'Content-Type':'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) },
  });
  reqVi.on('error', (e) => log('status noti VI err: ' + e.message));
  reqVi.write(data); reqVi.end();
  log(`status noti sent ${dxc} → ${status}`);
}

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  process.stdout.write(line);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Cảnh báo khi push hỏng — trước đây push fail hoàn toàn im lặng nên phải phát hiện thủ công.
function alertPushFailed(dxcId, result) {
  const reason = (result && (result.reason || result.error)) || 'không rõ';
  const status = (result && result.status) || 'no-result';
  const extra = result && result.instance_code
    ? `\n**Instance:** ${result.instance_code}${result.rolled_back ? ' (đã tự huỷ)' : ' ⚠️ CÒN SỐNG — cần huỷ tay'}` : '';
  const card = {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: { title: { tag:'plain_text', content: `⚠️ ĐXC KHÔNG lên được Approval — ${dxcId}` }, template: 'red' },
      elements: [
        { tag:'div', text:{ tag:'lark_md', content:
          `**LC ID:** ${dxcId}\n**Kết quả:** ${status}\n**Lý do:** ${String(reason).slice(0, 400)}${extra}\n\n👉 Cần push lại thủ công.` } },
        { tag:'note', elements:[{ tag:'lark_md', content:'🤖 dxc-push server' }] },
      ],
    },
  };
  const data = JSON.stringify(card);
  const url = new URL(NOTI_WEBHOOK);
  const r = https.request({
    host: url.host, path: url.pathname + url.search, method: 'POST',
    headers: { 'Content-Type':'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) },
  });
  r.on('error', (e) => log(`alert push failed err: ${e.message}`));
  r.write(data); r.end();
}

// Ghi kết quả push vào log + bắn cảnh báo nếu hỏng.
// Trước đây chỉ log "push dxc=..." mà không log kết quả → fail lặng, không ai biết.
function logPushResults(dxcIds, results, stderr) {
  (results || []).forEach(r => {
    if (!r) return;
    const id = r.dxc_id || dxcIds.join(',');
    if (r.status === 'ok') log(`push RESULT ${id} → ok inst=${r.instance_code}`);
    else if (r.status === 'dry_run') log(`push RESULT ${id} → dry_run`);
    else {
      log(`push RESULT ${id} → ${r.status || 'unknown'} reason=${JSON.stringify(r.reason || r.error || r.raw || r)}`);
      // multi-K: bản ghi K2+ được đẩy qua K1, không phải lỗi
      const viaBase = r.status === 'skipped' && /multi-K/.test(String(r.reason || ''));
      if (!viaBase) alertPushFailed(id, r);
    }
  });
  if (!results || !results.length) {
    log(`push RESULT ${dxcIds.join(',')} → KHÔNG có kết quả trả về`);
    dxcIds.forEach(id => alertPushFailed(id, { status: 'no-result', reason: (stderr || '').slice(-300) }));
  }
  // Các lỗi phụ push_batch ghi ra stderr (writeback_err, lark_retry, cancel_*) trước đây bị vứt
  (stderr || '').split('\n').filter(l =>
    /writeback_err|cancel_err|cancel_failed|cancel_warn|rollback_cancel_err|lark_retry|attach_retry|resolve_dept_err/.test(l)
  ).slice(0, 20).forEach(l => log(`push STDERR ${l.trim().slice(0, 300)}`));
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
      if (code !== 0 && !stdout) {
        log(`push RESULT ${dxcIds.join(',')} → CRASH exit ${code}: ${stderr.slice(-500)}`);
        dxcIds.forEach(id => alertPushFailed(id, { status: `crash exit ${code}`, reason: stderr.slice(-300) }));
        return reject(new Error(`exit ${code}: ${stderr}`));
      }
      const lines = stdout.trim().split('\n').filter(Boolean);
      const results = lines.map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
      try { logPushResults(dxcIds, results, stderr); } catch (e) { log(`logPushResults err: ${e.message}`); }
      resolve(results);
    });
  });
}

const TRANSIENT_RE = /HTTP 429|rate limit|too many request|TLS handshake timeout|i\/o timeout|connection reset|connection refused|EOF|no such host/i;

// 1 lần gọi lark-cli GET record bảng 57 → trả {code, out, err}
function larkGetRecordOnce(recordId) {
  return new Promise((resolve) => {
    const args = ['--profile', PROFILE_BASE, 'api','GET',
      `/open-apis/bitable/v1/apps/${BASE_TOKEN}/tables/${TBL_57}/records/${recordId}`,
      '--as','bot'];
    const proc = spawn(LARK, args, {
      env: { ...process.env, PATH: '/opt/homebrew/bin:' + process.env.PATH },
    });
    let out = '', err = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => err += d.toString());
    proc.on('error', e => resolve({ code: -1, out: '', err: e.message }));
    proc.on('close', code => resolve({ code, out, err }));
  });
}

async function resolveDxcId(recordId) {
  // Đọc record bảng 57 → DXC-ID.
  // LƯU Ý: BẮT BUỘC có --profile PROFILE_BASE. Thiếu nó thì lark-cli rơi về profile mặc định
  // (KAI/tenant 2) vốn không có quyền đọc Base tenant 1 → RolePermNotAllow, stdout rỗng →
  // "Unexpected end of JSON input". Đây là lỗi đã làm /push-base chết 100% từ 25/06/2026.
  const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();   // log 1 dòng cho dễ đọc
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const { code, out, err } = await larkGetRecordOnce(recordId);
    // lark-cli in JSON kết quả ra stdout, nhưng JSON *lỗi* lại ra stderr (khi không có TTY)
    // → phải thử parse CẢ HAI, nếu không lỗi nghiệp vụ sẽ bị hiểu nhầm là "stdout rỗng" và retry vô ích.
    let data = null;
    for (const s of [out, err]) {
      if (!s || !s.trim()) continue;
      try { data = JSON.parse(s); break; } catch (e) { /* thử nguồn kế tiếp */ }
    }

    if (data && data.ok !== false && data.data) {
      const dxc = data?.data?.record?.fields?.['DXC-ID'];
      const dxcCode = Array.isArray(dxc) ? dxc[0]?.text : (dxc?.value?.[0]?.text || dxc?.text);
      if (!dxcCode) throw new Error(`DXC-ID rỗng trong record ${recordId}`);
      return dxcCode;
    }

    const msg = data && data.error
      ? `[${data.error.code || '?'}] ${data.error.message || 'lark-cli error'}`
      : flat(err || out) || `exit ${code}, stdout rỗng`;
    // Lỗi nghiệp vụ (RecordIdNotFound, RolePermNotAllow...) → hỏng luôn, retry vô ích
    const retryable = TRANSIENT_RE.test(msg) || (!data && !out.trim());
    if (!retryable) throw new Error(`resolveDxcId rec=${recordId}: ${msg.slice(0, 300)}`);
    last = msg;
    if (attempt < 3) {
      log(`resolveDxcId retry ${attempt + 1} rec=${recordId}: ${msg.slice(0, 200)}`);
      await sleep(2000 + attempt * 3000);
    }
  }
  throw new Error(`resolveDxcId thất bại sau 4 lần rec=${recordId}: ${last.slice(0, 300)}`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const raw = body;
      body = body.trim();
      if (!body) return resolve({});
      try { return resolve(JSON.parse(body)); } catch (e) {
        // Log raw body (truncated) de chan doan automation gui gi
        log(`readBody parse fail len=${raw.length} raw=${JSON.stringify(raw.slice(0, 200))}`);
        // Fallback: body dang urlencoded (record_id=recXXX&...) hoac bare token
        try {
          if (body.includes('=')) {
            const o = {}; for (const [k, v] of new URLSearchParams(body)) o[k] = v;
            if (Object.keys(o).length) { log(`readBody recovered urlencoded keys=${Object.keys(o).join(',')}`); return resolve(o); }
          } else if (/^rec[A-Za-z0-9]+$/.test(body)) {
            log('readBody recovered bare record_id'); return resolve({ record_id: body });
          }
        } catch (e2) {}
        return reject(e);
      }
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
              // Cross-tenant fan-out: DM requester đúng org qua bot app — MỌI status (PENDING lúc submit + final)
              try {
                const _nb = JSON.stringify({ instance: instCode, status, sys: 'dxc' });
                const _nr = http.request({ hostname: '127.0.0.1', port: 3400, path: '/track/noti', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(_nb) } });
                _nr.on('error', e => log(`fanout err: ${e.message}`));
                _nr.write(_nb); _nr.end();
              } catch (e) { log(`fanout err: ${e.message}`); }
              // Webhook group noti cũ — chỉ FINAL
              if (status !== 'PENDING') {
                sendStatusNoti(recId, instCode, status).catch(e => log(`noti err: ${e.message}`));
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
      // Log record_id NGAY — trước đây chỉ log sau khi resolve xong, nên khi resolve hỏng
      // thì không truy được đơn nào bị rớt.
      log(`push-base rec=${body.record_id} (resolving)`);
      let dxc;
      try {
        dxc = await resolveDxcId(body.record_id);
      } catch (e) {
        log(`push-base rec=${body.record_id} RESOLVE FAIL: ${e.message}`);
        alertPushFailed(`record ${body.record_id}`, { status:'resolve failed', reason: e.message });
        return send(res, 500, { error: e.message, record_id: body.record_id });
      }
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

// CLI: node server.js --dry-noti <record_id> [STATUS] → in card ra stdout, không gửi, không listen
if (process.argv[2] === '--dry-noti') {
  sendStatusNoti(process.argv[3], null, process.argv[4] || 'APPROVED', { dry: true })
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
} else {
  server.listen(PORT, '127.0.0.1', () => {
    log(`dxc-push server listening on 127.0.0.1:${PORT}`);
  });
}
