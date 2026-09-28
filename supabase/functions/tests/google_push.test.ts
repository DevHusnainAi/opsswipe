import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { accessFromRefresh, consentUrl, GoogleError, grantReset, ROLE_ID, withBinding } from '../_shared/google.ts';
import { pushMessages, sendPush } from '../_shared/push.ts';

type Call = { url: string; method: string; body?: unknown };

// Route by "METHOD url-substring" to [status, json]; record what was sent.
function mockFetch(routes: Record<string, [number, unknown]>) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const raw = init?.body ? String(init.body) : undefined;
    const sent = raw?.startsWith('{') ? JSON.parse(raw) : raw; // token requests are form-encoded
    calls.push({ url: String(url), method, body: sent });
    const key = Object.keys(routes).find((k) => {
      const [m, frag] = k.split(' ');
      return m === method && String(url).includes(frag);
    });
    const [status, body] = key ? routes[key] : [404, { error: `no route ${method} ${url}` }];
    return Promise.resolve(Response.json(body, { status }));
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

const vm = { project: 'my-proj', zone: 'us-central1-a', instance: 'web-1' };
const SA = 'opsswipe@platform.iam.gserviceaccount.com';
const role = `projects/my-proj/roles/${ROLE_ID}`;

Deno.test('withBinding adds our member once and leaves other bindings alone', () => {
  const policy = { etag: 'e1', version: 3, bindings: [{ role: 'roles/owner', members: ['user:me@x.com'] }] };
  const once = withBinding(policy, role, `serviceAccount:${SA}`);
  assertEquals(once.etag, 'e1', 'etag kept so a concurrent change fails instead of being overwritten');
  assertEquals(once.bindings, [
    { role: 'roles/owner', members: ['user:me@x.com'] },
    { role, members: [`serviceAccount:${SA}`] },
  ]);
  assertEquals(withBinding(once, role, `serviceAccount:${SA}`), once, 'idempotent');
  assertEquals(policy.bindings.length, 1, 'input not mutated');
  const conditional = { bindings: [{ role, members: ['user:a'], condition: { expression: 'x' } }] };
  assertEquals(withBinding(conditional, role, 'user:b').bindings!.length, 2, 'never widens a conditional binding');
});

Deno.test('consentUrl asks for lasting (offline) access with a fresh consent and carries state', () => {
  Deno.env.set('SUPABASE_URL', 'https://ref.supabase.co');
  Deno.env.set('GOOGLE_CLIENT_ID', 'cid');
  const q = new URL(consentUrl('st4te')).searchParams;
  assertEquals(q.get('access_type'), 'offline');
  assert(q.get('prompt')!.includes('consent'), 'consent is what makes Google return a refresh token');
  assertEquals(q.get('redirect_uri'), 'https://ref.supabase.co/functions/v1/oauth-callback');
  assertEquals(q.get('state'), 'st4te');
  assert(q.get('scope')!.includes('https://www.googleapis.com/auth/cloud-platform'));
});

Deno.test('grantReset: creates the role (existing is fine) and binds our identity on one VM', async () => {
  const f = mockFetch({
    'POST /roles': [409, { error: { status: 'ALREADY_EXISTS' } }],
    'GET /getIamPolicy': [200, { etag: 'e1', bindings: [] }],
    'POST /setIamPolicy': [200, {}],
  });
  try {
    await grantReset('tok', vm, SA);
  } finally {
    f.restore();
  }
  const set = f.calls.find((c) => c.url.endsWith('/setIamPolicy'))!;
  assert(set.url.includes('/projects/my-proj/zones/us-central1-a/instances/web-1/'), 'scoped to that VM only');
  assertEquals(set.body, { policy: { etag: 'e1', bindings: [{ role, members: [`serviceAccount:${SA}`] }] } });
  assertEquals((f.calls[0].body as { role: { includedPermissions: string[] } }).role.includedPermissions, [
    'compute.instances.reset',
    'compute.instances.get',
  ]);
});

Deno.test('grantReset: missing permission and disabled API become plain sentences', async () => {
  let f = mockFetch({ 'POST /roles': [403, { error: { status: 'PERMISSION_DENIED' } }] });
  await assertRejects(() => grantReset('tok', vm, SA), GoogleError, 'needs Owner').finally(f.restore);
  f = mockFetch({ 'POST /roles': [403, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } }] });
  await assertRejects(() => grantReset('tok', vm, SA), GoogleError, 'Turn on the IAM API').finally(f.restore);
});

Deno.test('refresh tokens mint access tokens; a revoked one asks the user to reconnect', async () => {
  let f = mockFetch({ 'POST oauth2.googleapis.com/token': [200, { access_token: 'fresh' }] });
  assertEquals(await accessFromRefresh('r1').finally(f.restore), 'fresh');
  assertEquals(f.calls[0].method, 'POST');
  f = mockFetch({ 'POST oauth2.googleapis.com/token': [400, { error: 'invalid_grant' }] });
  await assertRejects(() => accessFromRefresh('r1'), GoogleError, 'Connect Google Cloud again').finally(f.restore);
});

Deno.test('push: high priority on the incidents channel; dead tokens are reported back', async () => {
  const msgs = pushMessages(['ExponentPushToken[a]'], { title: 't', body: 'b' });
  assertEquals(msgs[0], {
    to: 'ExponentPushToken[a]',
    title: 't',
    body: 'b',
    channelId: 'incidents',
    priority: 'high',
    sound: 'default',
  });
  const f = mockFetch({
    'POST exp.host': [200, {
      data: [{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }],
    }],
  });
  try {
    assertEquals(await sendPush(['ExponentPushToken[a]', 'ExponentPushToken[b]'], { title: 't', body: 'b' }), [
      'ExponentPushToken[b]',
    ]);
    assertEquals(f.calls.length, 1, 'one request for all phones');
    assertEquals(await sendPush([], { title: 't', body: 'b' }), [], 'no phones, no request');
    assertEquals(f.calls.length, 1);
  } finally {
    f.restore();
  }
});
