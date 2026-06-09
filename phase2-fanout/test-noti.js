'use strict';
/**
 * TEST gửi 1 noti card về bot (kiểu CC'd như ảnh) + nút View Details → Web App (trang H5).
 * Gửi qua custom app org của user. KHÔNG đụng server :3100/:3200.
 *
 *   node test-noti.js [TENANT_KEY] [EMAIL] [INSTANCE_CODE]
 *   WEB_BASE=https://xxx.trycloudflare.com node test-noti.js
 */
process.env.PROVIDER_MODE = 'custom';

const { createClient } = require('./src/lark-client');
const { createTokenManager } = require('./src/token-manager');
const { createOpenIdResolver } = require('./src/resolve-open-id');
const { createMessageSender } = require('./src/send-message');
const { buildNotiCard } = require('./src/build-card');
const { createStore } = require('./src/json-store');

const TENANT_KEY = process.argv[2] || 'TENANT_ORG2';
const EMAIL = process.argv[3] || 'adminlark@isuccesscorp360.com';
const INSTANCE = process.argv[4] || 'DEMO';
const SYS = process.env.SYS || 'dxc';
const WEB_BASE = process.env.WEB_BASE || 'https://atrack.kntmcptools.online';
const detailUrl = process.env.DETAIL_URL || `${WEB_BASE}/track?instance=${encodeURIComponent(INSTANCE)}&sys=${SYS}`;

(async () => {
  createStore('open_id_cache').clear();
  const client = createClient();
  const tokenMgr = createTokenManager(client, 'custom');
  const resolver = createOpenIdResolver(client);
  const sender = createMessageSender(client);

  const card = buildNotiCard({
    title: 'Admin iSuccess 2 (KAI)\'s "[KAI] Đề xuất chi" — bạn được CC',
    requester: 'Admin iSuccess 2 (KAI)',
    role: 'Manager',
    details: [
      { label: 'LC-ID', value: INSTANCE },
      { label: 'Loại đơn', value: 'Thanh toán' },
      { label: 'Người đề xuất', value: 'Khoa NHT.DES' },
      { label: 'Phòng ban', value: 'AI engineer' },
      { label: 'Hạn thanh toán', value: 'Jun 08 2026' },
    ],
    detailUrl,
  });

  try {
    const token = await tokenMgr.getTenantToken(TENANT_KEY);
    console.log('① token OK');
    const openId = await resolver.resolveOpenId({ tenantKey: TENANT_KEY, businessId: EMAIL, token });
    console.log('② open_id OK →', openId);
    const messageId = await sender.sendCard({ token, openId, card });
    console.log('③ SEND OK → message_id =', messageId);
    console.log('\n✅ Đã gửi noti tới', EMAIL);
    console.log('   View Details →', detailUrl);
  } catch (e) {
    console.error('FAIL →', e.message, e.larkCode ? `(code ${e.larkCode})` : '');
    console.error('   body:', JSON.stringify(e.body || {}));
  }
})();
