'use strict';
/**
 * Dedupe theo (instance_code + status) để KHÔNG bắn trùng khi webhook/event retry (plan §10).
 */
const { createStore } = require('./json-store');
const store = createStore('idempotency');

function key(instanceCode, status) { return `${instanceCode}|${status}`; }

module.exports = {
  seen(instanceCode, status) { return store.has(key(instanceCode, status)); },
  mark(instanceCode, status, meta = {}) {
    store.set(key(instanceCode, status), { at: new Date().toISOString(), ...meta });
  },
  _store: store,
};
