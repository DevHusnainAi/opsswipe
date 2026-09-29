// A second alert channel next to push: a Discord or Slack incoming webhook. The URL is the secret,
// so it lives in Vault. Only those two hosts are accepted, so the field can't make the server call
// arbitrary URLs. https://discord.com/developers/docs/resources/webhook#execute-webhook
// https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/
const env = (k: string) => Deno.env.get(k) ?? ''; // not db.ts: this file stays importable without a database
import type { Push } from './push.ts';

export type AlertKind = 'discord' | 'slack';

export function alertKind(raw: string): AlertKind | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
  if ((u.hostname === 'discord.com' || u.hostname === 'discordapp.com') && u.pathname.startsWith('/api/webhooks/')) {
    return 'discord';
  }
  if (u.hostname === 'hooks.slack.com' && u.pathname.startsWith('/services/')) return 'slack';
  return null;
}

export const alertBody = (kind: AlertKind, p: Push) =>
  kind === 'discord' ? { content: `**${p.title}**\n${p.body}` } : { text: `*${p.title}*\n${p.body}` };

export async function postAlert(url: string, p: Push) {
  const kind = alertKind(url);
  if (!kind) throw new Error('not a Discord or Slack webhook URL');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(alertBody(kind, p)),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`${kind} webhook ${res.status}`);
}

// One click instead of a pasted URL: "Add to Slack" / "Add to Discord" asks the user to pick a channel,
// and the OAuth answer carries a webhook for it (Slack's incoming-webhook scope, Discord's
// webhook.incoming). The URL still has to pass alertKind(), so an OAuth reply can't aim us elsewhere.
// https://docs.slack.dev/authentication/installing-with-oauth · https://discord.com/developers/docs/topics/oauth2#webhooks
const redirectUri = () => `${env('SUPABASE_URL')}/functions/v1/oauth-callback`;

export function chatAuthorizeUrl(kind: AlertKind, state: string) {
  const q = new URLSearchParams({ state, redirect_uri: redirectUri() });
  if (kind === 'slack') {
    q.set('client_id', env('SLACK_CLIENT_ID'));
    q.set('scope', 'incoming-webhook');
    return `https://slack.com/oauth/v2/authorize?${q}`;
  }
  q.set('client_id', env('DISCORD_CLIENT_ID'));
  q.set('response_type', 'code');
  q.set('scope', 'webhook.incoming');
  return `https://discord.com/oauth2/authorize?${q}`;
}

export async function exchangeChat(kind: AlertKind, code: string): Promise<{ url: string; channel: string }> {
  const form = new URLSearchParams({ code, redirect_uri: redirectUri() });
  let url: unknown, channel: unknown;
  if (kind === 'slack') {
    form.set('client_id', env('SLACK_CLIENT_ID'));
    form.set('client_secret', env('SLACK_CLIENT_SECRET'));
    const r = await (await fetch('https://slack.com/api/oauth.v2.access', { method: 'POST', body: form })).json();
    if (!r.ok) throw new Error(`slack oauth: ${r.error}`);
    ({ url, channel } = r.incoming_webhook ?? {});
  } else {
    form.set('grant_type', 'authorization_code');
    const res = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: form,
      headers: { Authorization: `Basic ${btoa(`${env('DISCORD_CLIENT_ID')}:${env('DISCORD_CLIENT_SECRET')}`)}` },
    });
    if (!res.ok) throw new Error(`discord oauth ${res.status}`);
    url = (await res.json()).webhook?.url;
    channel = 'your channel'; // Discord's answer names the webhook, not the channel
  }
  if (typeof url !== 'string' || alertKind(url) !== kind) throw new Error(`${kind} did not return a webhook`);
  return { url, channel: typeof channel === 'string' ? channel : 'your channel' };
}
