// node --test infra/demo-web/
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');

test('healthy -> chaos needs the key -> wedged until restart', async (t) => {
  const port = 3000 + Math.floor(Math.random() * 1000);
  const proc = spawn(process.execPath, [`${__dirname}/server.js`], { env: { ...process.env, PORT: port, CHAOS_KEY: 's3cret' } });
  t.after(() => proc.kill());
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${url}/livez`); break; } catch { await new Promise((r) => setTimeout(r, 50)); }
  }

  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(`${url}/chaos`, { method: 'POST', headers: { 'x-chaos-key': 'wrong' } })).status, 403);
  assert.equal((await fetch(url)).status, 200, 'a bad key must not break the service');
  assert.equal((await fetch(`${url}/chaos`, { method: 'POST', headers: { 'x-chaos-key': 's3cret' } })).status, 200);
  assert.equal((await fetch(url)).status, 503);
  assert.equal((await fetch(`${url}/livez`)).status, 200, 'liveness stays up so only OpsSwipe heals it');
});

test('a 5xx is reported to OpsSwipe with a valid signature and no headers', async (t) => {
  const http = require('node:http');
  const { createHmac } = require('node:crypto');
  const got = [];
  const receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      got.push({ url: req.url, body, sig: req.headers['x-opsswipe-signature'] });
      res.end('ok');
    });
  }).listen(0);
  t.after(() => receiver.close());

  const port = 5000 + Math.floor(Math.random() * 1000);
  const proc = spawn(process.execPath, [`${__dirname}/server.js`], {
    env: {
      ...process.env,
      PORT: port,
      CHAOS_KEY: 'k',
      REPORT_SECRET: 'shh',
      GIT_SHA: 'a'.repeat(40),
      OPSSWIPE_REPORT_URL: `http://127.0.0.1:${receiver.address().port}/report?service=abc`,
    },
  });
  t.after(() => proc.kill());
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${url}/livez`); break; } catch { await new Promise((r) => setTimeout(r, 50)); }
  }

  await fetch(`${url}/chaos`, { method: 'POST', headers: { 'x-chaos-key': 'k' } });
  assert.equal((await fetch(`${url}/?page=2`, { headers: { cookie: 'session=secret' } })).status, 503);
  for (let i = 0; i < 40 && got.length === 0; i++) await new Promise((r) => setTimeout(r, 25));

  assert.equal(got.length, 1);
  assert.equal(got[0].url, '/report?service=abc', 'the report URL from the app identifies the service');
  assert.deepEqual(JSON.parse(got[0].body), { method: 'GET', path: '/?page=2', status: 503, release: 'a'.repeat(40) });
  assert.equal(got[0].sig, `sha256=${createHmac('sha256', 'shh').update(got[0].body).digest('hex')}`);
  assert.ok(!got[0].body.includes('secret'), 'cookies never leave the app');
});
