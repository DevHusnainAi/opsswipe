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

// The invite: a link that opens the app and joins the team (after signing up, for someone new). Email-client safe:
// tables and inline styles only (Gmail and Outlook drop <style>, SVG and most layout CSS), no remote images, and a
// hidden preheader for the inbox preview line.
export function inviteMail(inviter: { name: string; email: string }, link: string) {
  const from = inviter.name;
  const subject = `${from} added you to their on-call team on OpsSwipe`;
  const text = [
    `${from} (${inviter.email}) added you to their on-call team on OpsSwipe.`,
    '',
    'As a teammate you:',
    '- see their production incidents as cards on your phone,',
    '- can fix them with a swipe and your fingerprint (their keys stay with them),',
    '- get paged when an outage goes 5 minutes without an answer.',
    '',
    `Join the team: ${link}`,
    '',
    'Open the link on your phone. New to OpsSwipe? Install the app and sign up, then open the link again.',
    'This invite works for 7 days. If you did not expect it, ignore this email: nothing happens unless you join.',
  ].join('\n');

  const f = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  const perk = (title: string, body: string) =>
    `<tr><td style="padding:0 0 14px 0;vertical-align:top;width:22px"><div style="width:8px;height:8px;border-radius:4px;background:#10B981;margin-top:7px"></div></td>
<td style="padding:0 0 14px 0;${f};font-size:15px;line-height:22px;color:#D4D4D8"><b style="color:#FAFAFA">${title}</b> ${body}</td></tr>`;
  const html =
    `<!doctype html><html><head><meta name="color-scheme" content="dark light"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0A0A0A">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Join ${
      esc(from)
    }'s on-call team: fix their incidents from your phone.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
  <tr><td style="padding:0 4px 24px 4px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="width:26px;height:30px;vertical-align:middle">
        <div style="width:15px;height:21px;border:2px solid #10B981;border-radius:4px;background:#27272A;transform:rotate(-8deg);display:inline-block"></div><div style="width:15px;height:21px;border-radius:4px;background:#ECECEC;margin-left:-8px;display:inline-block;transform:rotate(8deg)"></div>
      </td>
      <td style="padding-left:10px;${f};font-size:18px;font-weight:700;color:#FAFAFA;letter-spacing:-0.2px">OpsSwipe</td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#161616;border:1px solid #27272A;border-radius:16px;padding:32px 28px">
    <div style="${f};font-size:13px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:#10B981">Team invite</div>
    <h1 style="margin:10px 0 6px 0;${f};font-size:24px;line-height:31px;font-weight:700;color:#FAFAFA">Join ${
      esc(from)
    }'s on-call team</h1>
    <p style="margin:0 0 18px 0;${f};font-size:13px;line-height:20px;color:#71717A">Invited by ${esc(inviter.email)}</p>
    <p style="margin:0 0 24px 0;${f};font-size:15px;line-height:23px;color:#A1A1AA">When their production breaks, OpsSwipe puts one card on the phone with the likely cause and a fix, and only lets code fixes merge after CI proves them against the requests that failed.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      ${perk('See every incident', 'as a card on your phone, with what broke and why.')}
      ${perk('Fix it with a swipe', 'and your fingerprint. Their cloud keys never leave the server.')}
      ${perk('Get paged', 'when an outage goes 5 minutes without an answer.')}
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0 8px 0"><tr><td style="border-radius:12px;background:#10B981">
      <a href="${
      esc(link)
    }" style="display:inline-block;padding:14px 28px;${f};font-size:16px;font-weight:700;color:#0A0A0A;text-decoration:none;border-radius:12px">Join the team</a>
    </td></tr></table>
    <p style="margin:16px 0 0 0;${f};font-size:13px;line-height:20px;color:#71717A">Open this on your phone. New to OpsSwipe? Install the app and sign up, then tap the button again.</p>
  </td></tr>
  <tr><td style="padding:20px 8px 0 8px;${f};font-size:12px;line-height:18px;color:#71717A">
    This invite works for 7 days. Didn't expect it? Ignore this email: nothing happens unless you join.<br>
    Button not working? Paste this into your phone's browser:<br><a href="${
      esc(link)
    }" style="color:#A1A1AA;word-break:break-all">${esc(link)}</a>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject, text, html };
}
