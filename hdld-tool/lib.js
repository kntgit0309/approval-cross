'use strict';
/**
 * hdld-tool/lib.js — Lark Base I/O qua lark-cli (khớp pattern dxc/hr/tracking server).
 *
 * KHÔNG nhúng secret: lark-cli đã config profile sẵn trên Mac mini. Mọi call đi qua
 * larkApi(method, path, {params,data}) với 1 profile (env LARK_PROFILE).
 *
 * Trách nhiệm:
 *   - getRecord/listRecords/updateRecord  : CRUD bitable tối thiểu
 *   - valToText / extractRecordIds / docIdFromUrl : normalize value Lark → string
 *   - Hằng số APP/TBL + field-id quan trọng cho hệ sinh HĐLĐ
 */
const { execFileSync } = require('child_process');

/* ─── Hằng số base HĐLĐ (base HR chấm công/lương) ──────────────────────────── */
const APP   = 'DLewbVqU7aZM65sAW6mlcOpngse';
const TBL24 = 'tblnLGFNlUfoHC6G';   // Tool tạo tài liệu (record nhân sự + 4F_ + output)
const TBL26 = 'tblqRlWLHyo8tvpu';   // Template (Google Docs + Biến CSV)
const TBL27 = 'tblXJzGzyAJkq6jy';   // Biến merge ({{Bxxx}} ↔ Tên trên Base ↔ Template)

// Field NAME dùng để đọc/ghi (bitable trả fields keyed theo tên field).
const F = {
  rec24: {
    maTemplate:  'Mã template',      // link → record bảng 26
    idTemplate:  'ID template',      // lookup Google Doc ID (lấy từ bảng 26)
    tenTemplate: 'Tên template',
    fileDocs:    'File Docs',        // ← GHI link doc sinh ra vào đây (fldbXJAs7b)
    filePdf:     'File PDF',          // ← GHI link PDF (fldnx18E1g)
    loaiHD:      '4F_Loại HĐ',
  },
  tpl26: {
    linkTemplate: 'Link template',   // URL doc thật người sửa (nguồn copy chuẩn)
    idTemplate:   'ID template',     // doc-id khai báo (TEM001 đang mismatch link)
    bien:         'Biến',            // CSV "B001,B002,..."
    ten:          'Tên Template',
  },
  var27: {
    bId:        'B-ID',
    placeholder:'Biến khai báo',     // "{{B001}}"
    sourceName: 'Tên trên Base',     // tên field 4F_ ở bảng 24
    template:   'Template',          // link → các record bảng 26 áp dụng biến này
  },
};

/* ─── lark-cli wrapper ─────────────────────────────────────────────────────── */
const LARK    = process.env.LARK_CLI || '/opt/homebrew/bin/lark-cli';
const PROFILE = process.env.LARK_PROFILE || 'cli_a80df38cc639d02f';
const ENV     = { ...process.env, PATH: '/opt/homebrew/bin:' + (process.env.PATH || '') };

// Ngủ đồng bộ (execFileSync là sync nên không dùng setTimeout được)
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function larkApi(method, apiPath, { params, data } = {}, { retries = 2 } = {}) {
  const args = ['--profile', PROFILE, 'api', method, apiPath, '--as', 'bot'];
  if (params) args.push('--params', typeof params === 'string' ? params : JSON.stringify(params));
  if (data)   args.push('--data',   typeof data   === 'string' ? data   : JSON.stringify(data));

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const out = execFileSync(LARK, args, { encoding: 'utf8', env: ENV, maxBuffer: 16 * 1024 * 1024 });
      const json = JSON.parse(out);
      // lark-cli đôi khi exit 0 nhưng body báo network → coi là transient, retry
      if (json && json.error && json.error.type === 'network') {
        throw new Error(`network: ${json.error.message || ''}`);
      }
      if (json && typeof json.code === 'number' && json.code !== 0) {
        const e = new Error(`Lark API ${apiPath} code=${json.code} msg=${json.msg || ''}`);
        e.larkCode = json.code; e.body = json; e.noRetry = true;   // lỗi nghiệp vụ → không retry
        throw e;
      }
      return json;
    } catch (e) {
      lastErr = e;
      const transient = !e.noRetry && /network|ETIMEDOUT|ECONNRESET|EAI_AGAIN|timeout|Command failed/i.test(e.message || '');
      if (attempt < retries && transient) { sleepSync(400 * (attempt + 1)); continue; }
      throw e;
    }
  }
  throw lastErr;
}

/* ─── Bitable CRUD ─────────────────────────────────────────────────────────── */
function getRecord(table, recordId) {
  const r = larkApi('GET', `/open-apis/bitable/v1/apps/${APP}/tables/${table}/records/${recordId}`);
  return r.data && r.data.record ? r.data.record : null;   // {record_id, fields}
}

// Lấy toàn bộ record 1 bảng (auto phân trang). Dùng cho bảng 27 (~64 record).
function listRecords(table, pageSize = 200) {
  const items = [];
  let pageToken;
  do {
    const params = { page_size: pageSize };
    if (pageToken) params.page_token = pageToken;
    const r = larkApi('GET', `/open-apis/bitable/v1/apps/${APP}/tables/${table}/records`, { params });
    const d = r.data || {};
    (d.items || []).forEach(it => items.push(it));
    pageToken = d.has_more ? d.page_token : null;
  } while (pageToken);
  return items;   // [{record_id, fields}]
}

// Phòng khi Base Automation không chèn được record_id: tìm record_id theo 1F_STT.
function findRecordIdByStt(stt) {
  const target = String(stt).trim();
  const items = listRecords(TBL24);
  const hit = items.find(it => valToText((it.fields || {})['1F_STT']) === target);
  return hit ? hit.record_id : null;
}

function updateRecord(table, recordId, fields) {
  return larkApi('PUT', `/open-apis/bitable/v1/apps/${APP}/tables/${table}/records/${recordId}`, {
    data: { fields },
  });
}

/* ─── Normalize value Lark → string ────────────────────────────────────────── */
// Bitable value đủ kiểu: string | number | array | {text|value|name|link}.
function valToText(v) {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.map(valToText).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    if (v.text != null)  return valToText(v.text);
    if (v.value != null) return valToText(v.value);
    if (v.name != null)  return valToText(v.name);
    if (v.link != null)  return valToText(v.link);
    return '';
  }
  return String(v).trim();
}

// Rút record-id (rec...) từ 1 link/lookup field, mọi shape.
function extractRecordIds(v) {
  if (v == null) return [];
  if (v.link_record_ids) return v.link_record_ids.slice();
  const ids = new Set();
  const scan = x => {
    if (!x) return;
    if (Array.isArray(x)) return x.forEach(scan);
    if (typeof x === 'object') {
      if (typeof x.id === 'string' && /^rec/.test(x.id)) ids.add(x.id);
      if (Array.isArray(x.record_ids)) x.record_ids.forEach(id => ids.add(id));
      if (Array.isArray(x.link_record_ids)) x.link_record_ids.forEach(id => ids.add(id));
      Object.values(x).forEach(scan);
    }
  };
  scan(v);
  return [...ids];
}

// Rút Google Doc id từ URL (https://docs.google.com/document/d/<ID>/edit)
function docIdFromUrl(url) {
  const m = String(url || '').match(/\/d\/([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : null;
}

module.exports = {
  APP, TBL24, TBL26, TBL27, F,
  larkApi, getRecord, listRecords, updateRecord, findRecordIdByStt,
  valToText, extractRecordIds, docIdFromUrl,
};
