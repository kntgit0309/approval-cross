#!/usr/bin/env node
/**
 * push_promo.js <record_id> [--dry-run] [--loai "<Loại đơn>"]
 *
 * Đẩy 1 record bảng B28 (HRM, tblVw1dYJhkg1RUM) → Approval "Duyệt thăng tiến/ bổ nhiệm / thưởng"
 * trên tenant 2 KAI (approval_code 3083B2D4...). Mô phỏng hr-approval/push.js.
 *
 * MẶC ĐỊNH AN TOÀN: KHÔNG truyền --dry-run thì VẪN dry-run (in payload, không tạo).
 * Chỉ tạo instance thật khi truyền --commit.
 *
 * Cross-tenant: contact widget dùng Long admin proxy (USER_T2_MAP fallback) — như HR/DXC.
 * Chạy trên macmini (cần profile cli_a80df... + tenant2).
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LARK = '/opt/homebrew/bin/lark-cli';
const BASE_TOKEN = 'DLewbVqU7aZM65sAW6mlcOpngse';      // HRM
const TABLE_ID = 'tblVw1dYJhkg1RUM';                    // B28
const APPROVAL_CODE = '3083B2D4-583A-4A1F-9072-220BB655FC0F';
const PROFILE_BASE = 'cli_a80df38cc639d02f';            // đọc B28 (tenant 1)
const PROFILE_APPROVAL = 'tenant2';                     // tạo instance (tenant 2 KAI)
const LONG = 'e63f4f5d';                                // Long admin proxy (tenant 2)

// Widget IDs (lấy từ form definition 3083B2D4)
const W = {
  RQ_ID:        'widget17677720898540001', // input
  LOAI:         'widget17667391444560001', // radioV2
  TIEUCHI_CT:   'widget17667403602740001', // textarea — Tiêu chí vào chính thức
  NGUOI_DX:     'widget17667461270680001', // contact — Người đề xuất
  NGUOI_DDX:    'widget17660313365820001', // contact — Người được đề xuất
  HOTEN:        'widget17659402960510001', // input
  PHONGBAN:     'widget17659403133690001', // department
  BU:           'widget17660286883100001', // department
  CHUCVU:       'widget17659403329380001', // input
  NGAY_CT:      'widget17667426788650001', // date — Ngày vào chính thức
  NAMSINH:      'widget17667427481520001', // number
  LEVEL_HT:     'widget17659403508640001', // radioV2 — Level hiện tại
  LEVEL_DX:     'widget17659404615430001', // radioV2 — Đề xuất chuyển sang Level
  KPI:          'widget17659404817110001', // number
  THUCDAT_TR:   'widget17659403812800001', // number — Thực đạt tháng trước
  THUCDAT_NAY:  'widget17667437040730001', // number — Thực đạt tháng này
  THOIGIAN_AD:  'widget17659405027110001', // date — Thời gian áp dụng
};

// radioV2 key maps (text → value) từ form definition
const MAPS = JSON.parse(fs.readFileSync(path.join(__dirname, 'form-maps.json'), 'utf8'));

// Dept name (tenant 1) → open_department_id (tenant 2). Mở rộng dần; thiếu → bỏ widget dept (optional).
const DEPT_MAP = {
  'Support.ZenE': 'od-9c433b6119f103bf6a1f271c4c50c0d6',
  'Support Account.ZenE': 'od-9c433b6119f103bf6a1f271c4c50c0d6',
  'ZenE': 'od-9c433b6119f103bf6a1f271c4c50c0d6',
  'Etsy': 'od-8aafc66758639c2d2231f74f185e5b43',
  'AMZ Eco': 'od-0d878683a0ceefa0588d94af27dfd991',
  'HR': 'od-9af9fe1764c4f209ed65e4266ca81f4c',
};

// Tên người (B28) → user_id tenant 2 (điền dần). Thiếu → Long proxy.
const USER_T2_MAP = {};

function lark(profile, args) {
  const out = execFileSync(LARK, ['--profile', profile, ...args],
    { encoding: 'utf8', env: { ...process.env, PATH: '/opt/homebrew/bin:' + (process.env.PATH || '') }, maxBuffer: 8 * 1024 * 1024 });
  try { return JSON.parse(out); } catch { return { _raw: out }; }
}

// Trích text từ mọi shape value của Lark Base
function asText(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) {
    if (!v.length) return null;
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
// Trích user object (name + tenant-1 open_id) từ field contact/created_user
function asUser(v) {
  const arr = Array.isArray(v) ? v : (v && Array.isArray(v.value) ? v.value : null);
  if (!arr || !arr.length) return null;
  const e = arr[0];
  if (e && typeof e === 'object') return { name: e.name || e.en_name, open_id: e.id || e.open_id };
  return null;
}
// ms timestamp / 'YYYY-MM-DD HH:MM:SS' → ISO ICT (date widget hiển thị local as-is)
function toISO(s) {
  if (s == null || s === '') return null;
  if (typeof s === 'number') {
    const t = new Date(s + 7 * 3600 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${t.getUTCFullYear()}-${p(t.getUTCMonth()+1)}-${p(t.getUTCDate())}T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}+07:00`;
  }
  return String(s).replace(' ', 'T') + '+07:00';
}

function resolveContact(name) {
  return USER_T2_MAP[name] || LONG;
}

function main() {
  const recordId = process.argv[2];
  const commit = process.argv.includes('--commit');
  if (!recordId) { console.error('usage: push_promo.js <record_id> [--commit]'); process.exit(1); }

  console.log(`[1/4] Đọc record ${recordId} từ B28...`);
  const bg = lark(PROFILE_BASE, ['api', 'POST',
    `/open-apis/bitable/v1/apps/${BASE_TOKEN}/tables/${TABLE_ID}/records/batch_get`,
    '--data', JSON.stringify({ record_ids: [recordId] }), '--as', 'bot']);
  const rec = ((bg.data || {}).records || [])[0];
  if (!rec) throw new Error('record not found: ' + recordId);
  const f = rec.fields;

  const loaiText = asText(f['2M_Loại đơn']);
  const rqId = asText(f['RQ-ID']);
  const hoTen = asText(f['4L_Họ và tên']);
  const chucVu = asText(f['4F_Chức vụ']);
  const phongBan = asText(f['4L_Phòng ban']);
  const bu = asText(f['4L_BU']);
  const levelHT = asText(f['4L_Level hiện tại']);
  const levelDX = asText(f['Đề xuất chuyển sang Level']);
  const kpi = asText(f['4F_KPI Level mới']);
  const nguoiDDX = asUser(f['4L_Người được đề xuất']);

  if (!rqId) throw new Error('thiếu RQ-ID');
  if (!loaiText) throw new Error('thiếu 2M_Loại đơn');
  const loaiKey = (MAPS['Loại đơn'] || {})[loaiText];
  if (!loaiKey) throw new Error('Loại đơn không có trong map: ' + loaiText);

  console.log(`  RQ=${rqId} | Loại=${loaiText} | Họ tên=${hoTen} | Người được ĐX=${nguoiDDX && nguoiDDX.name}`);

  // ── Build form ──
  const form = [
    { id: W.RQ_ID, type: 'input', value: rqId },
    { id: W.LOAI,  type: 'radioV2', value: loaiKey },
  ];
  const push = (id, type, value) => { if (value != null && value !== '') form.push({ id, type, value }); };

  push(W.TIEUCHI_CT, 'textarea', asText(f['Tiêu chí vào chính thức']));
  // contact: Long proxy (TODO: map thật qua USER_T2_MAP)
  form.push({ id: W.NGUOI_DX, type: 'contact', value: [LONG] });
  form.push({ id: W.NGUOI_DDX, type: 'contact', value: [resolveContact(nguoiDDX && nguoiDDX.name)] });
  push(W.HOTEN, 'input', hoTen);
  // department (optional) — chỉ thêm khi map được open_department_id
  const odPB = DEPT_MAP[phongBan];
  if (odPB) form.push({ id: W.PHONGBAN, type: 'department', value: [{ name: phongBan, open_id: odPB }] });
  else if (phongBan) console.log(`  ⚠ Phòng ban '${phongBan}' chưa có trong DEPT_MAP → bỏ widget`);
  const odBU = DEPT_MAP[bu];
  if (odBU) form.push({ id: W.BU, type: 'department', value: [{ name: bu, open_id: odBU }] });
  else if (bu) console.log(`  ⚠ BU '${bu}' chưa có trong DEPT_MAP → bỏ widget`);
  push(W.CHUCVU, 'input', chucVu);
  push(W.NGAY_CT, 'date', toISO(f['Ngày vào chính thức']));
  push(W.NAMSINH, 'number', asText(f['Năm sinh']));
  if (levelHT && (MAPS['Level hiện tại'] || {})[levelHT]) form.push({ id: W.LEVEL_HT, type: 'radioV2', value: MAPS['Level hiện tại'][levelHT] });
  if (levelDX && (MAPS['Đề xuất chuyển sang Level'] || {})[levelDX]) form.push({ id: W.LEVEL_DX, type: 'radioV2', value: MAPS['Đề xuất chuyển sang Level'][levelDX] });
  push(W.KPI, 'number', kpi != null ? Number(String(kpi).replace(/[^\d.-]/g, '')) : null);
  push(W.THUCDAT_TR, 'number', asText(f['Thực đạt tháng trước']));
  push(W.THUCDAT_NAY, 'number', asText(f['Thực đạt tháng này']));
  push(W.THOIGIAN_AD, 'date', toISO(f['Thời gian áp dụng']));

  const body = { approval_code: APPROVAL_CODE, user_id: LONG, form: JSON.stringify(form) };

  console.log(`[2/4] Payload (${form.length} widgets):`);
  console.log(JSON.stringify({ ...body, form: JSON.parse(body.form) }, null, 2));

  if (!commit) { console.log('\n=== DRY-RUN (mặc định) — KHÔNG tạo instance. Thêm --commit để tạo thật. ==='); return; }

  console.log(`[3/4] Tạo approval instance...`);
  const cr = lark(PROFILE_APPROVAL, ['api', 'POST', '/open-apis/approval/v4/instances', '--data', JSON.stringify(body), '--as', 'bot']);
  const instCode = (cr.data || {}).instance_code;
  if (!instCode) throw new Error('create failed: ' + JSON.stringify(cr));
  console.log(`  ✓ instance_code=${instCode}`);

  let serial = '';
  try { const ii = lark(PROFILE_APPROVAL, ['api', 'GET', `/open-apis/approval/v4/instances/${instCode}`, '--as', 'bot']); serial = (ii.data || {}).serial_number || ''; } catch {}

  console.log(`[4/4] Writeback B28...`);
  lark(PROFILE_BASE, ['api', 'PUT',
    `/open-apis/bitable/v1/apps/${BASE_TOKEN}/tables/${TABLE_ID}/records/${recordId}`,
    '--data', JSON.stringify({ fields: Object.assign({ '1A_InstanceCode': instCode, '2M_Status': 'Under Review' }, serial ? { '1M_Request No.': serial } : {}) }),
    '--as', 'bot']);
  console.log(`  ✓ DONE instance=${instCode} serial=${serial}`);
}

try { main(); } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
