#!/usr/bin/env node
/**
 * push.js <record_id>
 * Push 1 record from Base table 37.1.1 Test → Approval in tenant 2 (iSuccess 2 KAI)
 */
const { execFileSync } = require('child_process');

const LARK = '/opt/homebrew/bin/lark-cli';
const BASE_TOKEN = 'DLewbVqU7aZM65sAW6mlcOpngse';
const TABLE_ID = 'tblH5K1duVmQPmgO';
const APPROVAL_CODE = 'E6D2C2C3-32D5-4D7A-9C88-731AABB92D9E';
const PROFILE_BASE = 'cli_a80df38cc639d02f';
const PROFILE_APPROVAL = 'tenant2';
const SUBMITTER_USER_ID = 'e63f4f5d'; // adminlark@isuccesscorp360.com (Long)

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
};

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
  // String 'YYYY-MM-DD HH:MM:SS' từ +record-get đã ở ICT — giữ nguyên giờ, chỉ format ISO
  return String(s).replace(' ', 'T') + '+07:00';
}

function firstOf(v) { return Array.isArray(v) ? v[0] : v; }

function main() {
  const recordId = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  const reqIdx = process.argv.indexOf('--requester');
  const requesterOverride = reqIdx > 0 ? process.argv[reqIdx + 1] : null;
  if (!recordId) { console.error('usage: push.js <record_id> [--dry-run] [--requester <user_id>]'); process.exit(1); }

  console.log(`[1/5] Reading record ${recordId}...`);
  const recRes = lark(PROFILE_BASE, [
    'base', '+record-get',
    '--base-token', BASE_TOKEN, '--table-id', TABLE_ID,
    '--record-id', recordId, '--as', 'bot',
  ]);
  if (!recRes.ok) throw new Error(`record-get failed: ${JSON.stringify(recRes.error)}`);
  // New lark-cli shape: data.fields[] + data.data[][] (array of rows)
  let r;
  if (recRes.data.record) {
    r = recRes.data.record;
  } else if (recRes.data.fields && recRes.data.data && recRes.data.data[0]) {
    const fnames = recRes.data.fields;
    const row = recRes.data.data[0];
    r = {};
    fnames.forEach((fname, i) => { r[fname] = row[i]; });
  } else {
    throw new Error('Unexpected record-get response shape');
  }

  if (r['Đã gửi']) { console.log('  ✓ already pushed, skipping'); return; }

  const email = r['Email Công Ty'];
  const deptId = r['4L_Department ID'];
  let deptName = firstOf(r['4L_Phòng ban']) || r['1F_Phòng ban(text)'];
  const hoTen = firstOf(r['4L_Họ và tên']) || firstOf(r['Requester']) || email;
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

  const requesterId = requesterOverride || SUBMITTER_USER_ID;
  console.log(`[2/5] Requester widget = ${requesterId} (Long, fixed — real requester hiển thị ở widget Người gửi)`);

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

  const body = {
    approval_code: APPROVAL_CODE,
    user_id: SUBMITTER_USER_ID,
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

  // Fetch serial_number from instance
  let serialNo = '';
  try {
    const instInfo = lark(PROFILE_APPROVAL, ['api','GET',`/open-apis/approval/v4/instances/${instCode}`,'--as','bot']);
    serialNo = (instInfo.data && instInfo.data.serial_number) || '';
    console.log(`  serial_number=${serialNo}`);
  } catch(e) { console.log('  warn: could not fetch serial', e.message); }

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
  if (upd.code !== 0) throw new Error(`record-upsert failed: ${JSON.stringify(upd.error || upd)}`);
  console.log(`  ✓ DONE`);
}

try { main(); } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
