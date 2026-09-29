// GitHub (after installing the OpsSwipe GitHub App), Google (after "Connect Google Cloud") and Slack/Discord
// (after "Add to Slack/Discord")
// redirect here. When the state is one the server issued, the connection is finished right here, for
// the user who started it; the app only needs to look again. Otherwise the one-time code is bounced
// back to the app, which hands it to /connect.
// Also Supabase sign-in from Expo Go (?to=auth): Supabase refuses redirects to raw IP hosts like
// exp://192.168.x.x, so it lands here and we forward; the session travels in the URL fragment,
// which the browser carries across this redirect untouched.
import { returnBase } from '../_shared/appLink.ts';
import { installUrl } from '../_shared/githubApp.ts';
import { completeChat, completeGithub, completeGoogle, newState, takeState } from '../_shared/oauthState.ts';

const ALLOWED = ['code', 'installation_id', 'setup_action', 'state', 'error', 'error_code'];

Deno.serve(async (req) => {
  const incoming = new URL(req.url).searchParams;
  const out = new URLSearchParams();
  for (const k of ALLOWED) {
    const v = incoming.get(k);
    if (v && /^[\w\-./~]{1,512}$/.test(v)) out.set(k, v); // Google codes look like "4/0Ab..."
  }
  const desc = incoming.get('error_description');
  if (desc && /^[\w .,'()-]{1,300}$/.test(desc)) out.set('error_description', desc);
  const state = incoming.get('state');
  const base = returnBase(state);
  const path = incoming.get('to') === 'auth' ? 'auth' : 'connect';

  // Finish on the server: codes are single-use, so once used here they aren't forwarded.
  const code = out.get('code');
  const pending = code && path === 'connect' ? await takeState(state?.split('~')[0] ?? '') : null;
  if (pending) {
    try {
      if (pending.kind === 'github') {
        const r = await completeGithub(pending.owner, code!, Number(out.get('installation_id')) || undefined);
        // Authorized but not installed yet: on to the install page, with a fresh one-time state
        // (keeping the Expo Go return address, if any). Installing comes back here and finishes.
        if (!r.installed) {
          const next = [await newState(pending.owner, 'github'), ...(state?.split('~').slice(1) ?? [])].join('~');
          return new Response(null, { status: 302, headers: { Location: `${installUrl()}?state=${next}` } });
        }
      } else if (pending.kind === 'google') await completeGoogle(pending.owner, code!);
      else await completeChat(pending.owner, pending.kind, code!);
      out.delete('code');
      out.set('done', pending.kind);
    } catch (e) {
      console.error('oauth completion failed:', String(e));
      out.delete('code');
      out.set('error', `${pending.kind}_failed`);
    }
  }
  // A plain 302 keeps the user's tap, which Chrome requires before it opens an app link. If the phone
  // doesn't pass the link to the app, nothing is lost: switching back shows the connection.
  return new Response(null, { status: 302, headers: { Location: `${base}${path}?${out}` } });
});
