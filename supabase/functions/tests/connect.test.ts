import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { b64url, pkcs1ToPkcs8, signRs256 } from '../_shared/jwt.ts';
import { AUDIENCE, fromWorkflow, ISSUER, prNumberFromRef, verifyGithubOidc } from '../_shared/oidc.ts';
import { PROOF_SCRIPT, proofWorkflow } from '../_shared/proofKit.ts';
import { githubRepo } from '../_shared/render.ts';

const enc = new TextEncoder();
const genKey = () =>
  crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
const pem = (label: string, der: Uint8Array) =>
  `-----BEGIN ${label}-----\n${btoa(String.fromCharCode(...der))}\n-----END ${label}-----\n`;

// PKCS#8 = SEQUENCE { version, algorithm, OCTET STRING <pkcs1> }; pull out the PKCS#1 key inside.
function pkcs8ToPkcs1(p8: Uint8Array) {
  const octet = p8.indexOf(0x04, 22); // after version (3 bytes) + algorithm (15) + outer header
  const lenByte = p8[octet + 1];
  const n = lenByte & 0x80 ? lenByte & 0x7f : 0;
  return p8.slice(octet + 2 + n);
}

Deno.test('GitHub App keys (PKCS#1) are converted and sign verifiable JWTs', async () => {
  const pair = await genKey();
  const p8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const p1 = pkcs8ToPkcs1(p8);
  assertEquals(pkcs1ToPkcs8(p1), p8, 'wrapping PKCS#1 reproduces the original PKCS#8 bytes');

  const jwt = await signRs256({ iss: '123', iat: 1, exp: 2 }, pem('RSA PRIVATE KEY', p1));
  const [h, c, s] = jwt.split('.');
  const sig = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (x) => x.charCodeAt(0));
  assert(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, sig, enc.encode(`${h}.${c}`)));
});

async function oidcToken(claims: Record<string, unknown>, kid = 'k1') {
  const pair = await genKey();
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid };
  const head = b64url(enc.encode(JSON.stringify({ alg: 'RS256', kid })));
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, enc.encode(`${head}.${body}`)),
  );
  return { token: `${head}.${body}.${b64url(sig)}`, keys: [jwk] };
}

const good = {
  iss: ISSUER,
  aud: AUDIENCE,
  exp: 2_000,
  repository: 'me/app',
  ref: 'refs/pull/7/merge',
  event_name: 'pull_request',
  run_id: '1',
};

Deno.test('OIDC: a genuine token from the repo run is accepted', async () => {
  const { token, keys } = await oidcToken(good);
  const c = await verifyGithubOidc(token, { keys, now: 1_000 });
  assertEquals(c.repository, 'me/app');
  assertEquals(prNumberFromRef(c.ref), 7);
});

Deno.test('OIDC: forged, expired, wrong-audience and wrong-issuer tokens are rejected', async () => {
  const { token, keys } = await oidcToken(good);
  const other = await oidcToken(good); // same kid, different key: a forgery
  await assertRejects(() => verifyGithubOidc(other.token, { keys, now: 1_000 }), Error, 'bad signature');
  await assertRejects(() => verifyGithubOidc(token, { keys, now: 3_000 }), Error, 'expired');
  const aud = await oidcToken({ ...good, aud: 'someone-else' });
  await assertRejects(() => verifyGithubOidc(aud.token, { keys: aud.keys, now: 1_000 }), Error, 'wrong audience');
  const iss = await oidcToken({ ...good, iss: 'https://evil.test' });
  await assertRejects(() => verifyGithubOidc(iss.token, { keys: iss.keys, now: 1_000 }), Error, 'wrong issuer');
  await assertRejects(() => verifyGithubOidc('not.a.jwt', { keys, now: 1_000 }));
  assertEquals(prNumberFromRef('refs/heads/main'), null, 'a push run is not a PR proof');
});

Deno.test('Render repo URLs map to owner/name; non-GitHub hosts do not', () => {
  assertEquals(githubRepo('https://github.com/me/app'), 'me/app');
  assertEquals(githubRepo('https://github.com/me/app.git'), 'me/app');
  assertEquals(githubRepo('https://gitlab.com/me/app'), undefined);
  assertEquals(githubRepo(undefined), undefined);
});

Deno.test('proof kit: workflow asks for OIDC, points at our endpoint, and the script parses', async () => {
  const wf = proofWorkflow('https://ref.supabase.co/functions/v1/proof');
  assert(wf.includes('id-token: write'));
  assert(wf.includes('OPSSWIPE_PROOF_URL: https://ref.supabase.co/functions/v1/proof'));
  assert(wf.includes('${{ steps.tests.outputs.passed }}'), 'GitHub expression survives the template');
  const mod = await import(`data:text/javascript,${encodeURIComponent(PROOF_SCRIPT)}`);
  assertEquals(typeof mod.replayAll, 'function');
});

Deno.test('only the OpsSwipe proof workflow of that same repo can prove a fix', () => {
  const base = { repository: 'me/app', ref: 'refs/pull/7/merge', event_name: 'pull_request', run_id: '1', exp: 0 };
  const path = '.github/workflows/opsswipe-proof.yml';
  assertEquals(fromWorkflow({ ...base, job_workflow_ref: `me/app/${path}@refs/pull/7/merge` }, path), true);
  assertEquals(
    fromWorkflow({ ...base, job_workflow_ref: 'me/app/.github/workflows/other.yml@refs/pull/7/merge' }, path),
    false,
  );
  assertEquals(
    fromWorkflow({ ...base, job_workflow_ref: `evil/lib/${path}@refs/heads/main` }, path),
    false,
    'a reusable workflow elsewhere',
  );
  assertEquals(fromWorkflow(base, path), false, 'no claim, no proof');
});

Deno.test("GitHub connect finds the user's own installation, none yet, or refuses someone else's", async () => {
  Deno.env.set('SUPABASE_URL', Deno.env.get('SUPABASE_URL') ?? 'http://localhost:54321'); // db.ts connects on import
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? 'test');
  const { findInstallation } = await import('../_shared/githubApp.ts');
  const real = globalThis.fetch;
  const reply = (installations: unknown[]) => (globalThis.fetch = ((u: string) =>
    Promise.resolve(Response.json(
      u.includes('access_token')
        ? { access_token: 'user-token' }
        : u.endsWith('/user')
        ? { login: 'me' }
        : { installations },
    ))) as typeof fetch);
  try {
    reply([{ id: 11, account: { login: 'some-org' } }, { id: 22, account: { login: 'me' } }]);
    assertEquals(
      await findInstallation('code'),
      { login: 'me', installationId: 22 },
      'prefers the one on their account',
    );
    reply([]);
    assertEquals(await findInstallation('code'), { login: 'me', installationId: null }, 'not installed yet');
    reply([{ id: 22, account: { login: 'me' } }]);
    await assertRejects(() => findInstallation('code', 99), Error, 'does not belong to you');
  } finally {
    globalThis.fetch = real;
  }
});
