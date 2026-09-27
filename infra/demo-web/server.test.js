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
