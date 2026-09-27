// OpsSwipe demo target: healthy until POST /chaos wedges it, like a hung process.
// Only a restart clears it, which is exactly what OpsSwipe's Render action does.
// /livez always answers so Render's own health check doesn't auto-heal it before a human approves.
const http = require('node:http');
const { createHmac, timingSafeEqual } = require('node:crypto');

// Bad-release demo: commit this as false and push. Render deploys it, the health check fails,
// and OpsSwipe offers "Roll back" (restores the last good deploy) and "Revert PR" (fixes main).
const RELEASE_OK = true;

const KEY = Buffer.from(process.env.CHAOS_KEY ?? '');
const bootedAt = new Date().toISOString();
let wedged = false;

const keyOk = (given = '') => {
  const g = Buffer.from(given);
  return KEY.length > 0 && g.length === KEY.length && timingSafeEqual(g, KEY);
};

const page = `<!doctype html><meta name=viewport content="width=device-width"><title>opsswipe-demo-web</title>
<body style="background:#0A0A0A;color:#10B981;font:22px monospace;display:grid;place-items:center;height:100vh;margin:0">
<div>&#9679; opsswipe-demo-web is up<br><small style="color:#A1A1AA">process started ${bootedAt}</small></div>`;

// Event-driven detection: every 5xx is reported to OpsSwipe the moment it happens (signed, fire-and-forget).
// Only method, path and status are sent; headers and cookies never leave the app.
function reportFailure(req, status) {
  const url = process.env.OPSSWIPE_REPORT_URL;
  const secret = process.env.REPORT_SECRET;
  if (!url || !secret) return;
  const body = JSON.stringify({ target: process.env.OPSSWIPE_TARGET || 'render-web', method: req.method, path: req.url, status });
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-opsswipe-signature': signature }, body })
    .catch(() => {});
}

function fail(req, res, status, text) {
  reportFailure(req, status);
  return res.writeHead(status).end(text);
}

http.createServer((req, res) => {
  if (req.url === '/livez') return res.writeHead(200).end('alive\n');
  if (req.method === 'POST' && req.url === '/chaos') {
    if (!keyOk(req.headers['x-chaos-key'])) return res.writeHead(403).end('forbidden\n');
    wedged = true;
    return res.writeHead(200).end('wedged until restart\n');
  }
  if (!RELEASE_OK) return fail(req, res, 500, 'bad release\n');
  if (wedged) return fail(req, res, 503, 'service wedged\n');
  res.writeHead(200, { 'content-type': 'text/html' }).end(page);
}).listen(process.env.PORT || 3000);
