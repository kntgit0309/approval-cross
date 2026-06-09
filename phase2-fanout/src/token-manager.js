'use strict';
/**
 * NGUYÊN TẮC SỐ 1 (plan §4): cô lập tầng token sau 1 interface duy nhất.
 *
 *     getTenantToken(tenant_key) -> token
 *
 * Toàn bộ phần dưới (resolve open_id, dựng card, gửi message) chỉ gọi hàm này,
 * KHÔNG biết đang chạy ISV hay custom. Đổi ISV ↔ 8 app = swap provider + đổ bảng
 * credential, KHÔNG đụng logic fan-out / card.
 */
const config = require('./config');
const tokenCache = require('./token-cache');
const { createIsvProvider } = require('./providers/isv');
const { createCustomProvider } = require('./providers/custom');

function selectProvider(client, mode = config.providerMode) {
  if (mode === 'custom') return createCustomProvider(client);
  if (mode === 'isv') return createIsvProvider(client);
  throw new Error(`PROVIDER_MODE không hợp lệ: ${mode} (dùng 'isv' | 'custom')`);
}

function createTokenManager(client, mode = config.providerMode) {
  const provider = selectProvider(client, mode);

  // appId dùng cho cache key: ISV cố định 1 app; custom đổi theo org.
  function appIdFor(tenantKey) {
    return provider.appIdFor ? provider.appIdFor(tenantKey) : provider.appId;
  }

  async function getTenantToken(tenantKey, { forceRefresh = false } = {}) {
    if (!tenantKey) throw new Error('getTenantToken: thiếu tenant_key');
    const appId = appIdFor(tenantKey);

    if (!forceRefresh) {
      const cached = tokenCache.get(appId, tenantKey);
      if (cached) return cached;
    }

    try {
      const { token, expiresInSec } = await provider.fetchTenantToken(tenantKey);
      return tokenCache.set(appId, tenantKey, token, expiresInSec);
    } catch (e) {
      // ISV: mất app_ticket → thử resend 1 lần rồi báo lỗi rõ ràng (ticket về async qua event).
      if (e.code === 'APP_TICKET_MISSING' && provider.resendAppTicket) {
        await provider.resendAppTicket().catch(() => {});
        const e2 = new Error('app_ticket missing — đã gọi resend, chờ Lark push lại event app_ticket rồi retry');
        e2.code = 'APP_TICKET_RESENT';
        throw e2;
      }
      throw e;
    }
  }

  return { mode: provider.mode, getTenantToken, provider };
}

module.exports = { createTokenManager, selectProvider };
