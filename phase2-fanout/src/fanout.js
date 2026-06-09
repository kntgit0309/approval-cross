'use strict';
/**
 * Orchestrator Phase 2 — luồng fan-out (plan §7).
 * Hook vào ĐÚNG result-handler Phase 1 (chỗ nhận status + instance_code về Base).
 *
 *   notifyApprovalResult({ instanceCode, status, businessId, tenantKey, card })
 *     1. idempotency: skip nếu (instance_code+status) đã bắn
 *     2. getTenantToken(tenant_key) → token đúng org      [token-manager, không biết ISV/custom]
 *     3. resolveOpenId(business_id) → open_id (cache)      [contact batch_get_id]
 *     4. buildStatusCard(status, card)                     [xanh duyệt / đỏ từ chối]
 *     5. sendCard(token, open_id, card) → DM trong org user [im/v1/messages]
 *     6. mark idempotency
 *
 * Trả về kết quả structured để caller log/giám sát; KHÔNG ném lỗi ra ngoài
 * (fan-out là phụ trợ — không được làm hỏng result-handler chính).
 */
const { createClient } = require('./lark-client');
const { createTokenManager } = require('./token-manager');
const { createOpenIdResolver } = require('./resolve-open-id');
const { createMessageSender } = require('./send-message');
const { buildStatusCard } = require('./build-card');
const idempotency = require('./idempotency');

// deps injectable cho test: { transport, mode, idempotency }
function createFanout(deps = {}) {
  const client = deps.client || createClient(deps.transport);
  const tokenMgr = deps.tokenManager || createTokenManager(client, deps.mode);
  const resolver = deps.resolver || createOpenIdResolver(client);
  const sender = deps.sender || createMessageSender(client);
  const idem = deps.idempotency || idempotency;

  async function notifyApprovalResult({ instanceCode, status, businessId, tenantKey, card }) {
    const ctx = { instanceCode, status, tenantKey, businessId };
    try {
      if (!instanceCode || !status) return { ok: false, skipped: 'missing instanceCode/status', ctx };
      if (idem.seen(instanceCode, status)) return { ok: true, skipped: 'duplicate', ctx };
      if (!tenantKey || !businessId) {
        return { ok: false, skipped: 'missing tenantKey/businessId — record Base cần field org/tenant + business_id', ctx };
      }

      const token = await tokenMgr.getTenantToken(tenantKey);
      const openId = await resolver.resolveOpenId({ tenantKey, businessId, token });
      const builtCard = buildStatusCard(status, card || {});
      const messageId = await sender.sendCard({ token, openId, card: builtCard });

      idem.mark(instanceCode, status, { openId, messageId });
      return { ok: true, openId, messageId, mode: tokenMgr.mode, ctx };
    } catch (e) {
      return { ok: false, error: e.message, code: e.code || null, ctx };
    }
  }

  return { notifyApprovalResult, _client: client, _tokenManager: tokenMgr };
}

module.exports = { createFanout };
