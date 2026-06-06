#!/usr/bin/env node
/**
 * tracking-ui/send.js — Gửi card theo dõi phê duyệt cho nhân viên (CLI)
 *
 * Dùng:
 *   node send.js <instance_code> <to> [sys]
 *     <instance_code>  UUID instance trên Approval [KAI]  (vd lấy từ field Instance bảng 57 / 1A_InstanceCode bảng 35V2)
 *     <to>             open_id (ou_…) / user_id / email / chat_id (oc_…) của nhân viên trên tenant 1 iSuccess
 *     [sys]            hr | dxc  (mặc định auto theo approval_code)
 *
 * Ví dụ:
 *   node send.js 9F1B…-UUID ou_abc123 dxc
 *   node send.js 9F1B…-UUID info.khoa@isuccess.vn
 *
 * Card gửi xong được lưu vào store.json để server.js tự PATCH khi status đổi.
 * Chạy độc lập — không cần server.js đang chạy (nhưng cần lark-cli profile tenant2 + cli_a80df38cc639d02f).
 */
'use strict';

const lib = require('./lib');
const TRACK_BASE_URL = process.env.TRACK_BASE_URL || 'https://atrack.kntmcptools.online';

function trackUrlFor(code, sys) {
  return `${TRACK_BASE_URL}/track?instance=${encodeURIComponent(code)}${sys ? '&sys=' + encodeURIComponent(sys) : ''}`;
}

async function main() {
  const [code, to, sys] = process.argv.slice(2);
  if (!code || !to) {
    console.error('Usage: node send.js <instance_code> <to: ou_…|user_id|email|oc_…> [hr|dxc]');
    process.exit(1);
  }

  const inst = lib.fetchInstance(code);
  const data = lib.normalize(inst, sys || lib.SYS_BY_CODE[inst.approval_code]);
  const card = lib.buildCard(data, trackUrlFor(code, data.system));
  const messageId = lib.sendCard(to, card);
  lib.putSent(code, { message_id: messageId, receive_id: to, sys: data.system });

  console.log(JSON.stringify({
    ok: true, instance: code, system: data.system, status: data.status,
    to, receive_id_type: lib.receiveType(to),
    message_id: messageId, track_url: trackUrlFor(code, data.system),
  }, null, 2));
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
