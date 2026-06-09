'use strict';
/**
 * Mock transport — giả lập Lark Open API để test OFFLINE.
 * Không gọi network, không đụng tenant thật. Ghi lại mọi call để assert.
 *
 * Cấu hình:
 *   directory: { [tenantKey]: { [email|mobile]: open_id } }  — ai resolve ra open_id nào
 *   appTicketValid: bool — false → app_access_token trả lỗi (giả lập mất ticket)
 *   failTenants: Set<tenantKey> — token fetch lỗi cho org này
 */
function createMockTransport(opts = {}) {
  const directory = opts.directory || {};
  const state = {
    calls: [],
    appTicketValid: opts.appTicketValid !== false,
    failTenants: opts.failTenants || new Set(),
    resendCount: 0,
    sentMessages: [],
    msgSeq: 0,
  };

  async function transport({ method, url, headers, body }) {
    const apiPath = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    state.calls.push({ method, apiPath, body, auth: headers && headers.Authorization });

    const ok = (json) => ({ status: 200, json: { code: 0, msg: 'success', ...json } });
    const fail = (code, msg) => ({ status: 200, json: { code, msg } });

    // ----- ISV: app_access_token từ app_ticket -----
    if (apiPath === '/open-apis/auth/v3/app_access_token') {
      if (!state.appTicketValid) return fail(10012, 'app ticket invalid');
      if (!body.app_ticket) return fail(10012, 'missing app_ticket');
      return ok({ app_access_token: 'app-access-' + body.app_id, expire: 7200 });
    }
    // ----- ISV: tenant_access_token(tenant_key) -----
    if (apiPath === '/open-apis/auth/v3/tenant_access_token') {
      if (state.failTenants.has(body.tenant_key)) return fail(10013, 'tenant token denied');
      return ok({ tenant_access_token: `tok-isv-${body.tenant_key}`, expire: 7200 });
    }
    // ----- CUSTOM: tenant_access_token/internal từ app_id+secret -----
    if (apiPath === '/open-apis/auth/v3/tenant_access_token/internal') {
      return ok({ tenant_access_token: `tok-custom-${body.app_id}`, expire: 7200 });
    }
    // ----- resend app_ticket -----
    if (apiPath === '/open-apis/auth/v3/app_ticket/resend') {
      state.resendCount++;
      return ok({});
    }
    // ----- contact batch_get_id -----
    if (apiPath === '/open-apis/contact/v3/users/batch_get_id') {
      // suy tenant từ token "tok-...-<tenantKey>" hoặc "tok-custom-<appId>"
      const tk = (headers.Authorization || '').replace('Bearer tok-isv-', '').replace('Bearer ', '');
      const ids = [...(body.emails || []), ...(body.mobiles || [])];
      const user_list = ids.map((id) => {
        const dir = directory[tk] || mergedDir();
        const open_id = dir[id] || null;
        return open_id ? { open_id, email: id } : { email: id }; // không match → không open_id
      });
      return ok({ data: { user_list } });
    }
    // ----- im/v1/messages -----
    if (apiPath === '/open-apis/im/v1/messages') {
      const message_id = 'om_' + (++state.msgSeq);
      state.sentMessages.push({ receive_id: body.receive_id, content: body.content, message_id, auth: headers.Authorization });
      return ok({ data: { message_id } });
    }

    return { status: 404, json: { code: 99999, msg: 'mock: unknown path ' + apiPath } };
  }

  // gộp tất cả directory (khi không suy được tenant từ token, vd custom mode)
  function mergedDir() {
    return Object.assign({}, ...Object.values(directory));
  }

  return { transport, state };
}

module.exports = { createMockTransport };
