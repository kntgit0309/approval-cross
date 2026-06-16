'use strict';
/**
 * hdld-tool/generate.js — Orchestrator sinh 1 tài liệu HĐLĐ.
 *
 *   generate(record24Id):
 *     bảng24 record ──Mã template──> bảng26 (template + doc-id)
 *                  └─ 4F_… giá trị
 *     bảng27 (lọc biến theo template) → map {{Bxxx}} → giá trị 4F_
 *     → copy Google Doc template → replaceAllText → ghi link về File Docs (bảng 24)
 *
 * CLI:  node generate.js <record_id_bảng24>
 */
const lib = require('./lib');
const gdoc = require('./google');
const { F } = lib;

function stamp() {
  const t = new Date(Date.now() + 7 * 3600 * 1000);   // ICT
  const p = n => String(n).padStart(2, '0');
  return `${p(t.getUTCDate())}${p(t.getUTCMonth() + 1)}${t.getUTCFullYear()}-${p(t.getUTCHours())}${p(t.getUTCMinutes())}`;
}

// Field ngày trong Lark có thể về dạng: epoch ms (1671728400000), epoch giây,
// hoặc serial days kiểu Sheets (37921). Đổi hết về DD/MM/YYYY (giờ ICT).
function toDateMs(n) {
  n = Number(n);
  if (!isFinite(n) || n === 0) return null;
  if (n > 1e11) return n;                       // epoch ms
  if (n > 1e7 && n <= 1e11) return n * 1000;     // epoch giây
  if (n > 1 && n < 1e6) return Math.round((n - 25569) * 86400000); // serial days (base 1899-12-30)
  return null;
}
function fmtDate(ms) {
  const t = new Date(ms + 7 * 3600 * 1000);     // ICT
  const p = x => String(x).padStart(2, '0');
  return `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
}
// Bỏ dấu để nhận diện tên field ngày. CHỈ khớp tín hiệu chắc chắn là ngày —
// KHÔNG khớp "cấp"/"sinh" (vì "Phụ cấp"/"Lương..." là SỐ TIỀN, sẽ bị format nhầm thành ngày).
function isDateName(name) {
  const s = String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return /\bngay\b|\bdate\b|bat dau|ket thuc/.test(s);
}
// Lấy giá trị 1 biến từ record, có format ngày nếu hợp lý
function resolveValue(rawVal, sourceName) {
  // số đơn (hoặc bọc trong array/{value}) + tên field kiểu ngày → format DD/MM/YYYY
  let num = null;
  if (typeof rawVal === 'number') num = rawVal;
  else if (Array.isArray(rawVal) && rawVal.length === 1 && typeof rawVal[0] === 'number') num = rawVal[0];
  else if (rawVal && typeof rawVal === 'object' && typeof rawVal.value === 'number') num = rawVal.value;
  if (num != null && isDateName(sourceName)) {
    const ms = toDateMs(num);
    if (ms) return fmtDate(ms);
  }
  return lib.valToText(rawVal);
}

// Ngày ký HĐ: bảng 27 trỏ B028/B029/B030 → field "Ngày"/"Tháng"/"Năm" (KHÔNG tồn tại ở bảng 24),
// B007 → "2M_Ngày thực hiện" (sai tên). Nguồn ngày ký thật trong record = 4F_Ngày thực hiện (DD/MM/YYYY).
// Map các "Tên trên Base" hỏng này về thành phần ngày tương ứng.
const SIGN_DATE_FIELD = '4F_Ngày thực hiện';
const DATE_ALIAS = {
  'Ngày': 'day', 'Tháng': 'month', 'Năm': 'year',
  '2M_Ngày thực hiện': 'full', '4F_Ngày thực hiện': 'full',
};
function signDateParts(fields) {
  const s = lib.valToText(fields[SIGN_DATE_FIELD]);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return { day: m[1], month: m[2], year: m[3], full: s };
}

// Đọc số tiền thành chữ tiếng Việt (vd 9000000 → "Chín triệu đồng", 360000 → "Ba trăm sáu mươi nghìn đồng").
const CS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
function doc3(num, full) {
  const tram = Math.floor(num / 100), chuc = Math.floor((num % 100) / 10), dv = num % 10;
  const s = [];
  if (tram > 0) s.push(CS[tram], 'trăm');
  else if (full) s.push('không', 'trăm');
  if (chuc > 1) {
    s.push(CS[chuc], 'mươi');
    if (dv === 1) s.push('mốt'); else if (dv === 5) s.push('lăm'); else if (dv > 0) s.push(CS[dv]);
  } else if (chuc === 1) {
    s.push('mười');
    if (dv === 5) s.push('lăm'); else if (dv > 0) s.push(CS[dv]);
  } else if (dv > 0) {
    if (tram > 0 || full) s.push('lẻ');
    s.push(dv === 5 ? 'năm' : CS[dv]);
  }
  return s.join(' ');
}
function docSoThanhChu(n) {
  n = Math.round(Number(n) || 0);
  if (n <= 0) return '';
  const SCALES = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];
  const groups = [];
  let x = n;
  while (x > 0) { groups.push(x % 1000); x = Math.floor(x / 1000); }
  const parts = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    parts.push((doc3(groups[i], i < groups.length - 1) + ' ' + SCALES[i]).trim());
  }
  let res = parts.join(' ').replace(/\s+/g, ' ').trim();
  return res.charAt(0).toUpperCase() + res.slice(1) + ' đồng';
}
// Biến "bằng chữ" → field SỐ tương ứng (template cặp {{B012}}↔{{B031}}, {{B014}}↔{{B066}})
const BANG_CHU = {
  'B031': '4F_Lương cơ bản',
  'B066': '4F_Phụ cấp',
};

function parseOverride() {
  const raw = process.env.TEMPLATE_DOC_OVERRIDE;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function generate(record24Id, { log = console.log, force = false, settleWaitMs = 0 } = {}) {
  if (!record24Id) throw new Error('Thiếu record_id (bảng 24)');
  const warnings = [];

  // 1) Đọc record bảng 24
  let rec = lib.getRecord(lib.TBL24, record24Id);
  if (!rec) throw new Error(`Không tìm thấy record ${record24Id} ở bảng 24`);
  let fields = rec.fields || {};

  // Idempotency: đã có File Docs rồi thì bỏ qua (tránh tạo trùng khi automation fire nhiều lần).
  const existingDoc = lib.valToText(fields[F.rec24.fileDocs]);
  if (existingDoc && !force) {
    log(`[gen] ${record24Id} bỏ qua — đã có File Docs`);
    return { ok: true, skipped: 'already_generated', record_id: record24Id, docUrl: existingDoc };
  }

  // Settle-wait: record VỪA TẠO → Mã template (lookup) + 4F_Họ và tên (formula) có thể chưa tính.
  // Đọc lại vài lần cho tới khi sẵn sàng hoặc hết thời gian (automation trigger "record created").
  const isReady = f => lib.extractRecordIds(f[F.rec24.maTemplate]).length && lib.valToText(f['4F_Họ và tên']);
  if (settleWaitMs > 0 && !force && !isReady(fields)) {
    const deadline = Date.now() + settleWaitMs;
    while (Date.now() < deadline && !isReady(fields)) {
      await new Promise(r => setTimeout(r, 3000));
      rec = lib.getRecord(lib.TBL24, record24Id);
      fields = (rec && rec.fields) || {};
    }
    log(`[gen] ${record24Id} settle-wait xong, ready=${!!isReady(fields)}`);
  }

  // 2) Tìm template (bảng 26) record từ field "Mã template" (link)
  const tplRecIds = lib.extractRecordIds(fields[F.rec24.maTemplate]);
  if (!tplRecIds.length) {
    // Chưa chọn template (hoặc field chưa settle khi record vừa tạo) → skip mềm, automation retry vô hại.
    log(`[gen] ${record24Id} bỏ qua — chưa có Mã template`);
    return { ok: true, skipped: 'no_template', record_id: record24Id };
  }
  // Settle-guard: record vừa tạo có thể chưa kịp tính 4F_Họ và tên → chưa sẵn sàng.
  if (!lib.valToText(fields['4F_Họ và tên']) && !force) {
    log(`[gen] ${record24Id} bỏ qua — 4F_Họ và tên chưa settle`);
    return { ok: true, skipped: 'not_ready', record_id: record24Id };
  }
  if (tplRecIds.length > 1) warnings.push(`record link ${tplRecIds.length} template, dùng cái đầu: ${tplRecIds[0]}`);
  const tplRecId = tplRecIds[0];
  const tpl = lib.getRecord(lib.TBL26, tplRecId);
  if (!tpl) throw new Error(`Không tìm thấy template ${tplRecId} ở bảng 26`);
  const tplFields = tpl.fields || {};
  const tplName = lib.valToText(tplFields[F.tpl26.ten]) || 'HĐLĐ';

  // 3) Doc-id nguồn: ƯU TIÊN doc trong "Link template" (doc người sửa thật),
  //    fallback field "ID template". Cảnh báo khi 2 cái khác nhau (case TEM001).
  const linkUrl   = lib.valToText(tplFields[F.tpl26.linkTemplate]);
  const idFromLink = lib.docIdFromUrl(linkUrl);
  const idDeclared = lib.valToText(tplFields[F.tpl26.idTemplate]);
  let srcDocId = idFromLink || idDeclared;
  if (idFromLink && idDeclared && idFromLink !== idDeclared) {
    warnings.push(`⚠️ Template "${tplName}": ID template (${idDeclared}) ≠ doc trong Link template (${idFromLink}). Dùng doc trong Link template.`);
  }
  if (!srcDocId) throw new Error(`Template "${tplName}" không có doc-id (cả Link template lẫn ID template đều rỗng)`);

  // 3b) Override thủ công (env TEMPLATE_DOC_OVERRIDE) nếu cần ép doc khác
  const override = parseOverride();
  if (override[srcDocId]) {
    warnings.push(`override doc-id ${srcDocId} → ${override[srcDocId]}`);
    srcDocId = override[srcDocId];
  }

  // 4) Lọc biến áp dụng cho template này từ bảng 27 (link Template chứa tplRecId).
  const allVars = lib.listRecords(lib.TBL27);
  let vars = allVars.filter(v => lib.extractRecordIds((v.fields || {})[F.var27.template]).includes(tplRecId));
  if (!vars.length) {
    // Fallback: dùng CSV "Biến" trên record template
    const csv = lib.valToText(tplFields[F.tpl26.bien]).split(/[,\s]+/).filter(Boolean);
    const byId = new Map(allVars.map(v => [lib.valToText((v.fields || {})[F.var27.bId]), v]));
    vars = csv.map(id => byId.get(id)).filter(Boolean);
    warnings.push(`bảng 27 không link template ${tplRecId}; fallback theo CSV "Biến" (${vars.length} biến)`);
  }
  if (!vars.length) throw new Error(`Không tìm được biến nào cho template "${tplName}"`);

  // 5) Dựng map {{Bxxx}} → giá trị 4F_, ghi nhận biến không resolve được
  const map = {};
  const unresolved = [];
  for (const v of vars) {
    const vf = v.fields || {};
    const placeholder = lib.valToText(vf[F.var27.placeholder]);   // "{{B001}}"
    const sourceName  = lib.valToText(vf[F.var27.sourceName]);    // "4F_Họ và tên"
    const bId         = lib.valToText(vf[F.var27.bId]);
    if (!placeholder) continue;
    // Bằng chữ: đọc số tiền (từ field số tương ứng) thành chữ
    if (BANG_CHU[bId]) {
      const num = Number(String(lib.valToText(fields[BANG_CHU[bId]])).replace(/[^\d]/g, ''));
      map[placeholder] = num ? docSoThanhChu(num) : '';
      continue;
    }
    if (!(sourceName in fields)) {
      // Field không tồn tại → thử alias ngày ký (Ngày/Tháng/Năm/Ngày thực hiện)
      const part = DATE_ALIAS[sourceName];
      const dp = part ? signDateParts(fields) : null;
      if (dp) { map[placeholder] = dp[part]; continue; }
      unresolved.push({ bId, placeholder, sourceName });
      map[placeholder] = '';                                      // để trống thay vì giữ {{Bxxx}}
      continue;
    }
    map[placeholder] = resolveValue(fields[sourceName], sourceName);
  }

  // 6) Sinh doc: copy template → replace → ghi link về bảng 24
  const hoTen = lib.valToText(fields['4F_Họ và tên']) || record24Id;
  const docName = `${tplName} - ${hoTen} - ${stamp()}`;
  log(`[gen] ${record24Id} | tpl="${tplName}" srcDoc=${srcDocId} | ${Object.keys(map).length} biến, ${unresolved.length} chưa resolve`);

  const copy = await gdoc.copyTemplate(srcDocId, docName);
  await gdoc.replacePlaceholders(copy.id, map);
  const url = gdoc.docUrl(copy.id);

  // Xuất PDF từ doc đã merge, upload vào Shared Drive
  const pdf = await gdoc.exportPdf(copy.id, docName);
  const pdfUrl = pdf.webViewLink || `https://drive.google.com/file/d/${pdf.id}/view`;

  // File Docs & File PDF là field kiểu URL → bitable đòi object {link, text}, không nhận string trần.
  lib.updateRecord(lib.TBL24, record24Id, {
    [F.rec24.fileDocs]: { link: url, text: docName },
    [F.rec24.filePdf]: { link: pdfUrl, text: `${docName}.pdf` },
  });
  log(`[gen] ✓ ${record24Id} → doc ${url} | pdf ${pdfUrl}`);

  return {
    ok: true,
    record_id: record24Id,
    docUrl: url,
    docId: copy.id,
    pdfUrl,
    pdfId: pdf.id,
    template: { recordId: tplRecId, name: tplName, srcDocId },
    varsCount: Object.keys(map).length,
    unresolved,
    warnings,
  };
}

module.exports = { generate };

/* ─── CLI ──────────────────────────────────────────────────────────────────── */
if (require.main === module) {
  const id = process.argv[2];
  const force = process.argv.includes('--force');
  if (!id) { console.error('Usage: node generate.js <record_id_bảng24> [--force]'); process.exit(1); }
  generate(id, { force })
    .then(r => { console.log(JSON.stringify(r, null, 2)); })
    .catch(e => { console.error('✗', e.message); process.exit(1); });
}
