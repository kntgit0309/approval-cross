'use strict';
/**
 * H5 Approval Center server — LOCAL preview (port 3300, KHÔNG đụng :3100/:3200).
 *
 *   GET /center                     → Approval Center 3-pane (sidebar + list + detail)
 *   GET /approval?instance=<code>   → trang detail standalone (deep-link từ card)
 *   GET /api/instances              → danh sách đơn (sidebar groups + list items)
 *   GET /api/instance/:code         → JSON timeline 1 đơn (normalize)
 *   GET /detail-render.js, /detail.css  → static
 *
 * Mode: MOCK (mặc định, fixtures) | REAL=1 (nối Approval API tenant trung tâm — sau).
 *   node h5/server.js   → http://127.0.0.1:3300/center
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.H5_PORT ? Number(process.env.H5_PORT) : 3300;
const REAL = process.env.REAL === '1';
const DIR = __dirname;
const FX = path.join(DIR, 'fixtures');

const STATIC = {
  '/center':           ['approval-center.html', 'text/html; charset=utf-8'],
  '/approval':         ['approval-detail.html', 'text/html; charset=utf-8'],
  '/':                 ['approval-center.html', 'text/html; charset=utf-8'],
  '/detail-render.js': ['detail-render.js',     'application/javascript; charset=utf-8'],
  '/detail.css':       ['detail.css',           'text/css; charset=utf-8'],
};

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8' });
  res.end(body);
}

async function getInstanceJson(code) {
  if (!REAL) {
    const d = JSON.parse(fs.readFileSync(path.join(FX, 'rq031.json'), 'utf8'));
    if (code && code !== 'demo') d.id = code;
    return d;
  }
  const { getApprovalInstance } = require('../src/approval-instance');
  return getApprovalInstance(code);
}
function getListJson() {
  return JSON.parse(fs.readFileSync(path.join(FX, 'list.json'), 'utf8'));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    const st = STATIC[url.pathname];
    if (req.method === 'GET' && st) {
      return send(res, 200, fs.readFileSync(path.join(DIR, st[0]), 'utf8'), st[1]);
    }
    if (req.method === 'GET' && url.pathname === '/api/instances') {
      return send(res, 200, JSON.stringify(getListJson()));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/instance/')) {
      const code = decodeURIComponent(url.pathname.slice('/api/instance/'.length));
      return send(res, 200, JSON.stringify(await getInstanceJson(code)));
    }
    return send(res, 404, JSON.stringify({ error: 'not found' }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`H5 Approval Center: http://127.0.0.1:${PORT}/center  (mode=${REAL ? 'REAL' : 'MOCK'})`);
});
