// A fix needs more than a signed-in session: the phone holds a random key in its secure hardware that
// Android only releases after the fingerprint, and execute checks it. A stolen or backed-up session token
// alone can't run a fix. Only the key's hash is stored.
import { hashToken } from './agents.ts';
import { db } from './db.ts';
import { b64urlDecode } from './jwt.ts';

// A new key needs a real sign-in within this window, not just a refreshed token: whoever lifted a
// refresh token can't enroll their own key, because refreshing keeps the original sign-in time.
export const FRESH_SIGN_IN_MS = 15 * 60_000;

// When the user last actually signed in, from the JWT's amr claim (the JWT is already verified by the caller).
export function signedInAt(jwt: string): number {
  try {
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(jwt.split('.')[1])));
    return Math.max(0, ...((claims.amr ?? []) as { timestamp?: number }[]).map((a) => Number(a.timestamp) * 1000 || 0));
  } catch {
    return 0;
  }
}

export const freshSignIn = (jwt: string, now = Date.now()) => now - signedInAt(jwt) < FRESH_SIGN_IN_MS;
export const validKey = (key: unknown): key is string => typeof key === 'string' && /^[0-9a-f]{64}$/.test(key);

// ponytail: one key per phone, kept until the account goes; a "signed-in phones" list could revoke them.
export async function registerFixKey(owner: string, key: string) {
  await db.from('fix_keys').upsert({ owner, key_hash: await hashToken(key) });
}

export async function hasFixKey(owner: string, key: string | null) {
  if (!validKey(key)) return false;
  const { count } = await db.from('fix_keys').select('owner', { count: 'exact', head: true })
    .eq('owner', owner).eq('key_hash', await hashToken(key));
  return (count ?? 0) > 0;
}
