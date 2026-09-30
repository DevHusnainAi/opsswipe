import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { mergePr } from '../_shared/github.ts';
import { sign, verify } from '../_shared/hmac.ts';
import { canMerge, evaluateProof, parseProof, type ProofPayload, type PrRef } from '../_shared/proof.ts';
import { MAX_SAMPLES, mergeSamples, scrubSample } from '../_shared/replay.ts';

const now = new Date('2026-09-27T10:00:00Z');
const SHA = 'a'.repeat(40);
const pr: PrRef = { repo: 'me/app', number: 7, headSha: SHA, url: 'https://github.com/me/app/pull/7', branch: 'b' };
// What OpsSwipe saved when production failed, and what CI says this PR's build answers now.
const saved = [
  { method: 'GET', path: '/api/price', status: 500 },
  { method: 'POST', path: '/checkout', status: 502 },
];
const now200 = saved.map((s) => ({ method: s.method, path: s.path, now: 200 }));
const proof = (over: Partial<ProofPayload> = {}): ProofPayload => ({
  repo: 'me/app',
  pr: 7,
  headSha: SHA,
  results: now200,
  tests: { passed: true },
  ...over,
});

Deno.test('hmac: valid signature verifies; tampered body, wrong secret and junk headers do not', async () => {
  const body = '{"target":"web","status":500}';
  const sig = await sign('s3cret', body);
  assert(sig.startsWith('sha256=') && sig.length === 71);
  assert(await verify('s3cret', body, sig));
  assert(!(await verify('s3cret', body.replace('500', '200'), sig)), 'tampered body');
  assert(!(await verify('other', body, sig)), 'wrong secret');
  assert(!(await verify('s3cret', body, null)), 'missing header');
  assert(!(await verify('s3cret', body, 'sha256=zz')), 'malformed hex');
  assert(!(await verify('', body, sig)), 'unset secret never verifies');
});

Deno.test('scrubSample keeps only replayable 5xx requests and redacts secrets', () => {
  assertEquals(scrubSample({ method: 'get', path: '/checkout?id=4&token=abc', status: 500 }, now), {
    method: 'GET',
    path: '/checkout?id=4&token=REDACTED',
    status: 500,
    at: now.toISOString(),
  });
  assertEquals(scrubSample({ method: 'GET', path: '/', status: 404 }, now), null, '4xx is not an outage');
  assertEquals(scrubSample({ method: 'TRACE', path: '/', status: 500 }, now), null);
  assertEquals(scrubSample({ method: 'GET', path: 'https://evil.test/', status: 500 }, now), null, 'absolute URL');
  assertEquals(scrubSample({ method: 'GET', path: '//evil.test/', status: 500 }, now), null, 'protocol-relative');
  const long = scrubSample({ method: 'POST', path: '/x', status: 502, body: 'y'.repeat(5000) }, now);
  assertEquals(long?.body?.length, 2048);
  assertEquals('headers' in (long ?? {}), false);
});

Deno.test('mergeSamples: newest per route wins, capped', () => {
  const s = (path: string, at: string) => ({ method: 'GET', path, status: 500, at });
  const merged = mergeSamples([s('/a', 'old'), s('/b', 'old')], [s('/a', 'new')]);
  assertEquals(merged.map((m) => `${m.path}@${m.at}`), ['/a@new', '/b@old']);
  const many = Array.from({ length: 9 }, (_, i) => s(`/${i}`, 't'));
  assertEquals(mergeSamples([], many).length, MAX_SAMPLES);
});

Deno.test('parseProof rejects malformed or impossible results', () => {
  const { repo: _r, pr: _p, ...body } = proof();
  assert(parseProof(body));
  assertEquals(parseProof({ ...body, headSha: 'abc' }), null);
  assertEquals(parseProof({ ...body, results: [{ method: 'GET', path: 'https://evil.test', now: 200 }] }), null);
  assertEquals(parseProof({ ...body, results: [{ method: 'GET', path: '/', now: 999 }] }), null);
  assertEquals(parseProof({ ...body, results: undefined as never }), null);
  assertEquals(parseProof({ ...body, tests: {} }), null);
  assertEquals(parseProof({ ...body, runUrl: 'https://evil.test/run' }), null, 'run links must point at GitHub');
  assertEquals(parseProof(null), null);
});

Deno.test('evaluateProof binds to the exact PR commit; merge unlocks only when every saved failure answers 2xx', () => {
  const accepted = evaluateProof(pr, proof(), saved, now);
  assert(accepted.status === 'accepted' && accepted.proof.ok && canMerge(pr, accepted.proof));
  assertEquals(accepted.proof.results[1], { method: 'POST', path: '/checkout', was: 502, now: 200 });

  assertEquals(
    evaluateProof(pr, proof({ headSha: 'b'.repeat(40) }), saved).status,
    'stale',
    'pushed after we opened it',
  );
  assertEquals(evaluateProof(pr, proof({ pr: 8 }), saved).status, 'unknown');
  assertEquals(evaluateProof(undefined, proof(), saved).status, 'unknown');

  for (
    const [why, partial] of [
      ['a 404 is a different error, not a fix', proof({ results: [now200[0], { ...now200[1], now: 404 }] })],
      ['a redirect to a login page is not a fix', proof({ results: [now200[0], { ...now200[1], now: 302 }] })],
      ['leaving a failing request out does not help', proof({ results: [now200[0]] })],
      ['tests must pass', proof({ tests: { passed: false } })],
    ] as const
  ) {
    const r = evaluateProof(pr, partial, saved, now);
    assert(r.status === 'accepted' && !r.proof.ok && !canMerge(pr, r.proof), why);
  }
  const none = evaluateProof(pr, proof({ results: [] }), [], now);
  assert(none.status === 'accepted' && !none.proof.ok, 'nothing to replay proves nothing');
  assert(!canMerge({ ...pr, headSha: 'c'.repeat(40) }, accepted.proof), 'proof for another sha');
});

Deno.test('mergePr pins the proven sha and explains 409/405', async () => {
  const real = globalThis.fetch;
  const calls: { url: string; body: unknown }[] = [];
  let status = 200;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Promise.resolve(new Response('{}', { status }));
  }) as typeof fetch;
  try {
    assertEquals(await mergePr(pr, 't'), 'merged #7');
    assertEquals(calls[0].url, 'https://api.github.com/repos/me/app/pulls/7/merge');
    assertEquals(calls[0].body, { sha: SHA, merge_method: 'squash' });
    status = 409;
    await assertRejects(() => mergePr(pr, 't'), Error, 'changed after it was proven');
    status = 405;
    await assertRejects(() => mergePr(pr, 't'), Error, 'not mergeable');
  } finally {
    globalThis.fetch = real;
  }
});
