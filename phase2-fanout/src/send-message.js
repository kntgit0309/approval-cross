'use strict';
/**
 * Gửi DM interactive card cho user (im/v1/messages, receive_id_type=open_id).
 * Token là tenant_access_token đúng org của user → bot hiện diện TRONG org đó mới gửi được
 * (ràng buộc cốt lõi plan §3).
 */
function createMessageSender(client) {
  async function sendCard({ token, openId, card }) {
    const r = await client.post('/open-apis/im/v1/messages?receive_id_type=open_id', {
      token,
      body: {
        receive_id: openId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    });
    return (r.data && r.data.message_id) || null;
  }
  return { sendCard };
}

module.exports = { createMessageSender };
