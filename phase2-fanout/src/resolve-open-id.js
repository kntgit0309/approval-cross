'use strict';
/**
 * business_id (email/SĐT) → open_id trong org của user, qua contact/v3/users/batch_get_id.
 * LƯU Ý (plan §6): email/SĐT ở trung tâm phải khớp attribute trong directory org nhà user
 * thì batch_get_id mới ra open_id. Cache lại open_id để khỏi gọi lại.
 */
const { createStore } = require('./json-store');
const cache = createStore('open_id_cache'); // key: `${tenantKey}|${businessId}` -> open_id

function cacheKey(tenantKey, businessId) { return `${tenantKey}|${businessId}`; }

function looksLikeEmail(s) { return typeof s === 'string' && s.includes('@'); }

function createOpenIdResolver(client) {
  // businessId: email hoặc SĐT. token: tenant_access_token đúng org.
  async function resolveOpenId({ tenantKey, businessId, token }) {
    if (!businessId) throw new Error('resolveOpenId: thiếu business_id');
    const key = cacheKey(tenantKey, businessId);
    const hit = cache.get(key);
    if (hit) return hit;

    const body = looksLikeEmail(businessId)
      ? { emails: [businessId] }
      : { mobiles: [businessId] };

    const r = await client.post('/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id', {
      token,
      body,
    });
    const list = (r.data && r.data.user_list) || [];
    const found = list.find((u) => u.user_id || u.open_id);
    const openId = found && (found.open_id || found.user_id);
    if (!openId) {
      const e = new Error(`open_id không resolve được cho ${businessId} (tenant=${tenantKey}) — kiểm tra email/SĐT khớp directory org`);
      e.code = 'OPEN_ID_NOT_FOUND';
      throw e;
    }
    cache.set(key, openId);
    return openId;
  }

  return { resolveOpenId, _cache: cache };
}

module.exports = { createOpenIdResolver };
