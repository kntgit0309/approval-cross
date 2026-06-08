'use strict';
/**
 * Test OFFLINE end-to-end cho Phase 2 fan-out. Không network, không tenant thật.
 *   node --test
 */
// Env phải set TRƯỚC khi require config (config đọc env lúc load).
process.env.ISV_APP_ID = 'cli_isv_phase2';
process.env.ISV_APP_SECRET = 'isv-secret';
const path = require('path');
process.env.CREDENTIALS_FILE = path.join(__dirname, 'fixtures', 'credentials.test.json');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const { createMockTransport } = require('./mock-transport');
const { createFanout } = require('../src/fanout');
const appTicketStore = require('../src/app-ticket-store');
const tokenCache = require('../src/token-cache');
const idempotency = require('../src/idempotency');
const { createStore } = require('../src/json-store');

// fixture credentials cho custom mode
fs.mkdirSync(path.join(__dirname, 'fixtures'), { recursive: true });
fs.writeFileSync(
  process.env.CREDENTIALS_FILE,
  JSON.stringify({ byTenant: {
    TENANT_ORG1: { app_id: 'cli_org1', app_secret: 's1' },
    TENANT_ORG2: { app_id: 'cli_org2', app_secret: 's2' },
  } }, null, 2)
);

const DIRECTORY = {
  TENANT_ORG1: { 'nv001@isuccesscorp360.com': 'ou_user1' },
  TENANT_ORG2: { 'nv002@org2.com': 'ou_user2' },
};

function resetState() {
  appTicketStore.clear();
  tokenCache.clear();
  idempotency._store.clear();
  createStore('open_id_cache').clear();
}

test.beforeEach(resetState);

test('ISV: fan-out APPROVED tới đúng user trong org của họ', async () => {
  appTicketStore.save('ticket-abc'); // Lark đã push app_ticket
  const { transport, state } = createMockTransport({ directory: DIRECTORY });
  const fanout = createFanout({ transport, mode: 'isv' });

  const r = await fanout.notifyApprovalResult({
    instanceCode: 'INST-1', status: 'APPROVED',
    businessId: 'nv001@isuccesscorp360.com', tenantKey: 'TENANT_ORG1',
    card: { type: 'Đơn xin phép', title: 'RQ-001', requester: 'Nguyễn Văn A', detailUrl: 'https://base/rec1' },
  });

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.openId, 'ou_user1');
  assert.equal(r.mode, 'isv');
  // gửi đúng token org1
  const msg = state.sentMessages[0];
  assert.equal(msg.receive_id, 'ou_user1');
  assert.equal(msg.auth, 'Bearer tok-isv-TENANT_ORG1');
  // card xanh
  const card = JSON.parse(msg.content);
  assert.equal(card.header.template, 'green');
});

test('Idempotency: cùng instance+status bắn lần 2 bị skip', async () => {
  appTicketStore.save('ticket-abc');
  const { transport, state } = createMockTransport({ directory: DIRECTORY });
  const fanout = createFanout({ transport, mode: 'isv' });
  const payload = { instanceCode: 'INST-2', status: 'REJECTED', businessId: 'nv001@isuccesscorp360.com', tenantKey: 'TENANT_ORG1', card: {} };

  const r1 = await fanout.notifyApprovalResult(payload);
  const r2 = await fanout.notifyApprovalResult(payload);
  assert.equal(r1.ok, true);
  assert.equal(r2.skipped, 'duplicate');
  assert.equal(state.sentMessages.length, 1, 'chỉ gửi 1 lần');
});

test('Token cache: 2 noti cùng org chỉ fetch token 1 lần', async () => {
  appTicketStore.save('ticket-abc');
  const { transport, state } = createMockTransport({ directory: DIRECTORY });
  const fanout = createFanout({ transport, mode: 'isv' });
  await fanout.notifyApprovalResult({ instanceCode: 'A', status: 'APPROVED', businessId: 'nv001@isuccesscorp360.com', tenantKey: 'TENANT_ORG1', card: {} });
  await fanout.notifyApprovalResult({ instanceCode: 'B', status: 'APPROVED', businessId: 'nv001@isuccesscorp360.com', tenantKey: 'TENANT_ORG1', card: {} });
  const tokenFetches = state.calls.filter(c => c.apiPath === '/open-apis/auth/v3/tenant_access_token').length;
  assert.equal(tokenFetches, 1, 'token phải cache theo (app_id, tenant_key)');
});

test('open_id cache: business_id resolve 1 lần, lần sau lấy cache', async () => {
  appTicketStore.save('ticket-abc');
  const { transport, state } = createMockTransport({ directory: DIRECTORY });
  const fanout = createFanout({ transport, mode: 'isv' });
  await fanout.notifyApprovalResult({ instanceCode: 'A', status: 'APPROVED', businessId: 'nv001@isuccesscorp360.com', tenantKey: 'TENANT_ORG1', card: {} });
  await fanout.notifyApprovalResult({ instanceCode: 'B', status: 'REJECTED', businessId: 'nv001@isuccesscorp360.com', tenantKey: 'TENANT_ORG1', card: {} });
  const resolves = state.calls.filter(c => c.apiPath === '/open-apis/contact/v3/users/batch_get_id').length;
  assert.equal(resolves, 1, 'open_id phải cache');
});

test('ISV mất app_ticket → resend được gọi, trả code APP_TICKET_RESENT', async () => {
  // KHÔNG save app_ticket
  const { transport, state } = createMockTransport({ directory: DIRECTORY });
  const fanout = createFanout({ transport, mode: 'isv' });
  const r = await fanout.notifyApprovalResult({ instanceCode: 'X', status: 'APPROVED', businessId: 'nv001@isuccesscorp360.com', tenantKey: 'TENANT_ORG1', card: {} });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'APP_TICKET_RESENT');
  assert.equal(state.resendCount, 1, 'phải gọi resend app_ticket');
});

test('Swap provider ISV → CUSTOM: fan-out vẫn chạy, KHÔNG đụng logic dưới', async () => {
  // custom KHÔNG cần app_ticket
  const { transport, state } = createMockTransport({ directory: DIRECTORY });
  const fanout = createFanout({ transport, mode: 'custom' });
  const r = await fanout.notifyApprovalResult({
    instanceCode: 'C1', status: 'APPROVED',
    businessId: 'nv002@org2.com', tenantKey: 'TENANT_ORG2', card: { type: 'ĐXC' },
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.mode, 'custom');
  assert.equal(r.openId, 'ou_user2');
  // token từ app_id custom của org2
  assert.equal(state.sentMessages[0].auth, 'Bearer tok-custom-cli_org2');
});

test('Resolve thất bại (email không khớp directory) → báo lỗi OPEN_ID_NOT_FOUND, không gửi', async () => {
  appTicketStore.save('ticket-abc');
  const { transport, state } = createMockTransport({ directory: DIRECTORY });
  const fanout = createFanout({ transport, mode: 'isv' });
  const r = await fanout.notifyApprovalResult({ instanceCode: 'Z', status: 'APPROVED', businessId: 'unknown@x.com', tenantKey: 'TENANT_ORG1', card: {} });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'OPEN_ID_NOT_FOUND');
  assert.equal(state.sentMessages.length, 0);
});

test('Thiếu tenantKey/businessId → skip có lý do rõ ràng (không ném lỗi)', async () => {
  const { transport } = createMockTransport({ directory: DIRECTORY });
  const fanout = createFanout({ transport, mode: 'isv' });
  const r = await fanout.notifyApprovalResult({ instanceCode: 'M', status: 'APPROVED' });
  assert.equal(r.ok, false);
  assert.match(r.skipped, /business_id/);
});
