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
    const [{ data: incidents }, { data: audits }] = await Promise.all([
      db.from('incidents').select('id, created_at, recovered_at, resolved_at, context').eq('owner', owner)
        .not('service_id', 'is', null).gte('created_at', since),
      db.from('audit_log').select('incident_id, action, outcome').eq('actor', owner).gte('created_at', since),
    ]);
    const dismissed = new Set((audits ?? []).filter((a) => a.outcome === 'dismissed').map((a) => a.incident_id));
    await notify(owner, weeklySummary(count, (incidents ?? []).filter((i) => !dismissed.has(i.id)), audits ?? []));
    sent++;
  }
  return json(200, { sent });
});
