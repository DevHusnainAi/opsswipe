import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { alertBody, alertKind } from '../_shared/alerts.ts';
import { verifyHex } from '../_shared/hmac.ts';
import { idsFromLink, pickDeployments, restartRailway, rollbackRailway } from '../_shared/railway.ts';
import { fromSentry } from '../_shared/sentry.ts';
import { actionsFor, validateTarget } from '../_shared/targets.ts';

Deno.test('alert webhooks: only Discord and Slack over https, so the field cannot reach anything else', () => {
  assertEquals(alertKind('https://discord.com/api/webhooks/123/abc'), 'discord');
  assertEquals(alertKind('https://hooks.slack.com/services/T0/B0/xyz'), 'slack');
  for (
    const bad of [
      'http://discord.com/api/webhooks/1/a', // not https
      'https://discord.com.evil.io/api/webhooks/1/a', // look-alike host
      'https://evil.io/?u=https://hooks.slack.com/services/x',
      'https://hooks.slack.com:8443/services/x', // odd port
      'https://user@discord.com/api/webhooks/1/a',
      'https://discord.com/channels/1', // not a webhook path
      'http://169.254.169.254/latest/meta-data',
      'not a url',
    ]
  ) assertEquals(alertKind(bad), null, bad);
  assertEquals(alertBody('discord', { title: 'api is failing', body: 'GET / → 500' }), {
    content: '**api is failing**\nGET / → 500',
  });
  assertEquals(alertBody('slack', { title: 'api is back up', body: 'Down 1m 2s.' }), {
    text: '*api is back up*\nDown 1m 2s.',
  });
});

const P = '0b6c4f7e-1d7a-4a8e-9f3b-2c1d0e9f8a7b', S = '1c7d5a8f-2e8b-4b9f-8a4c-3d2e1f0a9b8c';
const E = '2d8e6b9a-3f9c-4cab-9b5d-4e3f2a1b0c9d';

Deno.test('Railway ids come from the dashboard link; the target validates them as UUIDs', () => {
  const ids = idsFromLink(`https://railway.com/project/${P}/service/${S}?environmentId=${E}`);
  assertEquals(ids, { projectId: P, serviceId: S, environmentId: E });
  assertEquals(idsFromLink(`https://railway.com/project/${P}/service/${S}`), null, 'environment is required');
  const t = validateTarget('railway', { ...ids!, url: 'https://api.up.railway.app' });
  assertEquals(actionsFor(t), ['restart', 'rollback']);
  let threw = false;
  try {
    validateTarget('render', { serviceId: S, url: 'https://x' });
  } catch {
    threw = true;
  }
  assert(threw, 'a UUID is not a Render serviceId: each provider keeps its own format');
});

const deployments = [
  { id: 'd-new-failed', status: 'FAILED', createdAt: '2026-09-28T12:00:00Z' },
  { id: 'd-live', status: 'SUCCESS', createdAt: '2026-09-28T11:00:00Z' },
  { id: 'd-prev', status: 'SUCCESS', createdAt: '2026-09-28T10:00:00Z' },
];

Deno.test('Railway: restart the live deployment, roll back to the previous successful one', async () => {
  assertEquals(pickDeployments(deployments), { live: deployments[1], previous: deployments[2] });
  const sent: { query: string; variables: { id?: string } }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((_u: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sent.push(body);
    const data = body.query.includes('deployments(')
      ? { deployments: { edges: deployments.map((node) => ({ node })) } }
      : { ok: true };
    return Promise.resolve(Response.json({ data }));
  }) as typeof fetch;
  const t = { provider: 'railway' as const, projectId: P, serviceId: S, environmentId: E, url: 'https://x' };
  try {
    await restartRailway(t, 'tok');
    assertEquals(sent.at(-1)!.variables.id, 'd-live');
    await rollbackRailway(t, 'tok');
    assert(sent.at(-1)!.query.includes('deploymentRollback'));
    assertEquals(sent.at(-1)!.variables.id, 'd-prev');
  } finally {
    globalThis.fetch = real;
  }
  globalThis.fetch =
    (() => Promise.resolve(Response.json({ errors: [{ message: 'Not Authorized' }] }))) as typeof fetch;
  try {
    await assertRejects(() => restartRailway(t, 'bad'), Error, 'Not Authorized');
  } finally {
    globalThis.fetch = real;
  }
});

// Shape from https://docs.sentry.io/organization/integrations/integration-platform/webhooks/issue-alerts/
const alert = {
  action: 'triggered',
  data: {
    event: {
      title: "TypeError: Cannot read properties of undefined (reading 'total')",
      release: 'a'.repeat(40),
      request: { method: 'POST', url: 'https://api.example.com/checkout?token=abc&page=2', headers: [['Cookie', 'x']] },
      web_url: 'https://sentry.io/organizations/o/issues/1/',
    },
    triggered_rule: 'Errors on checkout',
  },
};

Deno.test('a Sentry alert becomes an incident with a replayable request, and no headers or secrets', () => {
  const r = fromSentry(alert)!;
  assertEquals(r.sample?.method, 'POST');
  assertEquals(r.sample?.path, '/checkout?token=REDACTED&page=2', 'credential-like query params are redacted');
  assertEquals(r.sample?.status, 500);
  assertEquals(r.release, 'a'.repeat(40));
  assert(r.metric.endsWith('(Sentry)'));
  assertEquals(fromSentry({ data: { event: { title: 'Job failed', request: null } } })?.sample, null);
  assertEquals(fromSentry({ data: {} }), null);
});

Deno.test('Sentry webhooks are verified with the integration Client Secret over the raw body', async () => {
  const secret = 'f'.repeat(64), raw = JSON.stringify(alert);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [
      'sign',
    ],
  );
  const hex = Array.from(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
  assert(await verifyHex(secret, raw, hex));
  assert(!(await verifyHex(secret, raw + ' ', hex)), 'a changed body fails');
  assert(!(await verifyHex('0'.repeat(64), raw, hex)), 'another secret fails');
  assert(!(await verifyHex(secret, raw, null)));
});
