// node --test   (from infra/demo-web)
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createHmac } = require('node:crypto');
const { replayAll } = require('./replay.js');

async function startServer(env) {
  const port = 4000 + Math.floor(Math.random() * 1000);
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: port, CHAOS_KEY: 'k', ...env },
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${url}/livez`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  return { url, stop: () => proc.kill() };
}

test('replayAll: saved production failures pass on a healthy build and fail on a broken one', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replays-'));
  fs.writeFileSync(path.join(dir, 'abc1234.json'), JSON.stringify({
    reverts: 'abc1234',
    samples: [{ method: 'GET', path: '/', status: 500 }, { method: 'GET', path: '/livez', status: 503 }],
  }));
  const s = await startServer({});
  t.after(s.stop);

  assert.deepStrictEqual((await replayAll(s.url, dir)).passed, 2);
  await fetch(`${s.url}/chaos`, { method: 'POST', headers: { 'x-chaos-key': 'k' } });
  const broken = await replayAll(s.url, dir);
  assert.strictEqual(broken.total, 2);
  assert.strictEqual(broken.passed, 1, 'only /livez survives a wedged process');
  assert.strictEqual(broken.results[0].now, 503);
});

test('replayAll with no saved replays reports 0/0 (which OpsSwipe never treats as a pass)', async () => {
  const r = await replayAll('http://127.0.0.1:9', path.join(os.tmpdir(), 'does-not-exist'));
  assert.deepStrictEqual({ passed: r.passed, total: r.total }, { passed: 0, total: 0 });
});

test('a 5xx is reported to OpsSwipe with a valid signature and no headers', async (t) => {
  const got = [];
  const receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      got.push({ body, sig: req.headers['x-opsswipe-signature'] });
      res.end('ok');
    });
  }).listen(0);
  t.after(() => receiver.close());
  const s = await startServer({
    OPSSWIPE_REPORT_URL: `http://127.0.0.1:${receiver.address().port}/report`,
    REPORT_SECRET: 'shh',
    OPSSWIPE_TARGET: 'render-web',
  });
  t.after(s.stop);

  await fetch(`${s.url}/chaos`, { method: 'POST', headers: { 'x-chaos-key': 'k' } });
  assert.strictEqual((await fetch(`${s.url}/?page=2`, { headers: { cookie: 'session=secret' } })).status, 503);
  for (let i = 0; i < 40 && got.length === 0; i++) await new Promise((r) => setTimeout(r, 25));

  assert.strictEqual(got.length, 1);
  assert.deepStrictEqual(JSON.parse(got[0].body), { target: 'render-web', method: 'GET', path: '/?page=2', status: 503 });
  assert.strictEqual(got[0].sig, `sha256=${createHmac('sha256', 'shh').update(got[0].body).digest('hex')}`);
  assert.ok(!got[0].body.includes('secret'), 'cookies never leave the app');
});
