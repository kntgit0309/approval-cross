#!/usr/bin/env node
/**
 * push.js <record_id>
 * Push 1 record from Base table 37.1.1 Test → Approval in tenant 2 (iSuccess 2 KAI)
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const LARK = '/opt/homebrew/bin/lark-cli';
const BASE_TOKEN = 'DLewbVqU7aZM65sAW6mlcOpngse';
const TABLE_ID = 'tblH5K1duVmQPmgO';
const APPROVAL_CODE = 'E6D2C2C3-32D5-4D7A-9C88-731AABB92D9E';
const PROFILE_BASE = 'cli_a80df38cc639d02f';
const PROFILE_APPROVAL = 'cli_a968bc93f5381e17';
const SUBMITTER_USER_ID = 'e63f4f5d'; // adminlark@isuccesscorp360.com (Long)

// Họ và tên đầy đủ → KAI user_id (user org "iSuccess 2"). Người org 2 → đẩy đơn dưới danh nghĩa CHÍNH HỌ
// (initiator thật) để approval route đúng (node CEO theo "Requester belongs to...", hết self-approval).
// Không có trong map (nhân viên không thuộc org 2) → fallback Long. Cập nhật khi org đổi.
const ORG2_MAP = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'org2-map.json'), 'utf8')); } catch { return {}; } })();

// Tên trên Base và tên trong map hay lệch cách bỏ dấu ('Thuỳ' vs 'Thùy') hoặc chuẩn Unicode (NFC/NFD) —
// nhìn giống hệt nhưng so chuỗi thô là MISS → rơi về Long → approval route sai nhánh (RQ2788: đơn của
// Giám đốc BP không lên CEO, tự duyệt đơn mình). Tra thêm bằng key đã bỏ dấu + lowercase.
function normName(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
const ORG2_MAP_NORM = Object.fromEntries(Object.entries(ORG2_MAP).map(([k, v]) => [normName(k), v]));

const LOAI_KEYS = {
  'Đi trễ': 'mgt8xwfv-kh7959tjaz-0',
  'Về sớm': 'mgt8xwfv-fe8udlwnicl-1',
  'Tăng ca': 'mgt8xwfv-s696ja7sk3-2',
  'Giải trình công': 'mgt8xwfv-m2m78kyf0cf-3',
  'Nghỉ việc': 'mgt8xwfv-6zhcwbpg2c4-4',
  'Làm việc từ xa / tại nhà': 'mgt8xwfv-6py44rgmnqu-7',
  'Nghỉ Lễ, Tết': 'mgt8xwfv-75pegi9hv6n-8',
  'Nghỉ Hằng năm (Phép năm)': 'mgt8xwfv-wl3nlboahna-9',
  'Nghỉ hiếu hỉ': 'mgt8xwfv-1i0c9j94d7f-10',
  'Nghỉ theo ca': 'mgt8xwfv-t8o3j8s725q-11',
  'Nghỉ việc riêng không hưởng lương': 'mgt8xwfv-fzknepdt5jn-12',
  'Nghỉ Thai sản (Lao động nữ)': 'mgt8xwfv-ac2z3buapvd-13',
  'Nghỉ theo ca (Không lương)': 'mh4e9bps-a1aob2wfuys-1',
};

const W = {
  RQ_ID:       'widget17603242761530001',
  REQUESTER:   'widget17603242964160001',
  NGUOI_GUI:   'widget17768569372950001',
  DEPT:        'widget17605367021680001',
  NHOM:        'widget17603242829260001',
  LOAI:        'widget17606086651990001',
  LY_DO:       'widget17603243249540001',
  NGAY_BD:     'widget17603243925320001',
  NGAY_KT:     'widget17603244102900001',
  REQ_NAME:    'widget17806518115900001',  // 'Người đề xuất' input — tên thật cross-tenant
  DIEM_OT:     'widget17623108731610001',  // 'Điểm OT' number
  PHEP_CON_LAI:'widget17665557161850001',  // 'Ngày phép còn lại' number
  // 'Link file bàn giao công việc' (đơn nghỉ việc) ← Base field Url 'Link' (fldByboNM4).
  // Widget thêm tay trong Approval editor 06/08/2026 (API không thêm widget được).
  LINK_BAN_GIAO: process.env.HR_WIDGET_LINK_BG || 'widget17859994800260001',
};

// Đơn nghỉ việc: field đính kèm (Base bảng 37) → widget attachmentV2 (form Approval).
// push.js đọc file_token → tmp download url (bitablePerm) → upload approval → code → attachmentV2.
const ATTACH_FIELDS = [
  { field: '2M_File đơn xin nghỉ việc',  widget: 'widget17831290316200001' }, // 'File đơn xin nghỉ việc'
  { field: '2M_File biên bản bàn giao',  widget: 'widget17831290903540001' }, // 'Biên bản bàn giao'
];

function lark(profile, args) {
  // Only add --format json for read ops (api / record-get / record-list); write ops don\'t accept it
  const isWrite = args.some(a => typeof a === 'string' && /\+record-(upsert|create|delete|update)/.test(a));
  const finalArgs = isWrite
    ? ['--profile', profile, ...args]
    : ['--profile', profile, '--format', 'json', ...args];
  const out = execFileSync(LARK, finalArgs, { encoding: 'utf8', env: { ...process.env, PATH: '/opt/homebrew/bin:' + (process.env.PATH || '') } });
  // Write ops return plain text/empty; only try JSON.parse if looks like JSON
  if (isWrite) {
    try { return JSON.parse(out); } catch { return { ok: true, _raw: out }; }
  }
  return JSON.parse(out);
}

function toISO(s) {
  if (!s) return null;
  // Lark Approval date widget hiển thị theo "local time as-is" — KHÔNG convert UTC (Z).
  // Send local ICT ISO 'YYYY-MM-DDTHH:MM:SS+07:00'.
  if (typeof s === 'number') {
    // ms timestamp (UTC) → format ICT local string
    const ict = new Date(s + 7 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${ict.getUTCFullYear()}-${pad(ict.getUTCMonth()+1)}-${pad(ict.getUTCDate())}T${pad(ict.getUTCHours())}:${pad(ict.getUTCMinutes())}:${pad(ict.getUTCSeconds())}+07:00`;
  }
  // String từ +record-get đã ở ICT — giữ nguyên giờ, chỉ format ISO.
  // Từ 11/08/2026 lark-cli trả sẵn offset ('2026-08-15T08:00:00.000+07:00') → nối thêm '+07:00'
  // thành '...+07:00+07:00' và Lark IM LẶNG bỏ widget date (đơn ra không có ngày xin off).
  const str = String(s).trim().replace(' ', 'T');
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(str)) return str;
  return str + '+07:00';
}

function firstOf(v) { return Array.isArray(v) ? v[0] : v; }

// Trích tên dạng string từ lookup/person field — KHÔNG bao giờ trả object (tránh "[object Object]")
function nameOf(v) {
  const x = firstOf(v);
  if (x && typeof x === 'object') return x.name || x.en_name || x.text || '';
  return x || '';
}

// Field Url trong Base → string URL. Nhận mọi shape: string | {link,text} | [{link,text}] | {value:[...]}
function urlOf(v) {
  let x = v;
  if (x && typeof x === 'object' && !Array.isArray(x) && Array.isArray(x.value)) x = x.value;
  x = firstOf(x);
  if (x && typeof x === 'object') return x.link || x.url || x.text || '';
  return x ? String(x) : '';
}

function sleepSync(sec) { try { execFileSync('/bin/sleep', [String(sec)]); } catch {} }

// Chạy lại fn tối đa `tries` lần, nghỉ 2s/4s giữa các lần (lỗi upload file hay do 429 / mạng chập).
function retry(fn, tries, label) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try { return fn(); }
    catch (e) {
      last = e;
      if (i < tries) { console.log(`  … ${label} lỗi lần ${i}/${tries} (${e.message}) — thử lại sau ${2 * i}s`); sleepSync(2 * i); }
    }
  }
  throw last;
}

// Đọc record qua +record-get → object {field: value}
function readRecord(recordId) {
  const recRes = lark(PROFILE_BASE, [
    'base', '+record-get',
    '--base-token', BASE_TOKEN, '--table-id', TABLE_ID,
    '--record-id', recordId, '--as', 'bot',
  ]);
  if (!recRes.ok) throw new Error(`record-get failed: ${JSON.stringify(recRes.error)}`);
  if (recRes.data.record) return recRes.data.record;
  if (recRes.data.fields && recRes.data.data && recRes.data.data[0]) {
    const fnames = recRes.data.fields;
    const row = recRes.data.data[0];
    const r = {};
    fnames.forEach((fname, i) => { r[fname] = row[i]; });
    return r;
  }
  throw new Error('Unexpected record-get response shape');
}

// Lấy pre-signed tmp download url cho 1 attachment file_token (context bitablePerm — bot có quyền qua Base).
function tmpDownloadUrl(fileToken) {
  const res = lark(PROFILE_BASE, [
    'api', 'GET', '/open-apis/drive/v1/medias/batch_get_tmp_download_url',
    '--params', JSON.stringify({ file_tokens: [fileToken], extra: JSON.stringify({ bitablePerm: { tableId: TABLE_ID } }) }),
    '--as', 'bot',
  ]);
  const arr = (res.data && res.data.tmp_download_urls) || [];
  return arr[0] && arr[0].tmp_download_url;
}

// Đọc file .env dạng KEY=VALUE (không thêm dependency dotenv).
function readEnvFile(p) {
  const o = {};
  try {
    fs.readFileSync(p, 'utf8').split('\n').forEach((l) => {
      const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !l.trim().startsWith('#')) o[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch {}
  return o;
}

// tenant_access_token của app approval tenant 2 — cache trong 1 lần chạy.
let _apprToken = null;
function approvalToken() {
  if (_apprToken) return _apprToken;
  const env = { ...readEnvFile(path.join(__dirname, '.env')), ...process.env };
  const appId = env.APPROVAL_APP_ID || PROFILE_APPROVAL;
  const secret = env.APPROVAL_APP_SECRET;
  if (!secret) throw new Error('thiếu APPROVAL_APP_SECRET (đặt trong approval-push/.env) — không upload file được');
  const out = execFileSync('/usr/bin/curl', [
    '-s', '--max-time', '30', '-X', 'POST',
    'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
    '-H', 'Content-Type: application/json',
    '-d', JSON.stringify({ app_id: appId, app_secret: secret }),
  ], { encoding: 'utf8' });
  const j = JSON.parse(out);
  if (!j.tenant_access_token) throw new Error('lấy tenant_access_token fail: ' + String(j.msg || out).slice(0, 120));
  _apprToken = j.tenant_access_token;
  return _apprToken;
}

// Upload 1 file → Approval file API → trả về code dùng cho widget attachmentV2.
// PHẢI gọi curl trực tiếp, KHÔNG dùng lark-cli: `name`/`type` là field trong multipart BODY, còn
// lark-cli chỉ đẩy được vào query string (--params) → Lark không nhận tên file, approval hiện
// "unknown-file" (`ext: unknown-file`, URL không đuôi). Dính 06/08/2026 ở đơn 202608060018.
// --form-string cho field text (không diễn giải @ / < trong tên file), -F content=@ cho file.
// curl chạy với cwd=dir + tên tương đối để tên file không lộ path tạm.
function uploadApprovalFile(dir, baseName, displayName) {
  const out = execFileSync('/usr/bin/curl', [
    '-s', '--max-time', '180', '-X', 'POST',
    'https://open.larksuite.com/open-apis/approval/v4/files/upload',
    '-H', 'Authorization: Bearer ' + approvalToken(),
    '--form-string', 'type=attachment',
    '--form-string', 'name=' + displayName,
    '-F', 'content=@' + baseName,
  ], { cwd: dir, encoding: 'utf8' });
  const res = JSON.parse(out);
  const det = (res.data && res.data.urls_detail) || [];
  const code = det[0] && det[0].code;
  if (!code) throw new Error('upload no code: ' + String(out).slice(0, 200));
  return code;
}

// Build 1 form entry attachmentV2 từ field đính kèm trong Base. Trả null nếu field rỗng.
// Mỗi file retry 3 lần; THIẾU dù chỉ 1 file → throw để cả lần push fail.
// Lý do: đơn nghỉ việc thiếu file đính kèm là đơn hỏng — thà không tạo rồi bấm nút Retry trong Base,
// còn hơn tạo đơn im lặng thiếu file (đã dính 06/08/2026: RQ2760 rớt mất biên bản bàn giao).
function buildAttachmentWidget(r, fieldName, widgetId) {
  const atts = (r[fieldName] || []).filter(a => a && a.file_token);
  if (atts.length === 0) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrpush_'));
  const codes = [];
  try {
    atts.forEach((att, i) => {
      const name = att.name || `file_${i + 1}`;
      // Giữ NGUYÊN tên thật làm tên file tạm (mỗi file 1 thư mục con → không sợ trùng tên):
      // tên trong multipart khớp luôn field `name` → approval hiện đúng tên, không ra "unknown-file".
      const base = name.replace(/[\/\\\r\n"]/g, '_').replace(/^[@<]/, '_') || `att_${i}.bin`;
      const sub = path.join(dir, String(i));
      fs.mkdirSync(sub, { recursive: true });
      const dest = path.join(sub, base);
      const code = retry(() => {
        try { fs.rmSync(dest, { force: true }); } catch {}
        const url = tmpDownloadUrl(att.file_token);
        if (!url) throw new Error('no tmp_download_url');
        execFileSync('/usr/bin/curl', ['-sL', '--fail', '--max-time', '120', url, '-o', dest]);
        if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) throw new Error('empty download');
        return uploadApprovalFile(sub, base, name);
      }, 3, `attach '${fieldName}' [${i + 1}/${atts.length}] ${name}`);
      codes.push(code);
      console.log(`  ✓ attach '${fieldName}' [${i + 1}/${atts.length}] ${name} → ${code}`);
    });
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  if (codes.length !== atts.length) {
    throw new Error(`attach '${fieldName}': chỉ upload được ${codes.length}/${atts.length} file`);
  }
  return { id: widgetId, type: 'attachmentV2', value: codes };
}

function main() {
  const recordId = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  const reqIdx = process.argv.indexOf('--requester');
  const requesterOverride = reqIdx > 0 ? process.argv[reqIdx + 1] : null;
  if (!recordId) { console.error('usage: push.js <record_id> [--dry-run] [--requester <user_id>]'); process.exit(1); }

  // server.js gộp stdout nhiều lần push vào 1 file log → prefix time + record_id để lần ra được.
  { const _log = console.log;
    console.log = (...a) => _log(new Date().toISOString(), recordId, ...a); }

  console.log(`[1/5] Reading record ${recordId}...`);
  let r = readRecord(recordId);

  if (r['Đã gửi']) { console.log('  ✓ already pushed, skipping'); return; }

  // Chờ field lookup settle (race: Automation đẩy ngay khi NV submit, 4L_Họ và tên / RQ-ID chưa tính xong).
  // Nếu thiếu họ tên → đọc lại tối đa 5 lần × 3s. Tránh đẩy đơn ra "[object Object]" + RQ-ID = recordId.
  for (let i = 0; i < 5 && !nameOf(r['4L_Họ và tên']); i++) {
    console.log(`  (4L_Họ và tên chưa settle, đợi 3s rồi đọc lại — lần ${i + 1}/5)`);
    sleepSync(3);
    r = readRecord(recordId);
  }

  const email = r['Email Công Ty'];
  const deptId = r['4L_Department ID'];
  let deptName = firstOf(r['4L_Phòng ban']) || r['1F_Phòng ban(text)'];
  // Ô 'Người đề xuất' hiện TÊN LARK requester (vd "Xuân NTT.AMZ", có suffix team), KHÔNG dùng họ tên đầy đủ.
  const hoTen = nameOf(r['Requester']) || nameOf(r['4L_Họ và tên']) || email;
  const nhom = firstOf(r['Nhóm đơn từ']);
  const loai = firstOf(r['Loại đơn từ']);

  // Fallback: parse dept từ Requester.en_name suffix (vd 'Phong NK.Website' → 'Website')
  if (!deptName && r['Requester'] && Array.isArray(r['Requester']) && r['Requester'][0]) {
    const en = r['Requester'][0].en_name || r['Requester'][0].name || '';
    const m = en.match(/\.([A-Za-z][^.]*)$/);
    if (m) {
      deptName = m[1].trim();
      console.log(`  (parsed dept '${deptName}' từ en_name '${en}')`);
    }
  }

  if (!deptName) throw new Error('missing 4L_Phòng ban (no fallback found)');
  // If 4L_Department ID missing (e.g., main table doesn"t have this lookup), search by name via tenant2 contact API
  let resolvedDeptId = deptId;
  if (!resolvedDeptId) {
    console.log('  (4L_Department ID missing - searching tenant2 by name: ' + deptName + ')');
    try {
      // Lookup từ bảng 53 HRM (4F_TTCP-ID Name = "Phòng " + deptName → 1M_Dept ID)
      const sr = lark(PROFILE_BASE, [
        'api', 'POST',
        '/open-apis/bitable/v1/apps/' + BASE_TOKEN + '/tables/tblHI0qVlA1Yqu7F/records/search',
        '--params', JSON.stringify({ page_size: 10 }),
        '--data', JSON.stringify({
          filter: {
            conjunction: 'or',
            conditions: [
              { field_name: '4F_TTCP-ID Name', operator: 'is', value: ['Phòng ' + deptName] },
              { field_name: '4F_TTCP-ID Name', operator: 'is', value: [deptName] },
            ],
          },
          field_names: ['4F_TTCP-ID Name', '1M_Dept ID'],
        }),
        '--as', 'bot',
      ]);
      const items = (sr.data && sr.data.items) || [];
      if (items.length === 0) throw new Error('no bảng 53 record for ' + deptName);
      const fields0 = items[0].fields || {};
      let did = fields0['1M_Dept ID'];
      if (Array.isArray(did) && did.length) did = (did[0] && did[0].text) || did[0];
      resolvedDeptId = did;
      console.log('  → resolved to dept_id=' + resolvedDeptId);
    } catch (e) {
      throw new Error('cannot resolve department: ' + e.message);
    }
  }
  if (!nhom) throw new Error('missing Nhóm đơn từ');
  if (!loai) throw new Error('missing Loại đơn từ');
  const loaiKey = LOAI_KEYS[loai];
  if (!loaiKey) throw new Error(`unknown Loại đơn từ: ${loai}`);

  console.log(`  dept ${deptName} (${resolvedDeptId})`);
  const deptRes = lark(PROFILE_APPROVAL, [
    'api', 'GET', `/open-apis/contact/v3/departments/${resolvedDeptId}`,
    '--params', JSON.stringify({ department_id_type: 'department_id' }),
    '--as', 'bot',
  ]);
  const openDeptId = deptRes.data && deptRes.data.department && deptRes.data.department.open_department_id;
  if (!openDeptId) throw new Error(`dept open_id not found for ${deptId}`);
  console.log(`  open_department_id=${openDeptId}`);

  // Org iSuccess 2: initiator = chính người làm đơn (KAI user_id) → route đúng + hết self-approval.
  // Khác (nhân viên không trên KAI) → Long fallback (vì initiator phải là user KAI hợp lệ).
  const hoTenFull = nameOf(r['4L_Họ và tên']);
  const realT2 = ORG2_MAP[hoTenFull] || ORG2_MAP_NORM[normName(hoTenFull)];
  const initiator = requesterOverride || realT2 || SUBMITTER_USER_ID;
  const requesterId = initiator;
  console.log(`[2/5] Initiator/Requester = ${initiator} ${realT2 ? '(org2 thật: ' + hoTenFull + ')' : '(Long fallback)'}`);

  const form = [
    { id: W.RQ_ID,     type: 'input',      value: r['RQ-ID'] || recordId },
    { id: W.REQUESTER, type: 'contact',    value: [requesterId] },
    { id: W.DEPT,      type: 'department', value: [{ name: deptName, open_id: openDeptId }] },
    { id: W.NHOM,      type: 'input',      value: nhom },
    { id: W.LOAI,      type: 'radioV2',    value: loaiKey },
  ];
  // Lý do thuần (tên người gửi đã có widget REQ_NAME riêng)
  form.push({ id: W.LY_DO, type: 'input', value: String(r['Lý do'] || '') });
  form.push({ id: W.REQ_NAME, type: 'input', value: String(hoTen || '') });
  if (r['Ngày bắt đầu'])  form.push({ id: W.NGAY_BD, type: 'date',  value: toISO(r['Ngày bắt đầu']) });
  if (r['Ngày kết thúc']) form.push({ id: W.NGAY_KT, type: 'date',  value: toISO(r['Ngày kết thúc']) });
  // Điểm OT (number) — chỉ đẩy khi có giá trị
  { const _ot = firstOf(r['Điểm OT']); const _n = (_ot == null || _ot === '') ? null : Number(String(_ot).replace(/[^\d.-]/g, ''));
    if (_n != null && !Number.isNaN(_n)) form.push({ id: W.DIEM_OT, type: 'number', value: _n }); }
  // Ngày phép còn lại (number) — đẩy cả khi = 0 (số phép còn lại hợp lệ)
  { const _pl = firstOf(r['4L_Ngày phép còn lại']); const _pn = (_pl == null || _pl === '') ? null : Number(String(_pl).replace(/[^\d.-]/g, ''));
    if (_pn != null && !Number.isNaN(_pn)) form.push({ id: W.PHEP_CON_LAI, type: 'number', value: _pn }); }

  // Đính kèm nghỉ việc: File đơn xin nghỉ việc + Biên bản bàn giao (attachmentV2).
  // Chỉ đẩy khi field trong Base có file. Dry-run: chỉ báo số file, KHÔNG upload (tránh side-effect).
  for (const af of ATTACH_FIELDS) {
    const atts = r[af.field];
    const n = Array.isArray(atts) ? atts.filter(a => a && a.file_token).length : 0;
    if (n === 0) continue;
    if (dryRun) {
      console.log(`  (dry-run) '${af.field}': ${n} file → widget ${af.widget} (attachmentV2) — skip upload`);
      form.push({ id: af.widget, type: 'attachmentV2', value: [`<dry-run: ${n} file>`] });
    } else {
      const w = buildAttachmentWidget(r, af.field, af.widget);
      if (w) form.push(w);
    }
  }

  // Link file bàn giao công việc (đơn nghỉ việc) — Base field Url 'Link', bắt buộc trên form 37.BF1.
  { const linkBg = urlOf(r['Link']);
    if (linkBg) {
      if (W.LINK_BAN_GIAO) form.push({ id: W.LINK_BAN_GIAO, type: 'input', value: linkBg });
      else console.log(`  ⚠ có 'Link file bàn giao công việc' (${linkBg}) nhưng chưa cấu hình widget Approval (W.LINK_BAN_GIAO) → bỏ qua`);
    } }

  const body = {
    approval_code: APPROVAL_CODE,
    user_id: initiator,
    form: JSON.stringify(form),
  };

  console.log(`[3/5] Payload:`);
  console.log(JSON.stringify({ ...body, form: JSON.parse(body.form) }, null, 2));

  if (dryRun) { console.log('\n--dry-run → stop here'); return; }

  console.log(`[4/5] Creating approval instance...`);
  const createRes = lark(PROFILE_APPROVAL, [
    'api', 'POST', '/open-apis/approval/v4/instances',
    '--data', JSON.stringify(body),
    '--as', 'bot',
  ]);
  if (!createRes.ok && createRes.code !== 0) {
    throw new Error(`create failed: ${JSON.stringify(createRes.error || createRes)}`);
  }
  const instCode = createRes.data.instance_code;
  console.log(`  ✓ instance_code=${instCode}`);

  // Fetch serial_number from instance + đối chiếu widget đã gửi vs widget thực nhận.
  // Lark có thể im lặng bỏ widget (file/link) → verify để log ra, đừng để đơn thiếu mà không ai biết.
  let serialNo = '';
  try {
    const instInfo = lark(PROFILE_APPROVAL, ['api','GET',`/open-apis/approval/v4/instances/${instCode}`,'--as','bot']);
    serialNo = (instInfo.data && instInfo.data.serial_number) || '';
    console.log(`  serial_number=${serialNo}`);

    const got = new Set();
    JSON.parse((instInfo.data && instInfo.data.form) || '[]').forEach(w => {
      const v = w.value;
      const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
      if (!empty) got.add(w.id);
    });
    const missing = form.filter(w => !got.has(w.id)).map(w => w.id);
    if (missing.length) console.log(`  ⚠ instance THIẾU widget: ${missing.join(', ')} (đã gửi ${form.length}, nhận ${got.size})`);
    else console.log(`  ✓ verify: đủ ${form.length}/${form.length} widget`);
  } catch(e) { console.log('  warn: could not fetch serial/verify', e.message); }

  console.log(`[5/5] Writing back to record...`);
  const upd = lark(PROFILE_BASE, [
    'api', 'PUT',
    `/open-apis/bitable/v1/apps/${BASE_TOKEN}/tables/${TABLE_ID}/records/${recordId}`,
    '--data', JSON.stringify({ fields: Object.assign(
      { '1A_InstanceCode': instCode, 'Status 2 (manual)': 'Under review' },
      serialNo ? { 'Serial no.': serialNo, '1M_Request No.': serialNo } : {}
    ) }),
    '--as', 'bot',
  ]);
  // lark-cli 'api PUT' trả {ok:true} không kèm code → chỉ throw khi cả ok lẫn code đều báo lỗi
  if (!upd.ok && upd.code !== 0) throw new Error(`record-upsert failed: ${JSON.stringify(upd.error || upd)}`);
  console.log(`  ✓ DONE`);
}

try { main(); } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
