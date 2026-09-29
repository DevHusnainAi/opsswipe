// Email through Resend's HTTP API (free: 3,000 a month, 100 a day). MAIL_FROM must be an address on a domain
// verified in Resend: without one, Resend only delivers to the account owner's own address. Supabase's built-in
// email only reaches the project's own members, so it can't invite teammates.
// https://resend.com/docs/api-reference/emails/send-email
const env = (k: string) => Deno.env.get(k) ?? '';

export const mailEnabled = () => !!env('RESEND_API_KEY') && !!env('MAIL_FROM');

export async function sendMail(to: string, subject: string, text: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: `OpsSwipe <${env('MAIL_FROM')}>`, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`mail ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// The invite: a link that opens the app on the join step, and the code, for when the link can't open the app.
export function inviteMail(from: string, code: string, link: string) {
  const subject = `${from} invited you to their on-call team on OpsSwipe`;
  const text = [
    `${from} added you to their on-call team on OpsSwipe: you'll see and can fix their production incidents,`,
    `and you're paged when nobody answers in 5 minutes.`,
    '',
    `Join: ${link}`,
    `Or in the app: Settings → Team → Join, code ${code}`,
    '',
    `New to OpsSwipe? Install it, sign up, then open the link again. The invite works for 7 days.`,
  ].join('\n');
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;line-height:1.5">
<p><b>${esc(from)}</b> added you to their on-call team on OpsSwipe: you'll see and can fix their production
incidents, and you're paged when nobody answers in 5 minutes.</p>
<p><a href="${
    esc(link)
  }" style="display:inline-block;background:#10B981;color:#0A0A0A;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Join the team</a></p>
<p>Or in the app: Settings → Team → Join, code <b style="font-family:monospace">${esc(code)}</b></p>
<p style="color:#666">New to OpsSwipe? Install it, sign up, then open the link again. The invite works for 7 days.</p>
</div>`;
  return { subject, text, html };
}
