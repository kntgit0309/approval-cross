'use strict';
/**
 * Handlers cho 2 event ISV bắt buộc (plan §5):
 *   - 'app_ticket'  : Lark push định kỳ → LƯU DB (app-ticket-store). Mất = chết hệ thống.
 *   - install/app added (event lúc org cài app) : bắt tenant_key → ghi tenant_registry.
 *
 * Dùng standalone, cắm vào route /event-isv riêng (KHÔNG đụng /event Phase 1).
 * Trả handled=true nếu đã xử lý, để server biết đáp { code: 0 }.
 */
const fs = require('fs');
const path = require('path');
const appTicketStore = require('./app-ticket-store');
const config = require('./config');

// Ghi/cập nhật tenant_key vào tenant_registry.json (idempotent theo tenant_key)
function upsertTenant(tenantKey, orgName) {
  if (!tenantKey) return;
  const file = path.join(config.paths.CONFIG_DIR, 'tenant_registry.json');
  const reg = JSON.parse(fs.readFileSync(file, 'utf8'));
  reg.orgs = reg.orgs || [];
  const found = reg.orgs.find((o) => o.tenant_key === tenantKey);
  if (found) { found.installed = true; if (orgName) found.org_name = orgName; }
  else reg.orgs.push({ org_name: orgName || `(tenant ${tenantKey})`, tenant_key: tenantKey, installed: true });
  fs.writeFileSync(file, JSON.stringify(reg, null, 2));
}

/**
 * body: payload event thô từ Lark (v1/v2). Trả { handled, type }.
 */
function handleIsvEvent(body) {
  if (!body) return { handled: false };

  // URL verification challenge
  if (body.type === 'url_verification' && body.challenge) {
    return { handled: true, type: 'url_verification', challenge: body.challenge };
  }

  const header = body.header || {};
  const ev = body.event || body;
  const eventType = header.event_type || body.type || (ev && ev.type);

  // app_ticket: { app_ticket } (v1 nằm ngoài, v2 trong event)
  const appTicket = body.app_ticket || (ev && ev.app_ticket);
  if (eventType === 'app_ticket' || appTicket) {
    if (appTicket) appTicketStore.save(appTicket);
    return { handled: true, type: 'app_ticket', saved: !!appTicket };
  }

  // Cài app / cấp quyền: tenant_key thường nằm ở header.tenant_key (v2)
  const tenantKey = header.tenant_key || (ev && ev.tenant_key) || body.tenant_key;
  if (eventType && /app.*(open|status_change|installed|uninstall)|p2p_chat_create/i.test(eventType) && tenantKey) {
    upsertTenant(tenantKey, header.app_id ? undefined : undefined);
    return { handled: true, type: 'install', tenantKey };
  }

  // Bất kỳ event nào mang tenant_key cũng cập nhật registry (plan §6: lấy từ header)
  if (tenantKey) { upsertTenant(tenantKey); return { handled: true, type: 'tenant_seen', tenantKey }; }

  return { handled: false };
}

module.exports = { handleIsvEvent, upsertTenant };
