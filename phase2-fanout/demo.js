'use strict';
/**
 * Demo OFFLINE — chạy fan-out với mock transport, in ra card sẽ gửi.
 * Không network, không tenant thật.
 *
 *   node demo.js                      # mode custom (mặc định — 8 app riêng)
 *   PROVIDER_MODE=isv node demo.js    # mode ISV (1 app cài 8 org)
 */
const fs = require('fs');
const path = require('path');

const MODE = (process.env.PROVIDER_MODE || 'custom').toLowerCase();

// --- chuẩn bị credential cho mode được chọn (mock — không phải secret thật) ---
if (MODE === 'isv') {
  process.env.ISV_APP_ID = 'cli_isv_phase2';
  process.env.ISV_APP_SECRET = 'isv-secret';
} else {
  // custom: trỏ CREDENTIALS_FILE tới fixture demo (mock app_id/secret cho org 2)
  const credFile = path.join(__dirname, '.data', 'demo-credentials.json');
  fs.mkdirSync(path.dirname(credFile), { recursive: true });
  fs.writeFileSync(credFile, JSON.stringify({
    byTenant: { TENANT_ORG2: { app_id: 'cli_org2_custom', app_secret: 'secret-org2' } },
  }, null, 2));
  process.env.CREDENTIALS_FILE = credFile;
}

const { createMockTransport } = require('./test/mock-transport');
const { createFanout } = require('./src/fanout');
const appTicketStore = require('./src/app-ticket-store');
const idempotency = require('./src/idempotency');
const { createStore } = require('./src/json-store');

(async () => {
  // Reset state bền để demo luôn chạy 1 lượt mới (idempotency dedupe qua các lần chạy là CỐ Ý).
  idempotency._store.clear();
  createStore('open_id_cache').clear();

  if (MODE === 'isv') appTicketStore.save('demo-app-ticket'); // ISV cần app_ticket; custom thì không

  // Email thật: adminlark@isuccesscorp360.com (admin org 2 — iSuccess 2 KAI).
  // directory = "directory org 2 sẽ trả open_id này khi batch_get_id" (mock).
  const USER_EMAIL = 'adminlark@isuccesscorp360.com';
  const directory = {
    TENANT_ORG2: { [USER_EMAIL]: 'ou_adminlark_org2' },
  };
  const { transport, state } = createMockTransport({ directory });
  const fanout = createFanout({ transport, mode: MODE });

  const result = await fanout.notifyApprovalResult({
    instanceCode: 'DEMO-INST-001',
    status: 'APPROVED',
    businessId: USER_EMAIL,
    tenantKey: 'TENANT_ORG2', // org 2 (iSuccess 2 KAI) — xem config/tenant_registry.json
    card: {
      type: 'Đề Xuất Chi',
      title: 'LC2343',
      requester: 'Trần Thị B',
      dept: 'AMZ Eco',
      amount: '5,000,000 VND',
      content: 'Thanh toán dịch vụ tháng 6',
      detailUrl: 'https://base.larksuite.com/.../recXXXX',
    },
  });

  console.log(`\n=== MODE: ${MODE} ===`);
  console.log('\n=== KẾT QUẢ FAN-OUT ===');
  console.log(JSON.stringify(result, null, 2));
  console.log('\n=== CARD ĐÃ GỬI (tới', state.sentMessages[0].receive_id, 'qua', state.sentMessages[0].auth, ') ===');
  console.log(JSON.stringify(JSON.parse(state.sentMessages[0].content), null, 2));
  console.log('\n=== CHUỖI API CALL (thứ tự) ===');
  state.calls.forEach((c, i) => console.log(`${i + 1}. ${c.method} ${c.apiPath}`));
})();
