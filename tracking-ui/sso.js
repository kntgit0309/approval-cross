#!/usr/bin/env node
/**
 * sso.js — Lark 免登 (auto-login) cho web app: đổi authCode → email viewer.
 *
 * Đọc credential + directory từ sso-config.json (GITIGNORED, chỉ trên server, perm 600):
 *   { "host":"open.larksuite.com",
 *     "org2": { "app_id":"cli_...", "app_secret":"..." },
 *     "directory": { "Tên hiển thị org2": "email@...", ... } }   // fallback name→email
 *
 * Flow: authCode (từ JSSDK requestAuthCode) → app_access_token → oidc/access_token
 *       → user_info (open_id, name, email). Email lấy từ user_info; nếu app thiếu
 *       scope email → fallback map name→email trong directory.
 */
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

let CFG = null;
try { CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'sso-config.json'), 'utf8')); } catch { CFG = null; }
const HOST = (CFG && CFG.host) || 'open.larksuite.com';

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

let _tok = { v: null, exp: 0 };
async function appToken() {
  if (_tok.v && Date.now() < _tok.exp) return _tok.v;
  const j = await reqJson('POST', '/open-apis/auth/v3/app_access_token/internal', { app_id: CFG.org2.app_id, app_secret: CFG.org2.app_secret });
  if (j.code !== 0) throw new Error('app_access_token: ' + (j.msg || j.code));
  _tok = { v: j.app_access_token, exp: Date.now() + ((j.expire || 7200) - 120) * 1000 };
  return _tok.v;
}

// authCode → { open_id, name, en_name, email|null }
async function exchangeCode(code) {
  const at = await appToken();
  const j = await reqJson('POST', '/open-apis/authen/v1/oidc/access_token', { grant_type: 'authorization_code', code }, { Authorization: 'Bearer ' + at });
  if (j.code !== 0) throw new Error('oidc/access_token: ' + (j.msg || j.code));
  const userTok = j.data && j.data.access_token;
  const info = await reqJson('GET', '/open-apis/authen/v1/user_info', null, { Authorization: 'Bearer ' + userTok });
  const d = (info && info.data) || {};
  return { open_id: d.open_id, name: d.name, en_name: d.en_name, email: d.email || d.enterprise_email || null };
}

function dirLookup(name) {
  const dir = (CFG && CFG.directory) || {};
  if (!name) return null;
  return dir[name] || dir[String(name).trim()] || null;
}

// authCode → { email, name, open_id, source }
async function resolveViewer(code) {
  const u = await exchangeCode(code);
  let email = u.email, source = 'user_info';
  if (!email) { email = dirLookup(u.name) || dirLookup(u.en_name); source = email ? 'directory' : 'none'; }
  return { email: email || null, name: u.name || null, open_id: u.open_id || null, source };
}

module.exports = { resolveViewer, exchangeCode, appToken, configured: !!(CFG && CFG.org2 && CFG.org2.app_id), appId: CFG && CFG.org2 && CFG.org2.app_id };
