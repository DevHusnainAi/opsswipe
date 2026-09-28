// A second alert channel next to push: a Discord or Slack incoming webhook. The URL is the secret,
// so it lives in Vault. Only those two hosts are accepted, so the field can't make the server call
// arbitrary URLs. https://discord.com/developers/docs/resources/webhook#execute-webhook
// https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/
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
