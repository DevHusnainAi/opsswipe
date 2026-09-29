// Public status page data: GET /status?s=<slug> -> JSON (no sign-in). The page itself is static HTML
// elsewhere (status-page/index.html): Supabase serves HTML as text/plain without a custom domain.
// Dismissed false alarms and agent approvals are not outages, so they're left out.
import { db } from '../_shared/db.ts';
import { DAYS, publicIncident, type ShareIncident, statusReport } from '../_shared/status.ts';

const CORS = { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=30' };
const out = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { ...CORS, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  // ?r=<share id>: one resolved incident's public report (status-page/incident.html).
  const share = new URL(req.url).searchParams.get('r');
  if (share !== null) {
    if (!/^[a-z0-9]{12}$/.test(share)) return out(400, { error: 'report id required' });
    const { data: inc } = await db.from('incidents')
      .select('id, service_id, title, target_server, created_at, recovered_at, resolved_at, status, context')
      .eq('share_slug', share).eq('status', 'resolved').maybeSingle();
    if (!inc) return out(404, { error: 'no such report' });
    const { data: fixes } = await db.from('audit_log').select('action, created_at').eq('incident_id', inc.id)
      .eq('outcome', 'executed').order('created_at');
    return out(200, publicIncident(inc as ShareIncident, fixes ?? []));
  }
  const slug = new URL(req.url).searchParams.get('s') ?? '';
  if (!/^[a-z0-9]{10}$/.test(slug)) return out(400, { error: 'status page id required' });
  const { data: page } = await db.from('status_pages').select('owner').eq('slug', slug).maybeSingle();
  if (!page) return out(404, { error: 'no such status page' });

  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const [{ data: services }, { data: incidents }] = await Promise.all([
    db.from('services').select('id, name').eq('owner', page.owner).order('name'),
    db.from('incidents').select('id, service_id, title, created_at, recovered_at, resolved_at, status')
      .eq('owner', page.owner).not('service_id', 'is', null).gte('created_at', since),
  ]);
  // Whoever dismissed it (the owner or a teammate), a false alarm isn't downtime.
  const { data: dismissed } = await db.from('audit_log').select('incident_id').eq('outcome', 'dismissed')
    .in('incident_id', (incidents ?? []).map((i) => i.id));
  const skip = new Set((dismissed ?? []).map((d) => d.incident_id));
  return out(200, statusReport(services ?? [], (incidents ?? []).filter((i) => !skip.has(i.id))));
});
