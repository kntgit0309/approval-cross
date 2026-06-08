'use strict';
/**
 * Provider CUSTOM (phương án B — 8 app): tra (app_id, app_secret) của org trong
 * credentials.json → tenant_access_token/internal THẲNG. KHÔNG cần app_ticket.
 * appId trong key cache lấy theo từng org → cache vẫn đúng hình dạng (app_id, tenant_key).
 */
const config = require('../config');

function createCustomProvider(client) {
  const creds = config.loadCredentials(); // { tenant_key: {app_id, app_secret} }

  function credFor(tenantKey) {
    const c = creds[tenantKey];
    if (!c || !c.app_id || !c.app_secret) {
      const e = new Error(`custom credential thiếu cho tenant_key=${tenantKey} (điền config/credentials.json)`);
      e.code = 'CREDENTIAL_MISSING';
      throw e;
    }
    return c;
  }

  return {
    mode: 'custom',
    // appId thay đổi theo org → token-manager hỏi để dựng cache key
    appIdFor(tenantKey) { return credFor(tenantKey).app_id; },
    async resendAppTicket() { /* custom không có app_ticket — no-op */ },
    async fetchTenantToken(tenantKey) {
      const c = credFor(tenantKey);
      const r = await client.post('/open-apis/auth/v3/tenant_access_token/internal', {
        body: { app_id: c.app_id, app_secret: c.app_secret },
      });
      return { token: r.tenant_access_token, expiresInSec: r.expire || 7200 };
    },
  };
}

module.exports = { createCustomProvider };
