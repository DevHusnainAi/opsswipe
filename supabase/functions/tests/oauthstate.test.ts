// The claim is what stops a forwarded Connect link from linking someone else's GitHub, Google or Slack to
// the account that started it. These check the database request carries every condition.
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { hashToken } from '../_shared/agents.ts';

Deno.env.set('SUPABASE_URL', 'http://db.test');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test');
const { claim, ClaimError } = await import('../_shared/oauthState.ts');

const OWNER = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'c'.repeat(64);

function mockDb(rows: Record<string, unknown[]>) {
  const calls: { method: string; url: URL }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((input: string | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    calls.push({ method, url });
    const table = url.pathname.split('/').pop()!;
    const body = rows[table] ?? [];
    // maybeSingle asks for one object; an empty result is a 406 PostgREST "no rows".
    const single = (init?.headers as Record<string, string> | undefined)?.Accept?.includes('vnd.pgrst.object') ||
      String(new Headers(init?.headers).get('Accept')).includes('vnd.pgrst.object');
    if (single) {
      return Promise.resolve(
        body.length ? Response.json(body[0]) : Response.json({ code: 'PGRST116', message: 'no rows' }, { status: 406 }),
      );
    }
    return Promise.resolve(Response.json(body));
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

Deno.test('a claim is only taken by the user who started it, once, within 15 minutes', async () => {
  const f = mockDb({
    oauth_states: [{ result: { kind: 'github', installation_id: 7, account: 'me' } }],
    connections: [],
  });
  try {
    assertEquals(await claim(OWNER, TOKEN), { kind: 'github', account: 'me' });
  } finally {
    f.restore();
  }
  const take = f.calls.find((c) => c.url.pathname.endsWith('/oauth_states'))!;
  assertEquals(take.method, 'DELETE', 'single use: the row goes as it is read');
  const q = take.url.searchParams;
  assertEquals(q.get('owner'), `eq.${OWNER}`, "someone else's account can't claim it");
  assertEquals(q.get('claim_hash'), `eq.${await hashToken(TOKEN)}`, 'only the hash is stored');
  assert(q.get('completed_at')?.startsWith('gt.'), 'expires');
  assert(f.calls.some((c) => c.method === 'POST' && c.url.pathname.endsWith('/connections')), 'then connects');
});

Deno.test('no matching claim (another account, expired or used) connects nothing', async () => {
  const f = mockDb({ oauth_states: [] });
  try {
    await assertRejects(() => claim(OWNER, TOKEN), ClaimError, 'another account');
    await assertRejects(() => claim(OWNER, 'not-a-claim'), ClaimError);
  } finally {
    f.restore();
  }
  assert(!f.calls.some((c) => c.url.pathname.endsWith('/connections')));
});
