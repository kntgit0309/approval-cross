'use strict';
/**
 * Cache tenant_access_token theo key (app_id, tenant_key), TTL ~2h (plan §10).
 * In-memory (token sống ngắn, mất cache chỉ tốn 1 round-trip refresh — không như app_ticket).
 */
const config = require('./config');
const mem = new Map(); // key -> { token, expMs }

function k(appId, tenantKey) { return `${appId}|${tenantKey}`; }

module.exports = {
  get(appId, tenantKey, now = Date.now()) {
    const e = mem.get(k(appId, tenantKey));
    if (!e) return null;
    if (now >= e.expMs - config.tokenTtlSafetyMs) return null; // sắp hết hạn → coi như miss
    return e.token;
  },
  // expiresInSec = trường 'expire' Lark trả (giây). Mặc định 2h nếu thiếu.
  set(appId, tenantKey, token, expiresInSec = 7200, now = Date.now()) {
    mem.set(k(appId, tenantKey), { token, expMs: now + expiresInSec * 1000 });
    return token;
  },
  clear() { mem.clear(); },
};
