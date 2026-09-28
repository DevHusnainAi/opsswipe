// OAuth round trips that finish on the server. The state names the user who started it, is single-use
// and expires in 15 minutes, so a code arriving at oauth-callback can only ever connect that user.
import { db } from './db.ts';
import { exchangeCode, listProjects } from './google.ts';
import { findInstallation } from './githubApp.ts';
import { connection, deleteSecret, storeSecret } from './services.ts';

export type OAuthKind = 'github' | 'google';
const TTL_MS = 15 * 60_000;

export async function newState(owner: string, kind: OAuthKind) {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  await db.from('oauth_states').delete().eq('owner', owner).lt(
    'created_at',
    new Date(Date.now() - TTL_MS).toISOString(),
  );
  await db.from('oauth_states').insert({ nonce, owner, kind });
  return nonce;
}

// Single use: the row is deleted as it's read.
export async function takeState(nonce: string): Promise<{ owner: string; kind: OAuthKind } | null> {
  if (!/^[0-9a-f]{32}$/.test(nonce)) return null;
  const { data } = await db.from('oauth_states').delete().eq('nonce', nonce)
    .gt('created_at', new Date(Date.now() - TTL_MS).toISOString()).select('owner, kind').maybeSingle();
  return data as { owner: string; kind: OAuthKind } | null;
}

// The user's own OAuth code proves which installation is theirs before it's stored. No installation
// yet (authorized, not installed): installed = false, and the caller sends them on to install.
export async function completeGithub(owner: string, code: string, installationId?: number) {
  const { login, installationId: id } = await findInstallation(code, installationId || undefined);
  if (!id) return { account: login, installed: false };
  await db.from('connections').upsert({ owner, kind: 'github', installation_id: id, account: login });
  return { account: login, installed: true };
}

// The refresh token goes to Vault; the short-lived access token lists projects right away.
export async function completeGoogle(owner: string, code: string) {
  const { access, refresh, email } = await exchangeCode(code);
  const old = await connection(owner, 'google');
  await db.from('connections').upsert({ owner, kind: 'google', secret_id: await storeSecret(refresh), account: email });
  await deleteSecret(old?.secret_id);
  return { email, access, projects: () => listProjects(access) };
}
