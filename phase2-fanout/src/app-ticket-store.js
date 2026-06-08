'use strict';
/**
 * app_ticket = SINGLE POINT OF FAILURE của ISV (plan §10).
 * Lark push app_ticket qua event định kỳ → LƯU DB (không giữ RAM).
 * Mất ticket = chết toàn hệ thống → có resend API để cứu (gọi ở token-manager).
 */
const { createStore } = require('./json-store');
const store = createStore('app_ticket');

const KEY = 'current';

module.exports = {
  // Gọi từ event handler khi Lark push event 'app_ticket'
  save(appTicket) {
    store.set(KEY, { app_ticket: appTicket, saved_at: new Date().toISOString() });
    return appTicket;
  },
  get() {
    const v = store.get(KEY);
    return v && v.app_ticket;
  },
  clear() { store.del(KEY); },
};
