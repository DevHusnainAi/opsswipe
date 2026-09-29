// OAuth round trips that finish on the server. The state names the user who started it, is single-use
// and expires in 15 minutes, so a code arriving at oauth-callback can only ever connect that user.
import { type AlertKind, alertKind, exchangeChat, postAlert } from './alerts.ts';
import { db } from './db.ts';
import { exchangeCode, listProjects } from './google.ts';
import { findInstallation } from './githubApp.ts';
import { connection, deleteSecret, storeSecret } from './services.ts';

export type OAuthKind = 'github' | 'google' | 'slack' | 'discord';
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

// A Discord or Slack channel for alerts: a test message proves the webhook works before it's kept.
// `account` reads "slack #incidents" so the app can show where alerts go.
export async function saveAlerts(owner: string, url: string, channel: string) {
  const kind = alertKind(url);
  if (!kind) throw new Error('not a Discord or Slack webhook URL');
  await postAlert(url, {
    title: 'OpsSwipe alerts are on',
    body: 'Incidents, recoveries and proven fixes will post here.',
  });
  const old = await connection(owner, 'alerts');
  await db.from('connections').upsert({
    owner,
    kind: 'alerts',
    secret_id: await storeSecret(url),
    account: `${kind} ${channel}`,
  });
  await deleteSecret(old?.secret_id);
  return { kind, channel };
}

export async function completeChat(owner: string, kind: AlertKind, code: string) {
  const { url, channel } = await exchangeChat(kind, code);
  return await saveAlerts(owner, url, channel);
}
