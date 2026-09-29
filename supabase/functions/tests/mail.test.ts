import { assert, assertEquals } from 'jsr:@std/assert@1';
import { inviteMail, sendMail } from '../_shared/mail.ts';

Deno.test('the invite email carries the join link and the code, and escapes the inviter', () => {
  const m = inviteMail(
    '<b>eve</b>@x.com',
    'ABCD2345',
    'https://r.supabase.co/functions/v1/oauth-callback?to=team&code=ABCD2345',
  );
  assert(m.text.includes('code ABCD2345') && m.text.includes('?to=team&code=ABCD2345'));
  assert(!m.html.includes('<b>eve</b>'), 'an address is text, never markup');
  assert(m.html.includes('&#60;b&#62;eve'));
});

Deno.test('mail goes to Resend with the key as a bearer token and the verified sender', async () => {
  Deno.env.set('RESEND_API_KEY', 're_test');
  Deno.env.set('MAIL_FROM', 'invites@example.com');
  const real = globalThis.fetch;
  let sent: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    sent = { url, init };
    return Promise.resolve(Response.json({ messageId: '1' }, { status: 201 }));
  }) as typeof fetch;
  try {
    await sendMail('t@x.com', 's', 't', '<p>h</p>');
  } finally {
    globalThis.fetch = real;
  }
  assertEquals(sent!.url, 'https://api.resend.com/emails');
  assertEquals(new Headers(sent!.init?.headers).get('Authorization'), 'Bearer re_test');
  const body = JSON.parse(String(sent!.init?.body));
  assertEquals(body.from, 'OpsSwipe <invites@example.com>');
  assertEquals(body.to, ['t@x.com']);
});
