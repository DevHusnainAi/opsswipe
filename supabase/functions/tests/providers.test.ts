import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import { isActive, planFromEvent, proFromRow } from '../_shared/entitlement.ts';
import { timingSafeEqual } from '../_shared/hmac.ts';
import { resetInstance, type ServiceAccount, signJwt } from '../_shared/gcp.ts';
import { restartService } from '../_shared/render.ts';
import { actionsFor, validateTarget } from '../_shared/targets.ts';

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

Deno.test('validateTarget accepts both providers and maps the fixes each allows', () => {
  const vm = validateTarget('gcp', {
    project: 'my-proj-1',
    zone: 'us-central1-a',
    instance: 'vm-1',
    url: 'http://1.2.3.4/',
  });
  const web = validateTarget('render', { serviceId: 'srv-abc123', url: 'https://x.onrender.com/' });
  assertEquals(actionsFor(vm), ['reset']);
  assertEquals(actionsFor(web), ['restart', 'rollback']);
  assertEquals(actionsFor(validateTarget('render', { serviceId: 'srv-abc123', url: 'https://x/', repo: 'me/app' })), [
    'restart',
    'rollback',
    'revert_pr',
    'fix_pr',
    'merge_pr',
  ]);
  // A VM linked to its repo gets the same code fixes; the reset stays the instant one.
  const linkedVm = validateTarget('gcp', {
    project: 'my-proj-1',
    zone: 'us-central1-a',
    instance: 'vm-1',
    url: 'http://1.2.3.4/',
    repo: 'me/app',
    branch: 'main',
  });
  assertEquals(actionsFor(linkedVm), ['reset', 'revert_pr', 'fix_pr', 'merge_pr']);
});

Deno.test('validateTarget rejects anything that could reach the wrong resource', () => {
  assertThrows(() => validateTarget('aws', { url: 'u' }), Error, 'unknown provider');
  assertThrows(() => validateTarget('render', { url: 'https://x/' }), Error, 'missing serviceId');
  assertThrows(
    () => validateTarget('render', { serviceId: 'srv-1/../x', url: 'https://x/' }),
    Error,
    'invalid serviceId',
  );
  assertThrows(
    () => validateTarget('render', { serviceId: 'srv-1', url: 'https://x/', repo: 'nope' }),
    Error,
    'invalid repo',
  );
  const gcp = { project: 'my-proj-1', zone: 'us-central1-a', instance: 'vm-1', url: 'http://1.2.3.4/' };
  assertThrows(() => validateTarget('gcp', { ...gcp, instance: 'vm/../other' }), Error, 'invalid instance');
  assertThrows(() => validateTarget('gcp', { ...gcp, project: 'x' }), Error, 'invalid project');
  assertThrows(() => validateTarget('gcp', { ...gcp, url: 'file:///etc/passwd' }), Error, 'invalid url');
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
    await resetInstance({ project: 'p', zone: 'z', instance: 'vm1' }, sa);
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

Deno.test('RevenueCat webhook events become a plan row; anonymous ids and other entitlements are ignored', () => {
  const uid = '11111111-2222-4333-8444-555555555555';
  assertEquals(
    planFromEvent({
      type: 'RENEWAL',
      app_user_id: uid,
      entitlement_ids: ['pro'],
      expiration_at_ms: 1790000000000,
      event_timestamp_ms: 1780000000000,
    }),
    { owner: uid, pro_until: new Date(1790000000000).toISOString(), event_at: new Date(1780000000000).toISOString() },
  );
  assertEquals(
    planFromEvent({ app_user_id: uid, entitlement_ids: ['pro'], expiration_at_ms: null })?.pro_until,
    'infinity',
  );
  assertEquals(planFromEvent({ app_user_id: '$RCAnonymousID:abc', entitlement_ids: ['pro'] }), null);
  assertEquals(planFromEvent({ app_user_id: uid, entitlement_ids: ['other'] }), null);
  assertEquals(planFromEvent({ type: 'TEST' }), null);
});

Deno.test('the webhook copy decides Pro when RevenueCat is down: active, lifetime, expired, none', () => {
  const now = new Date('2026-09-28T00:00:00Z');
  assert(proFromRow({ pro_until: '2026-10-28T00:00:00Z' }, now));
  assert(proFromRow({ pro_until: 'infinity' }, now));
  assert(!proFromRow({ pro_until: '2026-09-01T00:00:00Z' }, now));
  assert(!proFromRow(null, now));
});

Deno.test('shared secrets compare in constant time and only when equal', () => {
  assert(timingSafeEqual('Bearer abc', 'Bearer abc'));
  assert(!timingSafeEqual('Bearer abc', 'Bearer abd'));
  assert(!timingSafeEqual('Bearer ab', 'Bearer abc'));
  assert(!timingSafeEqual('', 'x'));
});
