// GitHub redirects here after the user installs the OpsSwipe GitHub App (with OAuth during
// install). We only bounce the one-time code and installation id back to the app; the app then
// calls /connect github_complete, where the server verifies the installation belongs to the user.
const ALLOWED = ['code', 'installation_id', 'setup_action'];

Deno.serve((req) => {
  const incoming = new URL(req.url).searchParams;
  const out = new URLSearchParams();
  for (const k of ALLOWED) {
    const v = incoming.get(k);
    if (v && /^[\w-]{1,200}$/.test(v)) out.set(k, v);
  }
  return new Response(null, { status: 302, headers: { Location: `opsswipe://connect?${out}` } });
});
