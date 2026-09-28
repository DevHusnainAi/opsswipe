// GitHub (after installing the OpsSwipe GitHub App) and Google (after "Connect Google Cloud")
// redirect here. We only bounce the one-time code back to the app, which hands it to /connect,
// where the server exchanges and verifies it for the signed-in user.
// Also Supabase sign-in from Expo Go (?to=auth): Supabase refuses redirects to raw IP hosts like
// exp://192.168.x.x, so it lands here and we forward; the session travels in the URL fragment,
// which the browser carries across this redirect untouched.
import { returnBase } from '../_shared/appLink.ts';

const ALLOWED = ['code', 'installation_id', 'setup_action', 'state', 'error', 'error_code'];

Deno.serve((req) => {
  const incoming = new URL(req.url).searchParams;
  const out = new URLSearchParams();
  for (const k of ALLOWED) {
    const v = incoming.get(k);
    if (v && /^[\w\-./~]{1,512}$/.test(v)) out.set(k, v); // Google codes look like "4/0Ab..."
  }
  const desc = incoming.get('error_description');
  if (desc && /^[\w .,'()-]{1,300}$/.test(desc)) out.set('error_description', desc);
  const base = returnBase(incoming.get('state'));
  const path = incoming.get('to') === 'auth' ? 'auth' : 'connect';
  return new Response(null, { status: 302, headers: { Location: `${base}${path}?${out}` } });
});
