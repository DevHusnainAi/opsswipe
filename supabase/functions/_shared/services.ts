// Connected services, per-user connections, and credentials. Keys are only ever read here,
// on the server, from Supabase Vault; the app never sees them after they're entered.
import { db, env } from './db.ts';
import type { ServiceAccount } from './gcp.ts';
import { installationToken } from './githubApp.ts';
import { type Target, validateTarget } from './targets.ts';

export type Service = {
  id: string;
  owner: string;
  name: string;
  provider: 'gcp' | 'render';
  config: Record<string, string>;
  report_secret_id: string | null;
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

export async function connection(owner: string, kind: 'github' | 'render') {
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

export async function githubToken(owner: string) {
  const c = await connection(owner, 'github');
  if (!c?.installation_id) throw new Error('GitHub is not connected');
  return installationToken(c.installation_id);
}

// OpsSwipe's own GCP identity; users grant it a reset-only role on their VM.
export const platformSa = (): ServiceAccount => JSON.parse(env('GCP_SA_KEY'));
