'use strict';
// DRY-RUN TOÀN BỘ: verify 96 email đã map + dò email cho nhân viên active còn thiếu.
// CHỈ ĐỌC (tenant token + contact/batch_get_id). KHÔNG gửi message nào.
process.env.PROVIDER_MODE = 'custom';
const fs = require('fs');
const { createClient } = require('./src/lark-client');
const { createTokenManager } = require('./src/token-manager');

const eo = JSON.parse(fs.readFileSync(process.env.HOME + '/phase2-fanout/config/email-org.json', 'utf8'));
const ns = JSON.parse(fs.readFileSync('/tmp/ns20.json', 'utf8'));

const strip = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[đĐ]/g, 'd').toLowerCase();
const prefixOf = (larkName) => strip(larkName.split('.')[0]).replace(/[^a-z0-9]/g, '');
// key so khớp: bỏ dấu, bỏ hậu tố dept, sort chữ cái initials để chịu lỗi đảo (PLB/LPB)
const nameKey = (s) => {
  const p = strip((s || '').split('.')[0]).trim().replace(/[^a-z\s]/g, '');
  const toks = p.split(/\s+/).filter(Boolean);
  if (!toks.length) return '';
  const given = toks[0];
  const initials = toks.slice(1).join('').split('').sort().join('');
  return given + '|' + initials;
};
const fullNameKey = (full) => {
  const toks = strip(full).replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  if (!toks.length) return '';
  const given = toks[toks.length - 1];
  const initials = toks.slice(0, -1).map(t => t[0]).sort().join('');
  return given + '|' + initials;
};
const emailPrefixFromFull = (full) => {
  const toks = strip(full).replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  if (!toks.length) return '';
  return toks[toks.length - 1] + toks.slice(0, -1).map(t => t[0]).join('');
};

// map key → email đã có
const mappedKeys = new Map();
for (const [uname, info] of Object.entries(eo.byUsername)) {
  mappedKeys.set(nameKey(uname), info);
}
const orgOf = (s) => { const m = (s || '').match(/Org\s*(\d)/i); return m ? 'org' + m[1] : null; };

const active = ns.filter(r => r.status === 'Đang làm việc' && !/admin/i.test(r.name));
const missing = [];
for (const r of active) {
  const keys = [nameKey(r.lark_name), fullNameKey(r.name)].filter(Boolean);
  if (keys.some(k => mappedKeys.has(k))) continue;
  missing.push(r);
}

const SUFFIXES = ['sup','pur','ets','des','amz','mkt','leg','web','hr','rnd','acc','mba','tv','kt','dev','spf','media','pnp','sp','est','ceo','tk','sale'];
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

(async () => {
  const client = createClient();
  const tokenMgr = createTokenManager(client, 'custom');
  const ORGS = ['org2','org3','org4','org5','org6','org7','org8'];
  const tokens = {};
  console.log('=== [1] TOKEN 7 ORG ===');
  for (const org of ORGS) {
    const tenant = 'TENANT_ORG' + org.slice(3);
    try { tokens[org] = await tokenMgr.getTenantToken(tenant); console.log('  ✅ ' + org + ' token OK'); }
    catch (e) { console.log('  ✗ ' + org + ' token FAIL: ' + e.message.slice(0, 80)); }
  }

  async function batchResolve(org, emails) {
    const out = new Map();
    for (const part of chunk(emails, 50)) {
      try {
        const r = await client.post('/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id', {
          token: tokens[org], body: { emails: part } });
        for (const u of (r.data && r.data.user_list) || []) {
          if (u.user_id) out.set(u.email, u.user_id);
        }
      } catch (e) { console.log('    ! batch err ' + org + ': ' + e.message.slice(0, 80)); }
    }
    return out;
  }

  console.log('\n=== [2] VERIFY ' + Object.keys(eo.byEmail).length + ' EMAIL ĐÃ MAP (batch_get_id, không gửi) ===');
  const byOrgEmails = {};
  for (const [em, org] of Object.entries(eo.byEmail)) (byOrgEmails[org] = byOrgEmails[org] || []).push(em);
  const badMapped = [];
  for (const org of ORGS) {
    const emails = byOrgEmails[org] || [];
    if (!tokens[org]) { console.log('  ' + org + ': SKIP (no token)'); continue; }
    const res = await batchResolve(org, emails);
    const fail = emails.filter(e => !res.has(e));
    console.log('  ' + org + ': ' + res.size + '/' + emails.length + ' resolve OK' + (fail.length ? '  ✗ FAIL: ' + fail.join(', ') : ''));
    fail.forEach(f => badMapped.push({ org, email: f }));
  }

  console.log('\n=== [3] DÒ EMAIL CHO ' + missing.length + ' NHÂN VIÊN CHƯA MAP ===');
  const found = [], notFound = [];
  for (const r of missing) {
    const org = orgOf(r.org);
    const prefixes = [];
    if (r.lark_name && r.lark_name.includes('.')) prefixes.push(prefixOf(r.lark_name));
    const pf = emailPrefixFromFull(r.name); if (pf && !prefixes.includes(pf)) prefixes.push(pf);
    const cands = [];
    for (const p of prefixes) { if (p) { for (const s of SUFFIXES) cands.push(p + '.' + s + '@isuccesscorp360.com'); cands.push(p + '@isuccesscorp360.com'); } }
    const orgsToTry = org ? [org] : ORGS;
    let hit = null;
    for (const o of orgsToTry) {
      if (!tokens[o]) continue;
      const res = await batchResolve(o, cands);
      if (res.size) { hit = { org: o, email: [...res.keys()][0], open_id: [...res.values()][0] }; break; }
    }
    if (hit) { found.push({ name: r.name, lark_name: r.lark_name, ...hit }); console.log('  ✅ ' + r.name + ' (' + (r.org || '?') + ') → ' + hit.email + ' @' + hit.org); }
    else { notFound.push(r); console.log('  ✗  ' + r.name + ' (' + (r.org || 'org trống') + ') — không dò ra email trong ' + orgsToTry.join('/')); }
  }

  console.log('\n=== TỔNG KẾT DRY-RUN ===');
  console.log('  Email đã map resolve FAIL: ' + badMapped.length);
  console.log('  Nhân viên thiếu map — DÒ RA: ' + found.length + ' | KHÔNG dò ra: ' + notFound.length);
  fs.writeFileSync('/tmp/dryrun-report.json', JSON.stringify({ badMapped, found, notFound }, null, 1));
  console.log('  Report: /tmp/dryrun-report.json');
})();
