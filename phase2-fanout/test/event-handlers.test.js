'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
// .data riêng cho process test này → tránh race với file test khác chạy song song
process.env.PHASE2_DATA_DIR = path.join(require('os').tmpdir(), `phase2-test-events-${process.pid}`);
const { handleIsvEvent } = require('../src/event-handlers');
const appTicketStore = require('../src/app-ticket-store');

// upsertTenant ghi vào config/tenant_registry.json → snapshot & restore để không bẩn file commit.
const REGISTRY = path.join(__dirname, '..', 'config', 'tenant_registry.json');
const REGISTRY_BAK = fs.readFileSync(REGISTRY, 'utf8');
test.after(() => fs.writeFileSync(REGISTRY, REGISTRY_BAK));

test('url_verification → trả challenge', () => {
  const out = handleIsvEvent({ type: 'url_verification', challenge: 'abc123' });
  assert.equal(out.handled, true);
  assert.equal(out.challenge, 'abc123');
});

test('event app_ticket (v2) → lưu vào store', () => {
  appTicketStore.clear();
  const out = handleIsvEvent({
    header: { event_type: 'app_ticket' },
    event: { app_ticket: 'ticket-xyz' },
  });
  assert.equal(out.handled, true);
  assert.equal(out.type, 'app_ticket');
  assert.equal(appTicketStore.get(), 'ticket-xyz');
});

test('app_ticket dạng v1 (ngoài event) → lưu', () => {
  appTicketStore.clear();
  const out = handleIsvEvent({ type: 'app_ticket', app_ticket: 'tk-v1' });
  assert.equal(out.handled, true);
  assert.equal(appTicketStore.get(), 'tk-v1');
});

test('event mang tenant_key (header) → handled tenant_seen', () => {
  const out = handleIsvEvent({ header: { event_type: 'some_event', tenant_key: 'TENANT_NEW' }, event: {} });
  assert.equal(out.handled, true);
  assert.ok(['tenant_seen', 'install'].includes(out.type));
  assert.equal(out.tenantKey, 'TENANT_NEW');
});

test('payload không liên quan → handled=false', () => {
  const out = handleIsvEvent({ header: { event_type: 'im.message.receive_v1' }, event: {} });
  assert.equal(out.handled, false);
});
