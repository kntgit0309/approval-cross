'use strict';
/**
 * TEST THẬT (gọi Lark) — custom app org 2. Gửi 1 card kết quả duyệt tới chính admin org 2
 * (adminlark@isuccesscorp360.com) để verify end-to-end. KHÔNG đụng server :3100/:3200.
 *
 *   node test-real.js
 *
 * Chạy từng bước để thấy rõ bước nào lỗi (token / resolve open_id / gửi message).
 */
process.env.PROVIDER_MODE = 'custom';

const { createClient } = require('./src/lark-client');
const { createTokenManager } = require('./src/token-manager');
const { createOpenIdResolver } = require('./src/resolve-open-id');
const { createMessageSender } = require('./src/send-message');
const { buildStatusCard } = require('./src/build-card');
const { createStore } = require('./src/json-store');

// node test-real.js [TENANT_KEY] [EMAIL]
// vd: node test-real.js TENANT_ORG5 someone@org5.com
const TENANT_KEY = process.argv[2] || 'TENANT_ORG2';   // selector nội bộ → tra credentials.json
const EMAIL = process.argv[3] || 'adminlark@isuccesscorp360.com';

function mask(t) { return t ? t.slice(0, 10) + '…(' + t.length + ' chars)' : '(none)'; }

(async () => {
  createStore('open_id_cache').clear(); // resolve tươi để test thật

  const client = createClient(); // transport THẬT (fetch → open.larksuite.com)
  const tokenMgr = createTokenManager(client, 'custom');
  const resolver = createOpenIdResolver(client);
  const sender = createMessageSender(client);

  // --- Bước 1: lấy tenant_access_token từ app_id/secret ---
  let token;
  try {
    token = await tokenMgr.getTenantToken(TENANT_KEY);
    console.log('① TOKEN OK   →', mask(token));
  } catch (e) {
    console.error('① TOKEN FAIL →', e.message, e.larkCode ? `(code ${e.larkCode})` : '');
    console.error('   body:', JSON.stringify(e.body || {}));
    return;
  }

  // --- Bước 2: resolve open_id từ email qua batch_get_id ---
  let openId;
  try {
    openId = await resolver.resolveOpenId({ tenantKey: TENANT_KEY, businessId: EMAIL, token });
    console.log('② OPEN_ID OK →', openId);
  } catch (e) {
    console.error('② OPEN_ID FAIL →', e.message, e.larkCode ? `(code ${e.larkCode})` : '');
    console.error('   body:', JSON.stringify(e.body || {}));
    return;
  }

  // --- Bước 3: gửi card kết quả duyệt (DM) ---
  const card = buildStatusCard('APPROVED', {
    type: 'Đề Xuất Chi',
    title: 'TEST-REAL',
    requester: 'Admin Org 2',
    dept: 'Test',
    amount: '1,000,000 VND',
    content: 'Test fan-out Phase 2 (custom app org 2)',
    detailUrl: 'https://base.larksuite.com/',
  });
  try {
    const messageId = await sender.sendCard({ token, openId, card });
    console.log('③ SEND OK    → message_id =', messageId);
    console.log('\n✅ THÀNH CÔNG — kiểm tra Lark của', EMAIL, 'sẽ thấy card "✅ Đề Xuất Chi đã được duyệt — TEST-REAL"');
  } catch (e) {
    console.error('③ SEND FAIL →', e.message, e.larkCode ? `(code ${e.larkCode})` : '');
    console.error('   body:', JSON.stringify(e.body || {}));
  }
})();
