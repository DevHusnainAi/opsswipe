import { assert, assertEquals } from 'jsr:@std/assert@1';
import { accessFromGrant, isGrant, listRailwayServices, railwayAuthorizeUrl } from '../_shared/railway.ts';

Deno.env.set('SUPABASE_URL', 'https://x.supabase.co');
Deno.env.set('RAILWAY_CLIENT_ID', 'rw-id');
Deno.env.set('RAILWAY_CLIENT_SECRET', 'rw-secret');

function mockFetch(reply: (url: string, init?: RequestInit) => unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(Response.json(reply(String(url), init)));
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

Deno.test('Connect Railway asks for chosen projects only, with a refresh token, back to oauth-callback', () => {
  const q = new URL(railwayAuthorizeUrl('st8')).searchParams;
  assertEquals(q.get('scope'), 'openid offline_access project:member');
  assertEquals(q.get('prompt'), 'consent', 'Railway returns a refresh token only with a fresh consent');
  assertEquals(q.get('redirect_uri'), 'https://x.supabase.co/functions/v1/oauth-callback');
  assertEquals(q.get('state'), 'st8');
});

Deno.test('a Railway grant is reused while fresh; an expired one refreshes and hands back the rotated token', async () => {
  const now = Date.parse('2026-09-30T00:00:00Z');
  const fresh = { refresh: 'r1', access: 'a1', exp: now + 30 * 60_000 };
  assertEquals(await accessFromGrant(fresh, now), { access: 'a1', next: null }, 'no call while it has time left');
  const f = mockFetch(() => ({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600 }));
  try {
    const r = await accessFromGrant({ ...fresh, exp: now + 30_000 }, now);
    assertEquals(r, { access: 'a2', next: { refresh: 'r2', access: 'a2', exp: now + 3600_000 } });
  } finally {
    f.restore();
  }
  assertEquals(new URLSearchParams(String(f.calls[0].init?.body)).get('refresh_token'), 'r1');
  assertEquals(new Headers(f.calls[0].init?.headers).get('Authorization'), `Basic ${btoa('rw-id:rw-secret')}`);
  assert(isGrant(JSON.stringify(fresh)) && !isGrant('0a1b2c3d-pasted-token'));
});

Deno.test('the shared projects become project/service choices with their environments', async () => {
  const f = mockFetch(() => ({
    data: {
      externalWorkspaces: [{
        projects: [{
          id: 'p1',
          name: 'shop',
          services: { edges: [{ node: { id: 's1', name: 'api' } }] },
          environments: { edges: [{ node: { id: 'e1', name: 'production' } }] },
        }],
      }],
    },
  }));
  try {
    assertEquals(await listRailwayServices('tok'), [
      {
        projectId: 'p1',
        project: 'shop',
        serviceId: 's1',
        service: 'api',
        environments: [{ id: 'e1', name: 'production' }],
      },
    ]);
  } finally {
    f.restore();
  }
});
