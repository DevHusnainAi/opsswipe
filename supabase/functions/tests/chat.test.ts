import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { chatAuthorizeUrl, exchangeChat } from '../_shared/alerts.ts';

Deno.env.set('SUPABASE_URL', 'https://x.supabase.co');
Deno.env.set('SLACK_CLIENT_ID', 'slack-id');
Deno.env.set('SLACK_CLIENT_SECRET', 'slack-secret');
Deno.env.set('DISCORD_CLIENT_ID', 'discord-id');
Deno.env.set('DISCORD_CLIENT_SECRET', 'discord-secret');

function mockFetch(reply: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(Response.json(reply, { status }));
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

Deno.test('Add to Slack / Discord ask for a channel webhook and come back to oauth-callback', () => {
  const slack = new URL(chatAuthorizeUrl('slack', 'st8'));
  assertEquals(slack.origin + slack.pathname, 'https://slack.com/oauth/v2/authorize');
  assertEquals(slack.searchParams.get('scope'), 'incoming-webhook');
  assertEquals(slack.searchParams.get('redirect_uri'), 'https://x.supabase.co/functions/v1/oauth-callback');
  assertEquals(slack.searchParams.get('state'), 'st8');
  const discord = new URL(chatAuthorizeUrl('discord', 'st8'));
  assertEquals(discord.searchParams.get('scope'), 'webhook.incoming');
  assertEquals(discord.searchParams.get('client_id'), 'discord-id');
});

Deno.test('the webhook in the OAuth answer is kept only if it really is Slack or Discord', async () => {
  let f = mockFetch({
    ok: true,
    incoming_webhook: { url: 'https://hooks.slack.com/services/T/B/x', channel: '#incidents' },
  });
  try {
    assertEquals(await exchangeChat('slack', 'c'), {
      url: 'https://hooks.slack.com/services/T/B/x',
      channel: '#incidents',
    });
  } finally {
    f.restore();
  }
  f = mockFetch({ webhook: { url: 'https://discord.com/api/webhooks/1/abc' } });
  try {
    assertEquals((await exchangeChat('discord', 'c')).url, 'https://discord.com/api/webhooks/1/abc');
    assertEquals(
      new Headers(f.calls[0].init?.headers).get('Authorization'),
      `Basic ${btoa('discord-id:discord-secret')}`,
    );
  } finally {
    f.restore();
  }
  f = mockFetch({ ok: true, incoming_webhook: { url: 'https://evil.example/hook', channel: '#x' } });
  try {
    await assertRejects(() => exchangeChat('slack', 'c'), Error, 'did not return a webhook');
  } finally {
    f.restore();
  }
  f = mockFetch({ ok: false, error: 'invalid_code' });
  try {
    await assertRejects(() => exchangeChat('slack', 'c'), Error, 'invalid_code');
  } finally {
    f.restore();
  }
});
