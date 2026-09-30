// OpsSwipe demo target: healthy until POST /chaos wedges it, like a hung process.
// Only a restart clears it (Render restart, or a reset of the demo VM, infra/demo-box.sh).
// /livez always answers so a platform health check doesn't auto-heal it before a human approves.
const http = require('node:http');
const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

// Bad-release demo: commit this as false and push (infra/chaos.sh release). It breaks only the
// pricing API, a path the tests don't cover, so CI passes and deploys it, like a real regression.
// Requests fail, and OpsSwipe offers a revert or AI fix PR, proven in CI before it can merge.
const RELEASE_OK = true;

const CHAOS_KEY = process.env.CHAOS_KEY ?? '';
const digest = (s) => createHash('sha256').update(s).digest(); // same length both sides: no length leak
const bootedAt = new Date().toISOString();
let wedged = false;

const keyOk = (given = '') => CHAOS_KEY.length > 0 && timingSafeEqual(digest(given), digest(CHAOS_KEY));

const page = `<!doctype html><meta name=viewport content="width=device-width"><title>opsswipe-demo-web</title>
<body style="background:#0A0A0A;color:#10B981;font:22px monospace;display:grid;place-items:center;height:100vh;margin:0">
<div>&#9679; opsswipe-demo-web is up<br><small style="color:#A1A1AA">process started ${bootedAt}</small>
<br><small id=price style="color:#A1A1AA"></small></div>
<script>fetch('/api/price').then((r) => r.json()).then((p) => (price.textContent = 'Pro: $' + p.price + '/mo'))
  .catch(() => (price.textContent = 'pricing unavailable'))</script>`;

// Event-driven detection: every 5xx is reported to OpsSwipe the moment it happens (signed, fire-and-forget).
// On Google Cloud, OpsSwipe writes the report URL and secret onto this VM's metadata when the VM is connected (and
// again when a new secret is issued), so they're read from the metadata server, cached for a minute: nothing to
// copy, and a new secret takes effect without a restart. Elsewhere (Render) they come from OPSSWIPE_REPORT_URL and
// REPORT_SECRET. Only method, path and status are sent; headers and cookies never leave the app.
const META = 'http://metadata.google.internal/computeMetadata/v1/instance/attributes/';
let fromVm = { at: 0, url: '', secret: '' };
async function reportConfig() {
  if (Date.now() - fromVm.at > 60_000) {
    const get = (key) =>
      fetch(META + key, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(1000) })
        .then((r) => (r.ok ? r.text() : ''), () => '');
    const [url, secret] = await Promise.all([get('opsswipe-report-url'), get('report-secret')]);
    fromVm = { at: Date.now(), url, secret };
  }
  return fromVm.url && fromVm.secret
    ? fromVm
    : { url: process.env.OPSSWIPE_REPORT_URL, secret: process.env.REPORT_SECRET };
}

async function reportFailure(req, status) {
  const { url, secret } = await reportConfig();
  if (!url || !secret) return;
  // release = the deployed commit (the demo VM sets GIT_SHA; Render and Railway set their own).
  const release = process.env.GIT_SHA || process.env.RENDER_GIT_COMMIT || process.env.RAILWAY_GIT_COMMIT_SHA;
  const body = JSON.stringify({ method: req.method, path: req.url, status, release });
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-opsswipe-signature': signature }, body })
    .catch(() => {});
}

function fail(req, res, status, text) {
  reportFailure(req, status).catch(() => {});
  return res.writeHead(status).end(text);
}

http.createServer((req, res) => {
  if (req.url === '/livez') return res.writeHead(200).end('alive\n');
  if (req.method === 'POST' && req.url === '/chaos') {
    if (!keyOk(req.headers['x-chaos-key'])) return res.writeHead(403).end('forbidden\n');
    wedged = true;
    return res.writeHead(200).end('wedged until restart\n');
  }
  if (wedged) return fail(req, res, 503, 'service wedged\n');
  if (req.url === '/api/price') {
    if (!RELEASE_OK) return fail(req, res, 500, 'bad release\n');
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ plan: 'pro', price: 9 }));
  }
  res.writeHead(200, { 'content-type': 'text/html' }).end(page);
}).listen(process.env.PORT || 3000);
