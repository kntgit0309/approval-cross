'use strict';
/**
 * KV bền tối giản trên 1 file JSON (stub cho "DB" trong plan).
 * Dùng cho: app_ticket store, idempotency, open_id cache ghi đè directory.
 * Production có thể thay bằng Redis/Postgres mà KHÔNG đụng caller (cùng interface get/set/del).
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');

function createStore(name) {
  const file = path.join(config.paths.DATA_DIR, `${name}.json`);
  function readAll() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  }
  function writeAll(obj) {
    fs.mkdirSync(config.paths.DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  }
  return {
    get(key) { return readAll()[key] ?? null; },
    set(key, val) { const all = readAll(); all[key] = val; writeAll(all); return val; },
    del(key) { const all = readAll(); delete all[key]; writeAll(all); },
    has(key) { return Object.prototype.hasOwnProperty.call(readAll(), key); },
    all() { return readAll(); },
    clear() { writeAll({}); },
  };
}

module.exports = { createStore };
