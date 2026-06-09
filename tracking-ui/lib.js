#!/usr/bin/env node
/**
 * tracking-ui/lib.js — Core dùng chung cho server.js + send.js
 *
 * Trách nhiệm:
 *   1. fetchInstance()  — GET instance từ Lark Approval [KAI] (profile tenant2)
 *   2. normalize()      — instance thô → canonical JSON (dùng cho cả H5 page lẫn card)
 *   3. resolveUsers()   — open_id/user_id người duyệt → {name, initials} (cache file)
 *   4. buildCard()      — canonical → Lark Interactive Card JSON (bare card object)
 *   5. sendCard()/patchCard() — gửi / cập nhật card cho nhân viên qua im/v1/messages
 *   6. store            — map instanceCode → {message_id, receive_id, sys} để patch khi status đổi
 *
 * KHÔNG có dependency ngoài — chỉ dùng lark-cli (đã config profile sẵn trên Mac mini),
 * khớp pattern của dxc-approval/server.js + hr-approval/server.js.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/* ─── Hằng số ─────────────────────────────────────────────────────────────── */
const LARK = '/opt/homebrew/bin/lark-cli';
const PROFILE_APPROVAL = 'tenant2';              // KAI — nơi chứa Approval instance
// Bot gửi tin nhắn cho user — đổi qua env BOT_PROFILE (profile lark-cli của bot publish DM được).
// Mặc định cli_a80df... (writer-app) KHÔNG DM user được → set BOT_PROFILE sang bot của bạn.
const PROFILE_IM = process.env.BOT_PROFILE || 'cli_a80df38cc639d02f';
const PROFILE_BASE_T1 = 'cli_a80df38cc639d02f'; // đọc bảng 57 (tenant 1 iSuccess)
const BASE_57 = 'RcX6wwhnZiJsQrkx7TPl9OlCglc';
const TBL_57 = 'tblp36MD9kmWmZRO';
const STORE_FILE = path.join(__dirname, 'store.json');
const USERCACHE_FILE = path.join(__dirname, 'usercache.json');

// Approval code → hệ thống (để chọn cách parse form khi caller không truyền sys)
const SYS_BY_CODE = {
  'E6D2C2C3-32D5-4D7A-9C88-731AABB92D9E': 'hr',
  'DAD13F4B-3D66-4597-8263-1031A80D7FEF': 'dxc',
};

const ENV = { ...process.env, PATH: '/opt/homebrew/bin:' + process.env.PATH };

/* ─── lark-cli wrapper ────────────────────────────────────────────────────── */
function larkApi(profile, method, apiPath, { params, data } = {}) {
  const args = ['--profile', profile, 'api', method, apiPath, '--as', 'bot'];
  if (params) args.push('--params', typeof params === 'string' ? params : JSON.stringify(params));
  if (data) args.push('--data', typeof data === 'string' ? data : JSON.stringify(data));
  const out = execFileSync(LARK, args, { encoding: 'utf8', env: ENV, maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(out);
}

/* ─── Text helpers ────────────────────────────────────────────────────────── */
// Bỏ dấu tiếng Việt + đ/Đ → phục vụ initials
function stripDiacritics(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

// "Phạm Quốc Dũng" → "PQD"  (chữ cái đầu của tối đa 3 từ cuối)
function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const take = words.slice(-3);
  return take.map(w => stripDiacritics(w[0] || '').toUpperCase()).join('') || '?';
}

// Màu avatar deterministic theo tên (palette Lark)
const AVATAR_PALETTE = ['#1456F0', '#1CB87E', '#00AAFF', '#FF8800', '#8B5CF6', '#F54A45', '#14B8A6', '#EC4899'];
function avatarColor(seed) {
  let h = 0;
  const s = stripDiacritics(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

// Lấy string từ value Lark (text/select/array/object), null nếu rỗng
function asText(v) {
  if (v == null) return null;
  if (Array.isArray(v)) {
    if (!v.length) return null;
    return asText(v[0]);
  }
  if (typeof v === 'object') {
    if (Array.isArray(v.value)) return asText(v.value);
    return v.text || v.name || v.label || v.link || (v.value != null ? asText(v.value) : null);
  }
  const s = String(v).trim();
  return s || null;
}

// Format ms / ISO / 'YYYY-MM-DD HH:mm:ss' → "DD/MM HH:mm" (ICT) ; full=true → kèm năm
function fmtTime(raw, full = false) {
  if (!raw) return null;
  let ms;
  if (/^\d{10,}$/.test(String(raw))) {
    ms = Number(raw);
    if (String(raw).length === 10) ms *= 1000;     // giây → ms
  } else {
    const iso = String(raw).includes('T') ? raw : String(raw).replace(' ', 'T');
    ms = Date.parse(iso.includes('+') || iso.endsWith('Z') ? iso : iso + '+07:00');
  }
  if (!ms || isNaN(ms)) return null;
  const t = new Date(ms + 7 * 3600 * 1000);        // ICT
  const p = n => String(n).padStart(2, '0');
  const base = `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}`;
  const hm = `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
  return full ? `${base}/${t.getUTCFullYear()} ${hm}` : `${base} ${hm}`;
}

function nowStamp() {
  const t = new Date(Date.now() + 7 * 3600 * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${p(t.getUTCHours())}:${p(t.getUTCMinutes())} ${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
}

function fmtAmount(num, cur) {
  if (num == null || isNaN(num)) return null;
  return `${Number(num).toLocaleString('en-US')}${cur ? ' ' + cur : ''}`;
}

/* ─── Store (instanceCode → message map) ─────────────────────────────────── */
function loadJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } }
function saveJson(file, obj) { try { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); } catch (e) { /* best effort */ } }

function getSent(instanceCode) { return loadJson(STORE_FILE)[instanceCode] || null; }
function putSent(instanceCode, entry) {
  const s = loadJson(STORE_FILE);
  s[instanceCode] = { ...(s[instanceCode] || {}), ...entry, ts: nowStamp() };
  saveJson(STORE_FILE, s);
  return s[instanceCode];
}

/* ─── Resolve tên người duyệt (cache) ────────────────────────────────────── */
function resolveUsers(ids, idType = 'open_id') {
  const cache = loadJson(USERCACHE_FILE);
  const out = {};
  let dirty = false;
  for (const id of ids) {
    if (!id) continue;
    if (cache[id] && cache[id].avatar !== undefined) { out[id] = cache[id]; continue; } // re-fetch entry cũ thiếu avatar
    try {
      const j = larkApi(PROFILE_APPROVAL, 'GET', `/open-apis/contact/v3/users/${id}`, { params: { user_id_type: idType } });
      const u = (j.data && j.data.user) || {};
      const name = u.name || u.en_name || null;
      const av = (u.avatar && (u.avatar.avatar_240 || u.avatar.avatar_72)) || null;
      const entry = { name, initials: initials(name || id), avatar: av };
      cache[id] = entry; out[id] = entry; dirty = true;
    } catch (e) {
      out[id] = { name: null, initials: '?', avatar: null };
    }
  }
  if (dirty) saveJson(USERCACHE_FILE, cache);
  return out;
}

/* ─── Resolve open_id requester từ bảng 57 (để DM đúng người) ───────────── */
function resolveRequester(instanceCode) {
  try {
    const body = { filter: { conjunction: 'and', conditions: [{ field_name: 'Instance', operator: 'is', value: [instanceCode] }] } };
    const j = larkApi(PROFILE_BASE_T1, 'POST', `/open-apis/bitable/v1/apps/${BASE_57}/tables/${TBL_57}/records/search`, { params: { page_size: 1 }, data: body });
    const items = (j.data && j.data.items) || [];
    const req = items[0] && items[0].fields && items[0].fields['Requester'];
    const r = Array.isArray(req) ? req[0] : req;
    const openId = r && (r.id || r.open_id);
    if (!openId) return null;
    // open_id là per-app → đổi sang EMAIL (dùng chung mọi app) cho bot khác gửi được
    try {
      const u = larkApi(PROFILE_BASE_T1, 'GET', `/open-apis/contact/v3/users/${openId}`, { params: { user_id_type: 'open_id' } });
      const usr = (u.data && u.data.user) || {};
      return usr.email || usr.enterprise_email || openId;
    } catch { return openId; }
  } catch (e) { return null; }
}

/* ─── Fetch instance từ Approval [KAI] ──────────────────────────────────── */
function fetchInstance(instanceCode) {
  const j = larkApi(PROFILE_APPROVAL, 'GET', `/open-apis/approval/v4/instances/${instanceCode}`,
    { params: { user_id_type: 'open_id' } });
  const inst = j.data;
  if (!inst) throw new Error(`instance ${instanceCode} không có data (code=${j.code} msg=${j.msg})`);
  return inst;
}

/* ─── Parse form widgets ─────────────────────────────────────────────────── */
function parseForm(formRaw) {
  let arr = formRaw;
  if (typeof formRaw === 'string') { try { arr = JSON.parse(formRaw); } catch { arr = []; } }
  if (!Array.isArray(arr)) arr = [];
  // Flatten 1 cấp (fieldList / group widget chứa children)
  const flat = [];
  for (const w of arr) {
    flat.push(w);
    if (Array.isArray(w.value) && w.value.length && typeof w.value[0] === 'object' && w.value[0] && w.value[0].name)
      for (const c of w.value) flat.push(c);
  }
  const norm = s => stripDiacritics(String(s || '')).toLowerCase();
  return {
    // pick(...keywords) → text value của widget đầu tiên có name chứa 1 keyword
    pick(...keys) {
      const kk = keys.map(norm);
      for (const w of flat) {
        const n = norm(w.name);
        if (kk.some(k => n.includes(k))) {
          const t = asText(w.value);
          if (t != null) return t;
        }
      }
      return null;
    },
    // sumList('các khoản chi','số tiền') → tổng số tiền các dòng trong fieldList, null nếu không có
    sumList(listName, amountName) {
      const lk = norm(listName), ak = norm(amountName);
      for (const w of arr) {
        if (!w || !norm(w.name).includes(lk) || !Array.isArray(w.value)) continue;
        let sum = 0, any = false;
        for (const row of w.value) {
          const cells = Array.isArray(row) ? row : (row && Array.isArray(row.value) ? row.value : []);
          for (const c of cells) {
            if (c && typeof c === 'object' && norm(c.name).includes(ak)) {
              const n = Number(String(asText(c.value) ?? '').replace(/[^\d.-]/g, ''));
              if (!isNaN(n)) { sum += n; any = true; }
            }
          }
        }
        return any ? sum : null;
      }
      return null;
    },
    // rows('các khoản chi') → [{tênCột: value, ...}, ...] cho fieldList
    rows(listName) {
      const lk = norm(listName);
      for (const w of arr) {
        if (!w || !norm(w.name).includes(lk) || !Array.isArray(w.value)) continue;
        return w.value.map(row => {
          const cells = Array.isArray(row) ? row : (row && Array.isArray(row.value) ? row.value : []);
          const o = {};
          for (const c of cells) if (c && typeof c === 'object' && c.name) o[c.name] = asText(c.value);
          return o;
        });
      }
      return [];
    },
  };
}

/* ─── Map status ─────────────────────────────────────────────────────────── */
const OVERALL = {
  PENDING: 'in_progress', RUNNING: 'in_progress', REVERTED: 'in_progress',
  APPROVED: 'approved', DONE: 'approved',
  REJECTED: 'rejected',
  CANCELED: 'canceled', DELETED: 'canceled',
};

/* ─── normalize(instance, sys) → canonical JSON ──────────────────────────── */
function normalize(inst, sys) {
  sys = sys || SYS_BY_CODE[inst.approval_code] || 'dxc';
  const f = parseForm(inst.form);
  const overall = OVERALL[String(inst.status || '').toUpperCase()] || 'in_progress';

  // Người đề xuất thật (widget riêng — submitter native là Long admin proxy do cross-tenant)
  const realName = f.pick('người đề xuất', 'nguoi de xuat', 'họ và tên', 'ho va ten') || null;
  const dept = f.pick('phòng ban', 'phong ban', 'department') || '—';

  // Steps từ task_list
  const tasks = Array.isArray(inst.task_list) ? inst.task_list.slice() : [];
  const ids = tasks.map(t => t.open_id || t.user_id).filter(Boolean);
  const users = resolveUsers(ids, 'open_id');
  let activeUsed = false;
  const steps = tasks.map((t, i) => {
    const raw = String(t.status || '').toUpperCase();
    let st;
    if (['APPROVED', 'DONE', 'TRANSFERRED', 'PASS'].includes(raw)) st = 'approved';
    else if (raw === 'REJECTED') st = 'rejected';
    else { // PENDING / RUNNING / chưa tới
      if (!activeUsed && overall === 'in_progress') { st = 'in_progress'; activeUsed = true; }
      else st = 'pending';
    }
    const uid = t.open_id || t.user_id;
    const u = uid ? (users[uid] || {}) : {};
    const auto = !uid;                       // node không có approver = hệ thống tự duyệt
    const name = auto ? 'Tự động duyệt' : (u.name || `Người duyệt cấp ${i + 1}`);
    const comment = asText(t.comment) || (Array.isArray(t.comment_list) && t.comment_list[0] && asText(t.comment_list[0].comment)) || (auto ? 'Hệ thống tự duyệt (node không có người duyệt)' : null);
    return {
      level: i + 1,
      role: t.node_name || `Cấp ${i + 1}`,
      name,
      initials: auto ? '⚙' : (u.initials || initials(name)),
      color: auto ? '#8F959E' : avatarColor(name),
      avatar: u.avatar || null,
      auto,
      status: st,
      time: st === 'approved' || st === 'rejected' ? fmtTime(t.end_time || t.update_time) : null,
      comment,
    };
  });

  // ── Field theo hệ ──
  const submitterTime = fmtTime(inst.start_time, true);
  let title, summary, type, amount, tags = [], meta = [], links = {}, lineItems = [];
  const idLabel = sys === 'dxc'
    ? (f.pick('lc-id', 'dxc-id', 'lc id', 'mã lc', 'ma lc') || inst.serial_number || inst.instance_code)
    : (f.pick('rq-id', 'mã đơn', 'ma don') || inst.serial_number || inst.instance_code);

  if (sys === 'dxc') {
    type = f.pick('loại đơn', 'loai don', 'loại', 'loai') || 'Đề Xuất Chi';
    summary = f.pick('mô tả lô chi', 'nội dung', 'noi dung', 'mô tả', 'mo ta', 'ndck') || '—';
    // Số tiền: tổng fieldList "Các khoản chi" (nhiều dòng K), fallback widget đơn lẻ
    const flTotal = f.sumList('các khoản chi', 'số tiền');
    const amtNum = flTotal != null ? flTotal
      : (() => { const a = f.pick('số tiền', 'so tien'); return a != null ? Number(String(a).replace(/[^\d.-]/g, '')) : null; })();
    const cur = f.pick('tiền tệ', 'tien te') || 'VND';
    amount = fmtAmount(amtNum, cur);
    // Chi tiết các dòng "Các khoản chi"
    const pickCell = (r, ...keys) => { for (const k of Object.keys(r)) { const nk = stripDiacritics(k).toLowerCase(); if (keys.some(kk => nk.includes(kk))) return r[k]; } return null; };
    lineItems = f.rows('các khoản chi').map(r => {
      const a = pickCell(r, 'số tiền', 'so tien');
      const n = a != null ? Number(String(a).replace(/[^\d.-]/g, '')) : null;
      return {
        desc: pickCell(r, 'mô tả', 'mo ta'),
        amount: (n != null && !isNaN(n)) ? fmtAmount(n, cur) : a,
        bank: pickCell(r, 'english bank', 'ngân hàng', 'bank'),
        stk: pickCell(r, 'stk', 'email'),
        owner: pickCell(r, 'chủ tài khoản', 'chu tai khoan', 'owner'),
      };
    });
    const tkc3 = f.pick('tk c3', 'tài khoản', 'tai khoan');
    const hanTT = f.pick('hạn thanh toán', 'han thanh toan', 'hạn tt');
    const ttQua = f.pick('tt qua', 'thanh toán qua', 'hình thức tt');
    title = `Đề Xuất Chi · ${idLabel}`;
    tags = [{ label: type, kind: 'type' }, amount && { label: amount, kind: 'amount' }, { label: idLabel, kind: 'id' }].filter(Boolean);
    meta = [
      ['Người gửi', realName],
      ['Phòng ban', dept],
      amount && ['Số tiền', amount],
      tkc3 && ['Tài khoản (C3)', tkc3],
      ['Thời gian gửi', submitterTime],
      hanTT && ['Hạn thanh toán', (fmtTime(hanTT, true) || hanTT).replace(/ 00:00$/, '')],
      ttQua && ['Thanh toán qua', ttQua],
      ['Nội dung', summary],
    ].filter(Boolean).map(([k, v]) => ({ label: k, value: v }));
    const qr = f.pick('link qr', 'qr');
    const rec = f.pick('link đxc', 'link dxc', '1a_link');
    if (qr) links.qr = qr;
    if (rec) links.record = rec;
  } else { // hr
    type = f.pick('loại đơn', 'loai don') || f.pick('nhóm đơn', 'nhom don') || 'Đơn từ';
    summary = f.pick('lý do', 'ly do') || '—';
    const bd = f.pick('ngày bắt đầu', 'ngay bat dau', 'từ ngày', 'tu ngay');
    const kt = f.pick('ngày kết thúc', 'ngay ket thuc', 'đến ngày', 'den ngay');
    const range = bd ? `${fmtTime(bd, true) || bd}${kt ? ' → ' + (fmtTime(kt, true) || kt) : ''}` : null;
    title = `${type}${realName ? ' · ' + realName : ''}`;
    tags = [{ label: type, kind: 'type' }, range && { label: range, kind: 'date' }, { label: idLabel, kind: 'id' }].filter(Boolean);
    meta = [
      ['Người gửi', realName],
      ['Phòng ban', dept],
      ['Loại đơn', type],
      range && ['Thời gian nghỉ', range],
      ['Thời gian gửi', submitterTime],
      ['Lý do', summary],
    ].filter(Boolean).map(([k, v]) => ({ label: k, value: v }));
  }

  return {
    instanceCode: inst.instance_code,
    id: idLabel,
    system: sys,
    status: overall,
    title,
    type,
    amount: amount || null,
    summary,
    submitter: { name: realName || '—', dept, time: submitterTime, initials: initials(realName || '?'), color: avatarColor(realName || idLabel) },
    tags,
    meta,
    steps,
    lineItems,
    links,
    updatedAt: nowStamp(),
  };
}

/* ─── DEMO canonical (cho /track?instance=DEMO — preview không cần instance thật) ── */
const DEMO = {
  instanceCode: 'DEMO', id: 'APP-2025-0612', system: 'dxc', status: 'in_progress',
  title: 'Đề xuất mua thiết bị văn phòng Q3', type: 'Mua sắm / Procurement', amount: '48.500.000 ₫',
  summary: 'Mua 5 màn hình 27" 4K, 3 bàn phím cơ, 1 laptop dự phòng cho team Dev.',
  submitter: { name: 'Nguyễn Minh Tuấn', dept: 'Operations', time: '06/06/2025 08:32', initials: 'NMT', color: '#1456F0' },
  tags: [{ label: 'Mua sắm / Procurement', kind: 'type' }, { label: '48.500.000 ₫', kind: 'amount' }, { label: 'APP-2025-0612', kind: 'id' }],
  meta: [
    { label: 'Người gửi', value: 'Nguyễn Minh Tuấn · Operations' },
    { label: 'Số tiền', value: '48.500.000 ₫' },
    { label: 'Thời gian gửi', value: '06/06/2025 08:32' },
    { label: 'Nội dung', value: 'Mua 5 màn hình 27" 4K, 3 bàn phím cơ, 1 laptop dự phòng cho team Dev.' },
  ],
  steps: [
    { level: 1, role: 'Quản lý trực tiếp', name: 'Trần Thị Lan', initials: 'TTL', color: '#1CB87E', status: 'approved', time: '06/06 09:14', comment: 'Đồng ý, cần thiết cho Q3.' },
    { level: 2, role: 'Kiểm soát tài chính', name: 'Lê Văn Hùng', initials: 'LVH', color: '#00AAFF', status: 'approved', time: '06/06 10:45', comment: 'Budget Q3 còn margin, approved.' },
    { level: 3, role: 'Giám đốc bộ phận', name: 'Phạm Quốc Dũng', initials: 'PQD', color: '#FF8800', status: 'in_progress', time: null, comment: null },
    { level: 4, role: 'CEO / Phê duyệt cuối', name: 'Ngô Thanh Hà', initials: 'NTH', color: '#8B5CF6', status: 'pending', time: null, comment: null },
  ],
  links: {}, updatedAt: 'demo',
};

/* ─── buildCard(canonical, trackUrl) → Lark Interactive Card (bare object) ── */
const HEADER_TPL = { in_progress: 'blue', approved: 'green', rejected: 'red', canceled: 'grey' };
const STATUS_LINE = { approved: '✅ **Đã duyệt** toàn bộ', in_progress: '🟡 **Đang duyệt**', rejected: '❌ **Đã từ chối**', canceled: '🚫 **Đã hủy**' };
const REC_ICON = { approved: '✅', in_progress: '🟡', rejected: '❌', pending: '⬜', canceled: '🚫' };

function buildCard(c, trackUrl) {
  const done = c.steps.filter(s => s.status === 'approved').length;
  const total = c.steps.length || 1;
  const current = c.steps.find(s => s.status === 'in_progress');
  let statusLine = STATUS_LINE[c.status] || '';
  if (current) statusLine += ` — chờ **${current.name}**`;
  statusLine += `  ·  **${done}/${total} cấp**`;

  const getMeta = l => (c.meta.find(m => m.label === l) || {}).value;
  const realName = getMeta('Người gửi') || c.submitter.name;

  // Card ĐƠN GIẢN (giống Lark Approval): status 1 dòng + vài field chính + nút Xem chi tiết
  const det = [
    `**${c.system === 'hr' ? 'Mã đơn' : 'LC-ID'}:** ${c.id}`,
    `**Loại đơn:** ${c.type}`,
    `**Người đề xuất:** ${realName}`,
  ];
  const dept = getMeta('Phòng ban'); if (dept) det.push(`**Phòng ban:** ${dept}`);
  const han = getMeta('Hạn thanh toán'); if (han) det.push(`**Hạn thanh toán:** ${han}`);

  const elements = [
    { tag: 'div', text: { tag: 'lark_md', content: statusLine } },
    { tag: 'div', text: { tag: 'lark_md', content: det.join('\n') } },
  ];
  if (trackUrl) elements.push({ tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: 'Xem chi tiết' }, type: 'primary', url: trackUrl }] });

  return {
    config: { wide_screen_mode: true },
    header: { template: HEADER_TPL[c.status] || 'blue', title: { tag: 'plain_text', content: c.title } },
    elements,
  };
}

/* ─── Gửi / cập nhật card cho nhân viên (im/v1/messages, tenant 1) ─────────── */
function receiveType(to) {
  if (/^ou_/.test(to)) return 'open_id';
  if (/^oc_/.test(to)) return 'chat_id';
  if (/@/.test(to)) return 'email';
  if (/^on_/.test(to)) return 'union_id';
  return 'user_id';
}

function sendCard(to, card) {
  const j = larkApi(PROFILE_IM, 'POST', '/open-apis/im/v1/messages',
    { params: { receive_id_type: receiveType(to) }, data: { receive_id: to, msg_type: 'interactive', content: JSON.stringify(card) } });
  const mid = j.data && j.data.message_id;
  if (!mid) throw new Error(`send fail code=${j.code} msg=${j.msg}`);
  return mid;
}

function patchCard(messageId, card) {
  const j = larkApi(PROFILE_IM, 'PATCH', `/open-apis/im/v1/messages/${messageId}`,
    { data: { content: JSON.stringify(card) } });
  if (j.code && j.code !== 0) throw new Error(`patch fail code=${j.code} msg=${j.msg}`);
  return true;
}

/* ─── List đơn theo user (trang chủ web app) ─────────────────────────────── */
const HR_BASE_T1 = 'DLewbVqU7aZM65sAW6mlcOpngse';   // base HR (37.1.1)
const HR_TBL = 'tblH5K1duVmQPmgO';
const TBL_20_NS = 'tbl0edSaPODwl2Ne';               // bảng 20 NS (cùng base 57)
const STATUS_NORM = { approved: 'approved', done: 'approved', pending: 'in_progress', reverted: 'in_progress', 'under review': 'in_progress', rejected: 'rejected', canceled: 'canceled', deleted: 'canceled' };
function normStatus(s) { return STATUS_NORM[String(s || '').toLowerCase()] || 'in_progress'; }
function searchT1(base, table, body, pageSize) {
  return larkApi(PROFILE_BASE_T1, 'POST', `/open-apis/bitable/v1/apps/${base}/tables/${table}/records/search`, { params: { page_size: pageSize || 200 }, data: body || {} });
}
function personName(v) { const o = (Array.isArray(v) ? v[0] : v) || {}; return o.name || o.en_name || ''; }
function personId(v) { const o = (Array.isArray(v) ? v[0] : v) || {}; return o.id || o.open_id || ''; }

// Email công ty → open_id tenant1 (qua bảng 20 NS) — null nếu không thấy
function resolveUserByEmail(email) {
  if (!email) return null;
  try {
    const j = searchT1(BASE_57, TBL_20_NS, { filter: { conjunction: 'and', conditions: [{ field_name: 'Email công ty', operator: 'is', value: [email] }] } }, 1);
    const it = (j.data && j.data.items || [])[0];
    return it ? (personId(it.fields['User Lark']) || null) : null;
  } catch { return null; }
}

// List đơn DXC + HR của 1 user (theo email). Không email → recent (demo).
function listApprovals(viewerEmail, limit) {
  limit = limit || 60;
  const openId = viewerEmail ? resolveUserByEmail(viewerEmail) : null;
  const reqCond = openId ? { filter: { conjunction: 'and', conditions: [{ field_name: 'Requester', operator: 'contains', value: [openId] }] } } : {};
  const items = [];
  try { // DXC bảng 57 (dedupe theo Instance)
    const dxc = searchT1(BASE_57, TBL_57, { ...reqCond, sort: [{ field_name: 'Ngày giờ tạo', desc: true }] });
    const seen = new Set();
    for (const it of (dxc.data && dxc.data.items || [])) {
      const f = it.fields; const inst = asText(f['Instance']); if (!inst || seen.has(inst)) continue; seen.add(inst);
      const id = (asText(f['DXC-ID']) || '').replace(/K\d+$/, '');
      const amt = asText(f['4F_Số tiền']); const cur = asText(f['4F_Tiền tệ']) || 'VND';
      items.push({ system: 'dxc', instance: inst, id, title: 'Đề Xuất Chi · ' + id, status: normStatus(asText(f['4L_Status của cả LC'])), requester: personName(f['Requester']), dept: asText(f['4F_Phòng ban']) || '—', sub: amt ? fmtAmount(Number(String(amt).replace(/[^\d.-]/g, '')), cur) : (asText(f['Mô tả Lô Chi']) || ''), time: asText(f['1F_Ngày giờ tạo (text)']) || '' });
    }
  } catch (e) { /* skip */ }
  try { // HR table
    const hr = searchT1(HR_BASE_T1, HR_TBL, reqCond);
    for (const it of (hr.data && hr.data.items || [])) {
      const f = it.fields; const inst = asText(f['1A_InstanceCode']); if (!inst) continue;
      items.push({ system: 'hr', instance: inst, id: asText(f['RQ-ID']) || '', title: asText(f['Loại đơn từ']) || 'Đơn từ', status: normStatus(asText(f['Status 2 (manual)'])), requester: asText(f['4L_Họ và tên']) || personName(f['Requester']), dept: asText(f['4L_Phòng ban']) || asText(f['1F_Phòng ban(text)']) || '—', sub: asText(f['Nhóm đơn từ']) || '', time: asText(f['Serial no.']) || '' });
    }
  } catch (e) { /* skip */ }
  items.sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')));
  return { viewer: viewerEmail || null, resolved: openId, count: items.length, items: items.slice(0, limit) };
}

module.exports = {
  PROFILE_APPROVAL, PROFILE_IM, SYS_BY_CODE,
  fetchInstance, normalize, buildCard, DEMO,
  resolveRequester, sendCard, patchCard, receiveType,
  getSent, putSent, resolveUsers,
  initials, avatarColor, fmtTime, nowStamp,
  listApprovals, resolveUserByEmail,
};
