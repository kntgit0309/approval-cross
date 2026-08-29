#!/usr/bin/env node
/**
 * push_rtt.js <record_id> [--commit]
 *
 * Đẩy 1 record bảng 28.1 "Đề xuất thủ tục hành chính" (HRM, tbl3SBngNF198w1U)
 * → Approval "Duyệt thủ tục hành chính" (tenant 2 KAI, 9C770ED9...).
 *
 * MẶC ĐỊNH AN TOÀN: không truyền --commit thì chỉ dry-run (in payload, không tạo).
 *
 * Requester: Email Công Ty (lookup bảng 20) → batch_get_id trên KAI → open_id thật.
 * Không tìm được → Long proxy (e63f4f5d). Dept: 4L_Department ID → open_department_id KAI,
 * fallback tra bảng 53 theo tên. Minh chứng → upload approval (type=attachment) → attachmentV2.
 * Auto-cancel instance cũ (1A_InstanceCode) trước khi tạo mới. Writeback instance + serial.
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LARK = '/opt/homebrew/bin/lark-cli';
const BASE_TOKEN = 'DLewbVqU7aZM65sAW6mlcOpngse';      // HRM
const TABLE_ID = 'tbl3SBngNF198w1U';                    // 28.1 Đề xuất thủ tục hành chính
const TBL_53 = 'tblHI0qVlA1Yqu7F';                      // 53. TTCP — tên phòng → 1M_Dept ID
const APPROVAL_CODE = '9C770ED9-454D-4300-B8D4-84AEE4866F6B';
const PROFILE_BASE = 'cli_a80df38cc639d02f';            // đọc bảng 28.1 (tenant 1)
const PROFILE_APPROVAL = 'cli_a968bc93f5381e17';        // tạo instance (tenant 2 KAI)
const LONG = 'e63f4f5d';                                // Long admin proxy (tenant 2, user_id)

const W = {
  RQ_ID:    'widget17767582224080001', // input (required)
  DEPT:     'widget17767582911130001', // department (required)
  NHOM:     'widget17767583182720001', // input (required) — Nhóm thủ tục
  DEXUAT:   'widget17834789985690001', // textarea (required) — Đề xuất cụ thể
  NGAY_DX:  'widget17767584354480001', // date (required) — Ngày đề xuất
  DEADLINE: 'widget17767584431360001', // date — Ngày deadline
  LINK:     'widget17834790312540001', // input (required) — Link tài liệu đính kèm
  ATT:      'widget17834791089140001', // attachmentV2 — Tài liệu đính kèm
};

const APP_ID_T2 = 'cli_a968bc93f5381e17';
const SECRET_FILE = path.join(__dirname, '.tenant2_secret');
const TMP_DIR = path.join(__dirname, 'tmp');

function lark(profile, args) {
  const out = execFileSync(LARK, ['--profile', profile, ...args],
    { encoding: 'utf8', env: { ...process.env, PATH: '/opt/homebrew/bin:' + (process.env.PATH || '') }, maxBuffer: 8 * 1024 * 1024 });
  try { return JSON.parse(out); } catch { return { _raw: out }; }
}

function asText(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) {
    if (!v.length) return null;
    if (v.every(e => e && typeof e === 'object' && typeof e.text === 'string')) {
      const joined = v.map(e => e.text).join('');
      return joined === '' ? null : joined;
    }
    const e = v[0];
    if (e == null) return null;
    if (typeof e === 'object') return e.text || e.name || e.value || null;
    return e;
  }
  if (typeof v === 'object') {
    if (Array.isArray(v.value)) return asText(v.value);
    return v.text || v.name || null;
  }
  return null;
}

// ms timestamp → 'YYYY-MM-DDT00:00:00+07:00' (date widget của form này chỉ lấy ngày)
function toDateISO(ms) {
  if (!ms || typeof ms !== 'number') return null;
  const t = new Date(ms + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T00:00:00+07:00`;
}

// dept_id (tenant2, từ 4L_Department ID) → open_department_id
function deptOpenId(deptId) {
  if (!deptId) return null;
  try {
    const dr = lark(PROFILE_APPROVAL, ['api', 'GET', `/open-apis/contact/v3/departments/${deptId}`,
      '--params', JSON.stringify({ department_id_type: 'department_id' }), '--as', 'bot']);
    return (dr.data && dr.data.department && dr.data.department.open_department_id) || null;
  } catch (e) { console.log('  deptOpenId err', deptId, e.message); return null; }
}

// Fallback: tên phòng ban → bảng 53 → 1M_Dept ID → open_department_id (như promo-push)
function resolveDeptByName(name) {
  if (!name) return null;
  try {
    const sr = lark(PROFILE_BASE, ['api', 'POST',
      `/open-apis/bitable/v1/apps/${BASE_TOKEN}/tables/${TBL_53}/records/search`,
      '--data', JSON.stringify({
        filter: { conjunction: 'or', conditions: [
          { field_name: '4F_TTCP-ID Name', operator: 'is', value: ['Phòng ' + name] },
          { field_name: '4F_TTCP-ID Name', operator: 'is', value: [name] },
        ] },
        field_names: ['1M_Dept ID'],
      }), '--as', 'bot']);
    const items = (sr.data && sr.data.items) || [];
    let did = items.length && items[0].fields && items[0].fields['1M_Dept ID'];
    did = asText(did);
    return did ? deptOpenId(did) : null;
  } catch (e) { console.log('  resolveDeptByName err', name, e.message); return null; }
}

// email → open_id bên tenant 2 KAI (người cùng org thì đứng tên thật)
function kaiOpenIdByEmail(email) {
  if (!email) return null;
  try {
    const r = lark(PROFILE_APPROVAL, ['api', 'POST', '/open-apis/contact/v3/users/batch_get_id',
      '--params', JSON.stringify({ user_id_type: 'open_id' }),
      '--data', JSON.stringify({ emails: [email] }), '--as', 'bot']);
    const u = ((r.data || {}).user_list || [])[0];
    return (u && u.user_id) || null;
  } catch (e) { console.log('  kaiOpenIdByEmail err', email, e.message); return null; }
}

function tenant2Token() {
  const secret = (process.env.TENANT2_APP_SECRET || (fs.existsSync(SECRET_FILE) ? fs.readFileSync(SECRET_FILE, 'utf8') : '')).trim();
  if (!secret) throw new Error('thiếu tenant2 secret');
  const out = execFileSync('curl', ['-s', '-X', 'POST',
    'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
    '-H', 'Content-Type: application/json',
    '-d', JSON.stringify({ app_id: APP_ID_T2, app_secret: secret })], { encoding: 'utf8' });
  const j = JSON.parse(out);
  if (!j.tenant_access_token) throw new Error('mint tenant2 token fail: ' + out.slice(0, 120));
  return j.tenant_access_token;
}

// 1 attachment bảng 28.1 → upload approval (type=attachment) → file code cho attachmentV2
function uploadAttachment(token, fileToken, name) {
  const br = lark(PROFILE_BASE, ['api', 'GET', '/open-apis/drive/v1/medias/batch_get_tmp_download_url',
    '--params', JSON.stringify({ file_tokens: [fileToken], extra: JSON.stringify({ bitablePerm: { tableId: TABLE_ID } }) }), '--as', 'bot']);
  const tmp = (((br.data || {}).tmp_download_urls) || [{}])[0].tmp_download_url;
  if (!tmp) throw new Error('no tmp_download_url');
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  const dest = path.join(TMP_DIR, `${Date.now()}_${String(name).replace(/[^\w.\-]/g, '_')}`);
  execFileSync('curl', ['-s', '-L', '-o', dest, tmp]);
  const out = execFileSync('curl', ['-s', '-X', 'POST', 'https://www.larksuite.com/approval/openapi/v2/file/upload',
    '-H', 'Authorization: Bearer ' + token, '-F', 'name=' + name, '-F', 'type=attachment', '-F', 'content=@' + dest],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  let j; try { j = JSON.parse(out); } catch { throw new Error('upload parse fail: ' + out.slice(0, 120)); }
  try { fs.unlinkSync(dest); } catch {}
  if (j.code !== 0) throw new Error('upload fail: ' + out.slice(0, 120));
  return (j.data || {}).code;
}

// Cancel instance cũ: tra initiator thật của instance rồi cancel đúng danh nghĩa người đó.
function cancelInstance(instCode) {
  if (!instCode) return;
  try {
    let initiator = null;
    try {
      const ii = lark(PROFILE_APPROVAL, ['api', 'GET', `/open-apis/approval/v4/instances/${instCode}`, '--as', 'bot']);
      const st = (ii.data || {}).status;
      if (st && st !== 'PENDING' && st !== 'APPROVED') { console.log(`  instance cũ ${instCode} status=${st} → không cần cancel`); return; }
      initiator = (ii.data || {}).open_id || null;
    } catch {}
    const body = { approval_code: APPROVAL_CODE, instance_code: instCode };
    if (initiator) {
      lark(PROFILE_APPROVAL, ['api', 'POST', '/open-apis/approval/v4/instances/cancel',
        '--params', JSON.stringify({ user_id_type: 'open_id' }),
        '--data', JSON.stringify({ ...body, user_id: initiator }), '--as', 'bot']);
    } else {
      lark(PROFILE_APPROVAL, ['api', 'POST', '/open-apis/approval/v4/instances/cancel',
        '--params', JSON.stringify({ user_id_type: 'user_id' }),
        '--data', JSON.stringify({ ...body, user_id: LONG }), '--as', 'bot']);
    }
    console.log(`  ↩ đã cancel instance cũ ${instCode}`);
  } catch (e) { console.log('  cancel cũ lỗi (bỏ qua):', e.message); }
}

function main() {
  const recordId = process.argv[2];
  const commit = process.argv.includes('--commit');
  if (!recordId) { console.error('usage: push_rtt.js <record_id> [--commit]'); process.exit(1); }

  console.log(`[1/4] Đọc record ${recordId} từ bảng 28.1...`);
  const readFields = () => {
    const bg = lark(PROFILE_BASE, ['api', 'POST',
      `/open-apis/bitable/v1/apps/${BASE_TOKEN}/tables/${TABLE_ID}/records/batch_get`,
      '--data', JSON.stringify({ record_ids: [recordId] }), '--as', 'bot']);
    const rec = ((bg.data || {}).records || [])[0];
    if (!rec) throw new Error('record not found: ' + recordId);
    return rec.fields;
  };
  let f = readFields();
  // Race: automation/poller bắn ngay khi tạo record → đợi formula/lookup settle
  for (let i = 0; i < 5 && !(asText(f['RQ-ID']) && asText(f['4L_Department ID'])); i++) {
    console.log(`  (RQ-ID/Department chưa settle, đợi 3s — lần ${i + 1}/5)`);
    try { execFileSync('/bin/sleep', ['3']); } catch {}
    f = readFields();
  }

  const rqId = asText(f['RQ-ID']);
  const nhom = asText(f['Nhóm đơn từ']);
  const lydo = asText(f['Lý do']);
  const deptName = asText(f['4L_Phòng ban']);
  const deptId = asText(f['4L_Department ID']);
  const email = asText(f['Email Công Ty']);
  const ngayDX = typeof f['Ngày bắt đầu'] === 'number' ? f['Ngày bắt đầu']
    : (typeof f['2M_Ngày giờ tạo'] === 'number' ? f['2M_Ngày giờ tạo'] : Date.now());
  const deadline = typeof f['Ngày kết thúc'] === 'number' ? f['Ngày kết thúc'] : null;
  const linkRuta = asText(f['1A_Link ruta']);

  if (!rqId) throw new Error('thiếu RQ-ID (formula chưa settle?)');
  if (!nhom) throw new Error('thiếu Nhóm đơn từ');
  if (!lydo) throw new Error('thiếu Lý do');

  // Department (form required): ưu tiên 4L_Department ID, fallback tra bảng 53 theo tên
  let deptOpen = deptOpenId(deptId);
  if (!deptOpen) deptOpen = resolveDeptByName(deptName);
  if (!deptOpen) throw new Error(`không resolve được Department (4L_Phòng ban='${deptName || ''}', 4L_Department ID='${deptId || ''}') — check phòng ban NS trong bảng 20/53`);

  // Requester: người gửi cùng org KAI → đứng tên thật (open_id); không có → Long
  const kaiOpen = kaiOpenIdByEmail(email ? String(email).replace(/^mailto:/, '') : null);
  console.log(`  RQ=${rqId} | Nhóm=${nhom} | Dept=${deptName}(${deptOpen}) | requester=${kaiOpen || 'Long(' + LONG + ')'}`);

  const link = linkRuta || `https://isuccess.sg.larksuite.com/base/${BASE_TOKEN}?table=${TABLE_ID}&record=${recordId}`;

  const form = [
    { id: W.RQ_ID, type: 'input', value: rqId },
    { id: W.DEPT, type: 'department', value: [{ name: deptName || 'Dept', open_id: deptOpen }] },
    { id: W.NHOM, type: 'input', value: nhom },
    { id: W.DEXUAT, type: 'textarea', value: lydo },
    { id: W.NGAY_DX, type: 'date', value: toDateISO(ngayDX) },
    { id: W.LINK, type: 'input', value: link },
  ];
  if (deadline) form.push({ id: W.DEADLINE, type: 'date', value: toDateISO(deadline) });

  // Minh chứng → attachmentV2 (form đánh required nhưng API cho phép bỏ trống → thiếu thì bỏ qua)
  const atts = f['Minh chứng'];
  if (commit && Array.isArray(atts) && atts.length) {
    try {
      const tok = tenant2Token();
      const codes = [];
      for (const a of atts) {
        if (!a || !a.file_token) continue;
        try { const c = uploadAttachment(tok, a.file_token, a.name || 'file'); if (c) codes.push(c); }
        catch (e) { console.log('  ⚠ upload file lỗi', a.name || '', e.message); }
      }
      if (codes.length) { form.push({ id: W.ATT, type: 'attachmentV2', value: codes }); console.log(`  ✓ đính kèm ${codes.length} file`); }
    } catch (e) { console.log('  ⚠ Minh chứng bỏ qua:', e.message); }
  } else if (Array.isArray(atts) && atts.length) {
    console.log(`  (dry-run: có ${atts.length} file Minh chứng — sẽ upload khi --commit)`);
  } else {
    console.log('  (không có Minh chứng — đẩy không kèm file)');
  }

  const body = { approval_code: APPROVAL_CODE, form: JSON.stringify(form) };
  if (kaiOpen) body.open_id = kaiOpen; else body.user_id = LONG;

  console.log(`[2/4] Payload (${form.length} widgets):`);
  console.log(JSON.stringify({ ...body, form: JSON.parse(body.form) }, null, 2));

  if (!commit) { console.log('\n=== DRY-RUN (mặc định) — KHÔNG tạo instance. Thêm --commit để tạo thật. ==='); return; }

  cancelInstance(asText(f['1A_InstanceCode']));

  console.log(`[3/4] Tạo approval instance...`);
  const cr = lark(PROFILE_APPROVAL, ['api', 'POST', '/open-apis/approval/v4/instances', '--data', JSON.stringify(body), '--as', 'bot']);
  const instCode = (cr.data || {}).instance_code;
  if (!instCode) throw new Error('create failed: ' + JSON.stringify(cr));
  console.log(`  ✓ instance_code=${instCode}`);

  let serial = '';
  try { const ii = lark(PROFILE_APPROVAL, ['api', 'GET', `/open-apis/approval/v4/instances/${instCode}`, '--as', 'bot']); serial = (ii.data || {}).serial_number || ''; } catch {}

  console.log(`[4/4] Writeback bảng 28.1...`);
  lark(PROFILE_BASE, ['api', 'PUT',
    `/open-apis/bitable/v1/apps/${BASE_TOKEN}/tables/${TABLE_ID}/records/${recordId}`,
    '--data', JSON.stringify({ fields: Object.assign({ '1A_InstanceCode': instCode }, serial ? { '1M_Request No.': serial } : {}) }),
    '--as', 'bot']);
  console.log(`  ✓ DONE instance=${instCode} serial=${serial}`);
}

try { main(); } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
