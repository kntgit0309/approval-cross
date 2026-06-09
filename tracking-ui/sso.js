#!/usr/bin/env node
/**
 * sso.js — Lark 免登 (auto-login) cho web app, MULTI-ORG: đổi authCode → email viewer.
 *
 * Đọc credential + directory từ sso-config.json (GITIGNORED, chỉ trên server, perm 600):
 *   { "host":"open.larksuite.com", "defaultOrg":"org2",
 *     "apps": { "org2": {"app_id","app_secret"}, "org5": {...} },
 *     "directory": { "Tên hiển thị": "email@...", ... } }   // fallback name→email
 *
 * Mỗi org = 1 custom app riêng → page truyền ?org= (set theo Home URL của từng app).
 * Flow: authCode → app_access_token(org) → oidc/access_token → user_info → email
 *       (fallback name→email qua directory nếu app thiếu scope email).
 */
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

let CFG = null;
try { CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'sso-config.json'), 'utf8')); } catch { CFG = null; }
const HOST = (CFG && CFG.host) || 'open.larksuite.com';
const DEFAULT_ORG = (CFG && CFG.defaultOrg) || 'org2';
const APPS = (CFG && CFG.apps) || {};

function appFor(org) { return APPS[org] || APPS[DEFAULT_ORG] || null; }
function appIdFor(org) { const a = appFor(org); return a && a.app_id || null; }
function orgs() { return Object.keys(APPS); }

function reqJson(method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const h = { Accept: 'application/json', ...(headers || {}) };
    if (data) { h['Content-Type'] = 'application/json; charset=utf-8'; h['Content-Length'] = Buffer.byteLength(data); }
    const r = https.request({ host: HOST, path: p, method, headers: h }, x => {
      let b = ''; x.on('data', c => b += c); x.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error('bad json from ' + p)); } });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

const _tok = {};   // org → { v, exp }
async function appToken(org) {
  const app = appFor(org);
  if (!app) throw new Error('org không cấu hình: ' + org);
  const c = _tok[org];
  if (c && c.v && Date.now() < c.exp) return c.v;
  const j = await reqJson('POST', '/open-apis/auth/v3/app_access_token/internal', { app_id: app.app_id, app_secret: app.app_secret });
  if (j.code !== 0) throw new Error('app_access_token(' + org + '): ' + (j.msg || j.code));
  _tok[org] = { v: j.app_access_token, exp: Date.now() + ((j.expire || 7200) - 120) * 1000 };
  return _tok[org].v;
}

// authCode → { open_id, name, en_name, email|null }
async function exchangeCode(code, org) {
  const at = await appToken(org);
  const j = await reqJson('POST', '/open-apis/authen/v1/oidc/access_token', { grant_type: 'authorization_code', code }, { Authorization: 'Bearer ' + at });
  if (j.code !== 0) throw new Error('oidc/access_token: ' + (j.msg || j.code));
  const userTok = j.data && j.data.access_token;
  const info = await reqJson('GET', '/open-apis/authen/v1/user_info', null, { Authorization: 'Bearer ' + userTok });
  const d = (info && info.data) || {};
  return { open_id: d.open_id, name: d.name, en_name: d.en_name, email: d.email || d.enterprise_email || null };
}

// open_id → email qua contact API (theo USER LARK, KHÔNG theo tên — tên dễ trùng/sai)
async function emailByOpenId(openId, org) {
  if (!openId) return null;
  const at = await appToken(org);
  const j = await reqJson('GET', '/open-apis/contact/v3/users/' + encodeURIComponent(openId) + '?user_id_type=open_id', null, { Authorization: 'Bearer ' + at });
  const usr = (j && j.data && j.data.user) || {};
  return usr.email || usr.enterprise_email || null;
}

// authCode → { email, name, open_id, org, source }. Email lấy theo user Lark:
// user_info (chính chủ token) → nếu trống thì open_id→contact API. KHÔNG match theo tên.
async function resolveViewer(code, org) {
  org = org || DEFAULT_ORG;
  const u = await exchangeCode(code, org);
  let email = u.email, source = 'user_info';
  if (!email) {
    try { email = await emailByOpenId(u.open_id, org); source = email ? 'contact_api' : 'none'; }
    catch (e) { source = 'none'; }
  }
  return { email: email || null, name: u.name || null, open_id: u.open_id || null, org, source };
}

module.exports = { resolveViewer, exchangeCode, appToken, appIdFor, orgs, defaultOrg: DEFAULT_ORG, configured: !!(CFG && CFG.apps && Object.keys(CFG.apps).length) };
