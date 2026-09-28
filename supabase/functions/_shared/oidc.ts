// Verify GitHub Actions OIDC tokens, so CI can prove a fix with no secrets stored in the repo.
// https://docs.github.com/en/actions/reference/security/oidc
import { b64urlDecode } from './jwt.ts';

export const ISSUER = 'https://token.actions.githubusercontent.com';
export const AUDIENCE = 'opsswipe';

export type GithubClaims = {
  repository: string;
  ref: string;
  event_name: string;
  run_id: string;
  exp: number;
  job_workflow_ref?: string;
};
type Jwk = JsonWebKey & { kid: string };

let jwksCache: { keys: Jwk[]; at: number } | undefined;

async function jwks(fetchKeys = () => fetch(`${ISSUER}/.well-known/jwks`).then((r) => r.json())) {
  if (!jwksCache || Date.now() - jwksCache.at > 10 * 60_000) {
    jwksCache = { keys: (await fetchKeys()).keys, at: Date.now() };
  }
  return jwksCache.keys;
}

export async function verifyGithubOidc(
  token: string,
  opts: { now?: number; keys?: Jwk[] } = {},
): Promise<GithubClaims> {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new Error('malformed token');
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
  if (header.alg !== 'RS256') throw new Error('unexpected alg');
  const jwk = (opts.keys ?? await jwks()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
    'verify',
  ]);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlDecode(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!valid) throw new Error('bad signature');

  const c = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (c.iss !== ISSUER) throw new Error('wrong issuer');
  if (c.aud !== AUDIENCE && !(Array.isArray(c.aud) && c.aud.includes(AUDIENCE))) throw new Error('wrong audience');
  if (typeof c.exp !== 'number' || c.exp < now) throw new Error('expired');
  return c;
}

// Only the OpsSwipe proof workflow may prove a fix, not any other workflow in the repo that can mint a
// token. job_workflow_ref looks like "owner/repo/.github/workflows/opsswipe-proof.yml@refs/pull/7/merge".
export const fromWorkflow = (c: GithubClaims, path: string) =>
  typeof c.job_workflow_ref === 'string' && c.job_workflow_ref.startsWith(`${c.repository}/${path}@`);

// A pull_request run checks out refs/pull/<n>/merge; bind the proof to that PR in that repo.
export const prNumberFromRef = (ref: string) => {
  const m = /^refs\/pull\/(\d+)\/merge$/.exec(ref);
  return m ? Number(m[1]) : null;
};
