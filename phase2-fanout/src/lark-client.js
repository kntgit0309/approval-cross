'use strict';
/**
 * Transport mỏng tới Lark Open API.
 * INJECTABLE: tất cả module dưới chỉ gọi client.post(...) — test bơm mock transport
 * vào đây để chạy OFFLINE, không đụng network / tenant thật.
 */
const config = require('./config');

// Transport thật: dùng fetch built-in của Node (>=18).
async function realTransport({ method, url, headers, body }) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, json };
}

function createClient(transport = realTransport, host = config.larkHost) {
  async function request(method, apiPath, { token, body, headers } = {}) {
    const url = apiPath.startsWith('http') ? apiPath : host + apiPath;
    const h = { ...(headers || {}) };
    if (token) h.Authorization = `Bearer ${token}`;
    const { status, json } = await transport({ method, url, headers: h, body });
    // Lark trả code !== 0 là lỗi nghiệp vụ (kể cả HTTP 200)
    if (json && typeof json.code === 'number' && json.code !== 0) {
      const err = new Error(`Lark API ${apiPath} code=${json.code} msg=${json.msg || ''}`);
      err.larkCode = json.code;
      err.httpStatus = status;
      err.body = json;
      throw err;
    }
    if (status >= 400) {
      const err = new Error(`Lark API ${apiPath} HTTP ${status}`);
      err.httpStatus = status;
      err.body = json;
      throw err;
    }
    return json;
  }
  return {
    post: (p, opts) => request('POST', p, opts),
    get: (p, opts) => request('GET', p, opts),
    _transport: transport,
  };
}

module.exports = { createClient, realTransport };
