import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import { isActive } from '../_shared/entitlement.ts';
import { resetInstance, type ServiceAccount, signJwt } from '../_shared/gcp.ts';
import { restartService } from '../_shared/render.ts';
import { actionsFor, parseTargets } from '../_shared/targets.ts';

const b64 = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

async function testServiceAccount() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----\n`;
  return { sa: { client_email: 'bot@p.iam.gserviceaccount.com', private_key: pem } as ServiceAccount, pair };
}

// Swap globalThis.fetch for one test; returns the calls it saw.
function mockFetch(respond: (url: string) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(respond(String(url)));
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

Deno.test('parseTargets accepts both providers', () => {
  const t = parseTargets(JSON.stringify({
    vm: { provider: 'gcp', project: 'p', zone: 'us-central1-a', instance: 'i', url: 'http://1.2.3.4/' },
    web: { provider: 'render', serviceId: 'srv-1', url: 'https://x.onrender.com/' },
  }));
  assertEquals(Object.keys(t), ['vm', 'web']);
  assertEquals(actionsFor(t.vm), ['reset']);
  assertEquals(actionsFor(t.web), ['restart', 'rollback']);
  assertEquals(actionsFor({ provider: 'render', serviceId: 'srv-1', url: 'u', repo: 'me/app' }), [
    'restart',
    'rollback',
    'revert_pr',
    'merge_pr',
  ]);
});

Deno.test('parseTargets rejects bad config instead of running with a hole in the allowlist', () => {
  assertThrows(() => parseTargets('[]'), Error, 'JSON object');
  assertThrows(() => parseTargets('{"x":{"provider":"aws","url":"u"}}'), Error, 'unknown provider');
  assertThrows(() => parseTargets('{"x":{"provider":"render","url":"u"}}'), Error, 'missing serviceId');
  assertThrows(
    () => parseTargets('{"x":{"provider":"render","serviceId":"s","url":"u","repo":"nope"}}'),
    Error,
    'owner/name',
  );
  assertEquals(parseTargets(''), {});
});

Deno.test('signJwt produces a verifiable RS256 token with the claims Google expects', async () => {
  const { sa, pair } = await testServiceAccount();
  const jwt = await signJwt(sa, 1_000);
  const [h, c, s] = jwt.split('.');
  assertEquals(JSON.parse(b64(h)), { alg: 'RS256', typ: 'JWT' });
  assertEquals(JSON.parse(b64(c)), {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: 1_000,
    exp: 4_600,
  });
  const sig = Uint8Array.from(b64(s), (ch) => ch.charCodeAt(0));
  assert(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, sig, new TextEncoder().encode(`${h}.${c}`)));
});

Deno.test('resetInstance exchanges a token then resets exactly the configured VM', async () => {
  const { sa } = await testServiceAccount();
  const f = mockFetch((url) =>
    url.includes('oauth2')
      ? Response.json({ access_token: 'tok', expires_in: 3600 })
      : Response.json({ kind: 'compute#operation' })
  );
  try {
    await resetInstance({ provider: 'gcp', project: 'p', zone: 'z', instance: 'vm1', url: 'u' }, sa);
  } finally {
    f.restore();
  }
  assertEquals(f.calls.length, 2);
  assertEquals(f.calls[1].url, 'https://compute.googleapis.com/compute/v1/projects/p/zones/z/instances/vm1/reset');
  assertEquals(new Headers(f.calls[1].init?.headers).get('Authorization'), 'Bearer tok');
});

Deno.test('restartService calls the Render restart endpoint and surfaces failures', async () => {
  let f = mockFetch(() => new Response(null, { status: 200 }));
  try {
    await restartService('srv-1', 'key');
  } finally {
    f.restore();
  }
  assertEquals(f.calls[0].url, 'https://api.render.com/v1/services/srv-1/restart');
  assertEquals(f.calls[0].init?.method, 'POST');
  assertEquals(new Headers(f.calls[0].init?.headers).get('Authorization'), 'Bearer key');

  f = mockFetch(() => new Response('nope', { status: 403 }));
  try {
    await assertRejects(() => restartService('srv-1', 'bad'), Error, 'render restart 403');
  } finally {
    f.restore();
  }
});

Deno.test('isActive: lifetime, future and expired entitlements', () => {
  const now = new Date('2026-09-27T00:00:00Z');
  assert(isActive({ expires_date: null }, now));
  assert(isActive({ expires_date: '2026-10-27T00:00:00Z' }, now));
  assert(!isActive({ expires_date: '2026-09-01T00:00:00Z' }, now));
  assert(!isActive(undefined, now));
});
