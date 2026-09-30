// Monday report for every account with services (pg_cron, same secret as the health check).
import { db, env, json } from '../_shared/db.ts';
import { timingSafeEqual } from '../_shared/hmac.ts';
import { notify } from '../_shared/services.ts';
import { weeklySummary } from '../_shared/weekly.ts';

Deno.serve(async (req) => {
  if (!timingSafeEqual(req.headers.get('x-cron-secret') ?? '', env('CRON_SECRET'))) {
    return json(403, { error: 'forbidden' });
  }
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: services } = await db.from('services').select('owner');
  const perOwner = new Map<string, number>();
  for (const s of services ?? []) perOwner.set(s.owner, (perOwner.get(s.owner) ?? 0) + 1);

  let sent = 0;
  for (const [owner, count] of perOwner) {
    const { data: incidents } = await db.from('incidents').select('id, created_at, recovered_at, resolved_at, context')
      .eq('owner', owner)
      .not('service_id', 'is', null).gte('created_at', since);
    // Everything done on this account's outages, by the owner or a teammate.
    const { data: audits } = await db.from('audit_log').select('incident_id, action, outcome')
      .in('incident_id', (incidents ?? []).map((i) => i.id));
    const dismissed = new Set((audits ?? []).filter((a) => a.outcome === 'dismissed').map((a) => a.incident_id));
    const { count: quiet } = await db.from('quiet_alerts').select('id', { count: 'exact', head: true })
      .eq('owner', owner).gte('received_at', since);
    await notify(
      owner,
      weeklySummary(count, (incidents ?? []).filter((i) => !dismissed.has(i.id)), audits ?? [], Date.now(), quiet ?? 0),
    );
    sent++;
  }
  return json(200, { sent });
});
