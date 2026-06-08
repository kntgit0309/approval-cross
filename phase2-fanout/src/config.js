'use strict';
/**
 * Cấu hình tập trung cho Phase 2 fan-out.
 * - PROVIDER_MODE = 'isv' | 'custom'  (đổi chế độ token = đổi 1 biến này, plan §4)
 * - LARK_HOST mặc định open.larksuite.com
 * - Đọc tenant_registry / user_directory / credentials từ config/.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_DIR = path.join(ROOT, 'config');
const DATA_DIR = path.join(ROOT, '.data');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw new Error(`config read fail ${file}: ${e.message}`);
  }
}

const config = {
  providerMode: (process.env.PROVIDER_MODE || 'custom').toLowerCase(), // 'isv' | 'custom' — chốt: custom (8 app)
  larkHost: process.env.LARK_HOST || 'https://open.larksuite.com',
  tokenTtlSafetyMs: 5 * 60 * 1000, // refresh token sớm 5' trước khi hết hạn

  // ISV: 1 app duy nhất cài lên 8 org
  isv: {
    appId: process.env.ISV_APP_ID || '',
    appSecret: process.env.ISV_APP_SECRET || '',
  },

  paths: { ROOT, CONFIG_DIR, DATA_DIR },

  loadTenantRegistry() {
    return readJson(path.join(CONFIG_DIR, 'tenant_registry.json')).orgs || [];
  },
  loadUserDirectory() {
    return readJson(path.join(CONFIG_DIR, 'user_directory.json')).users || [];
  },
  // credentials.json (custom mode) là optional — không có thì trả {} (test/ISV không cần).
  // CREDENTIALS_FILE override path (dùng cho test fixture).
  loadCredentials() {
    const f = process.env.CREDENTIALS_FILE || path.join(CONFIG_DIR, 'credentials.json');
    return readJson(f, { byTenant: {} }).byTenant || {};
  },
};

module.exports = config;
