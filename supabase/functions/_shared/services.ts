// Connected services, per-user connections, and credentials. Keys are only ever read here,
// on the server, from Supabase Vault; the app never sees them after they're entered.
import { postAlert } from './alerts.ts';
import { db, env } from './db.ts';
import type { ServiceAccount } from './gcp.ts';
import { accessFromRefresh, GoogleError, revoke } from './google.ts';
import { installationToken } from './githubApp.ts';
import { type Push, sendPush } from './push.ts';
import { type Target, validateTarget } from './targets.ts';

export type Service = {
  id: string;
  owner: string;
  name: string;
  provider: 'gcp' | 'render' | 'railway';
  config: Record<string, string>;
  report_secret_id: string | null;
  sentry_secret_id?: string | null;
};

export const toTarget = (s: Service): Target => validateTarget(s.provider, s.config);

export async function getService(id: string) {
  const { data } = await db.from('services').select().eq('id', id).maybeSingle<Service>();
  return data;
}

export async function allServices(): Promise<Service[]> {
  const { data } = await db.from('services').select();
  return data ?? [];
}

export async function storeSecret(value: string) {
  const { data, error } = await db.rpc('opsswipe_store_secret', { value });
  if (error) throw error;
  return data as string;
}

export async function readSecret(id: string) {
  const { data, error } = await db.rpc('opsswipe_read_secret', { secret_id: id });
  if (error) throw error;
  return data as string | null;
}

export async function deleteSecret(id: string | null | undefined) {
  if (id) await db.rpc('opsswipe_delete_secret', { secret_id: id });
}

type Connection = { secret_id: string | null; installation_id: number | null; account: string | null };

export type ConnectionKind = 'github' | 'render' | 'google' | 'railway' | 'alerts' | 'revenuecat';

export async function connection(owner: string, kind: ConnectionKind) {
  const { data } = await db.from('connections').select('secret_id, installation_id, account')
    .eq('owner', owner).eq('kind', kind).maybeSingle<Connection>();
  return data;
}

export async function renderKey(owner: string) {
  const c = await connection(owner, 'render');
  const key = c?.secret_id ? await readSecret(c.secret_id) : null;
  if (!key) throw new Error('Render is not connected');
  return key;
}

export async function railwayToken(owner: string) {
  const c = await connection(owner, 'railway');
  const token = c?.secret_id ? await readSecret(c.secret_id) : null;
  if (!token) throw new Error('Railway is not connected');
  return token;
}

export async function githubToken(owner: string) {
  const c = await connection(owner, 'github');
  if (!c?.installation_id) throw new Error('GitHub is not connected');
  return installationToken(c.installation_id);
}

// OpsSwipe's own GCP identity; users grant it a reset-only role on their VM.
export const platformSa = (): ServiceAccount => JSON.parse(env('GCP_SA_KEY'));

// A 1-hour Google access token, minted from the refresh token kept in Vault by "Connect Google Cloud".
export async function googleToken(owner: string) {
  const c = await connection(owner, 'google');
  const refresh = c?.secret_id ? await readSecret(c.secret_id) : null;
  if (!refresh) throw new GoogleError('Connect Google Cloud first.');
  return accessFromRefresh(refresh);
}

export async function forgetConnection(owner: string, kind: ConnectionKind) {
  const c = await connection(owner, kind);
  if (kind === 'google' && c?.secret_id) await revoke((await readSecret(c.secret_id)) ?? '');
  await db.from('connections').delete().eq('owner', owner).eq('kind', kind);
  await deleteSecret(c?.secret_id);
}

// Pages every phone the owner registered, and their Discord or Slack channel if they added one.
// Never throws: a failed alert must not block an incident.
export async function notify(owner: string, push: Push) {
  try {
    const { data } = await db.from('push_tokens').select('token').eq('owner', owner);
    const dead = await sendPush((data ?? []).map((r) => r.token as string), push);
    if (dead.length) await db.from('push_tokens').delete().in('token', dead);
  } catch (e) {
    console.warn('push failed:', String(e));
  }
  try {
    const c = await connection(owner, 'alerts');
    const url = c?.secret_id ? await readSecret(c.secret_id) : null;
    if (url) await postAlert(url, push);
  } catch (e) {
    console.warn('alert webhook failed:', String(e));
  }
}

// Whose incidents this user may see and fix: their own and those of every team they're on.
export async function ownersFor(uid: string) {
  const { data } = await db.from('team_members').select('owner').eq('member', uid);
  return [uid, ...(data ?? []).map((t) => t.owner as string)];
}
