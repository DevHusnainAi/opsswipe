// GitHub (after installing the OpsSwipe GitHub App) and Google (after "Connect Google Cloud")
// redirect here. We only bounce the one-time code back to the app, which hands it to /connect,
// where the server exchanges and verifies it for the signed-in user.
const ALLOWED = ['code', 'installation_id', 'setup_action', 'state', 'error'];

Deno.serve((req) => {
  const incoming = new URL(req.url).searchParams;
  const out = new URLSearchParams();
  for (const k of ALLOWED) {
    const v = incoming.get(k);
    if (v && /^[\w\-./~]{1,512}$/.test(v)) out.set(k, v); // Google codes look like "4/0Ab..."
  }
  return new Response(null, { status: 302, headers: { Location: `opsswipe://connect?${out}` } });
});
