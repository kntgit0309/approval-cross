'use strict';
/**
 * Provider ISV: app_ticket → app_access_token → tenant_access_token(tenant_key).
 * 1 app cài lên cả 8 org. tenant_key phân biệt org khi xin token.
 */
const config = require('../config');
const appTicketStore = require('../app-ticket-store');

function createIsvProvider(client) {
  // Lấy app_access_token từ app_ticket hiện có
  async function getAppAccessToken() {
    const appTicket = appTicketStore.get();
    if (!appTicket) {
      const e = new Error('ISV app_ticket missing — chưa nhận event app_ticket hoặc đã mất. Cần resend.');
      e.code = 'APP_TICKET_MISSING';
      throw e;
    }
    const r = await client.post('/open-apis/auth/v3/app_access_token', {
      body: {
        app_id: config.isv.appId,
        app_secret: config.isv.appSecret,
        app_ticket: appTicket,
      },
    });
    return r.app_access_token;
  }

  // Gọi Lark resend app_ticket (cứu khi mất ticket) — Lark sẽ push lại qua event.
  async function resendAppTicket() {
    await client.post('/open-apis/auth/v3/app_ticket/resend', {
      body: { app_id: config.isv.appId, app_secret: config.isv.appSecret },
    });
  }

  return {
    mode: 'isv',
    appId: config.isv.appId,
    resendAppTicket,
    // Trả { token, expiresInSec }
    async fetchTenantToken(tenantKey) {
      const appAccessToken = await getAppAccessToken();
      const r = await client.post('/open-apis/auth/v3/tenant_access_token', {
        body: { app_access_token: appAccessToken, tenant_key: tenantKey },
      });
      return { token: r.tenant_access_token, expiresInSec: r.expire || 7200 };
    },
  };
}

module.exports = { createIsvProvider };
