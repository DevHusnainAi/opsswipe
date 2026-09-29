// GitHub (after installing the OpsSwipe GitHub App), Google (after "Connect Google Cloud") and Slack/Discord
// (after "Add to Slack/Discord") redirect here. For a state the server issued, the provider's code is
// exchanged here and the result kept under a one-time claim that travels in the redirect to the device
// that approved; the app of the user who started it claims it (_shared/oauthState.ts). Nothing is connected
// on the state alone, so a link forwarded to someone else connects nothing.
// Also Supabase sign-in from Expo Go (?to=auth): Supabase refuses redirects to raw IP hosts like
// exp://192.168.x.x, so it lands here and we forward its one-time PKCE code.
import { returnBase } from '../_shared/appLink.ts';
import { installUrl } from '../_shared/githubApp.ts';
import { exchange, newState, takeState } from '../_shared/oauthState.ts';

const ALLOWED = ['code', 'state', 'error', 'error_code'];

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

  // A connect flow: the code is used here and never forwarded.
  const code = out.get('code');
  if (path === 'connect') {
    out.delete('code');
    const pending = code ? await takeState(state?.split('~')[0] ?? '') : null;
    if (pending) {
      try {
        const installationId = Number(incoming.get('installation_id')) || undefined;
        const r = await exchange(state!.split('~')[0], pending.kind, code!, installationId);
        // Authorized but not installed yet: on to the install page, with a fresh one-time state (keeping
        // the Expo Go return address, if any). Installing comes back here and finishes.
        if (!r.installed) {
          const next = [await newState(pending.owner, 'github'), ...(state?.split('~').slice(1) ?? [])].join('~');
          return new Response(null, { status: 302, headers: { Location: `${installUrl()}?state=${next}` } });
        }
        out.set('claim', r.claim);
        out.set('done', pending.kind);
      } catch (e) {
        console.error('oauth exchange failed:', String(e));
        out.set('error', `${pending.kind}_failed`);
      }
    } else if (code) out.set('error', 'start_in_app'); // no state we issued: start from the app
  }
  // A plain 302 keeps the user's tap, which Chrome requires before it opens an app link.
  return new Response(null, { status: 302, headers: { Location: `${base}${path}?${out}` } });
});
