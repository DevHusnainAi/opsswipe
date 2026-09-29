// OAuth round trips (GitHub install, Google sign-in, Add to Slack/Discord). The state names the user who
// started it, is single-use and expires in 15 minutes. That alone isn't enough: whoever started a flow
// can send its link to someone else, who approves on their own account. So the callback (`exchange`)
// only keeps the result under a one-time claim, sent in the redirect to the device that approved, and
// the connection is made when the same user's app presents it (`claim`). A forwarded link ends on the
// other person's phone, where their account isn't the one that started it, and it's refused.
import { alertKind, exchangeChat, postAlert } from './alerts.ts';
import { hashToken } from './agents.ts';
import { db } from './db.ts';
import { exchangeCode } from './google.ts';
import { findInstallation } from './githubApp.ts';
import { exchangeRailway } from './railway.ts';
import { connection, deleteSecret, readSecret, storeSecret } from './services.ts';

export type OAuthKind = 'github' | 'google' | 'slack' | 'discord' | 'railway';
export const TTL_MS = 15 * 60_000;
const random = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
const since = (now = Date.now()) => new Date(now - TTL_MS).toISOString();

type Result =
  | { kind: 'github'; installation_id: number; account: string }
  | { kind: 'google'; secret_id: string; account: string | null }
  | { kind: 'railway'; secret_id: string }
  | { kind: 'slack' | 'discord'; secret_id: string; channel: string };

export async function newState(owner: string, kind: OAuthKind) {
  const nonce = random().slice(0, 32);
  await db.from('oauth_states').insert({ nonce, owner, kind });
  return nonce;
}

// Single use: marked completed as it's read, so a code can only be exchanged once per state.
export async function takeState(nonce: string): Promise<{ owner: string; kind: OAuthKind } | null> {
  if (!/^[0-9a-f]{32}$/.test(nonce)) return null;
  const { data } = await db.from('oauth_states').update({ completed_at: new Date().toISOString() })
    .eq('nonce', nonce).is('completed_at', null).gt('created_at', since()).select('owner, kind').maybeSingle();
  return data as { owner: string; kind: OAuthKind } | null;
}

// The callback's half: trade the provider's code for the result, keep it (secrets in Vault), and return the
// claim for the redirect. GitHub authorized but not installed yet: { installed: false }, nothing kept.
export async function exchange(nonce: string, kind: OAuthKind, code: string, installationId?: number) {
  let result: Result;
  if (kind === 'github') {
    const { login, installationId: id } = await findInstallation(code, installationId || undefined);
    if (!id) return { installed: false as const };
    result = { kind, installation_id: id, account: login };
  } else if (kind === 'google') {
    const { refresh, email } = await exchangeCode(code);
    result = { kind, secret_id: await storeSecret(refresh), account: email };
  } else if (kind === 'railway') {
    result = { kind, secret_id: await storeSecret(JSON.stringify(await exchangeRailway(code))) };
  } else {
    const { url, channel } = await exchangeChat(kind, code);
    result = { kind, secret_id: await storeSecret(url), channel };
  }
  const claim = random();
  await db.from('oauth_states').update({ claim_hash: await hashToken(claim), result }).eq('nonce', nonce);
  return { installed: true as const, claim };
}

// The app's half: only the user who started the flow, within 15 minutes, once.
export async function claim(owner: string, token: string): Promise<{ kind: OAuthKind; account: string | null }> {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new ClaimError();
  const { data } = await db.from('oauth_states').delete().eq('claim_hash', await hashToken(token)).eq('owner', owner)
    .gt('completed_at', since()).select('result').maybeSingle();
  const r = data?.result as Result | undefined;
  if (!r) throw new ClaimError();
  if (r.kind === 'github') {
    await db.from('connections').upsert({
      owner,
      kind: 'github',
      installation_id: r.installation_id,
      account: r.account,
    });
    return { kind: 'github', account: r.account };
  }
  if (r.kind === 'railway') {
    const old = await connection(owner, 'railway');
    await db.from('connections').upsert({ owner, kind: 'railway', secret_id: r.secret_id, account: 'oauth' });
    await deleteSecret(old?.secret_id);
    return { kind: 'railway', account: null };
  }
  if (r.kind === 'google') {
    const old = await connection(owner, 'google');
    await db.from('connections').upsert({ owner, kind: 'google', secret_id: r.secret_id, account: r.account });
    await deleteSecret(old?.secret_id);
    return { kind: 'google', account: r.account };
  }
  const url = await readSecret(r.secret_id);
  await deleteSecret(r.secret_id); // saveAlerts keeps its own copy
  await saveAlerts(owner, url ?? '', r.channel);
  return { kind: r.kind, account: r.channel };
}

export class ClaimError extends Error {
  constructor() {
    super('This connection was started by another account, or it expired. Tap Connect again.');
  }
}

// Unclaimed results (a lost link, or one that went to someone else) are deleted with their secrets.
export async function sweepStates(now = Date.now()) {
  const { data } = await db.from('oauth_states').delete().lt('created_at', since(now - TTL_MS)).select('result');
  for (const row of data ?? []) await deleteSecret((row.result as { secret_id?: string } | null)?.secret_id);
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
