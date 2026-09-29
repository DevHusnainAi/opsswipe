// POST /alerts?k=<inbox key>: alerts from Alertmanager, Grafana or any tool sending JSON (see _shared/inbox.ts).
// The key is the secret, like a Slack webhook URL; it is 24 random characters and can be replaced in the app.
import { db, json } from '../_shared/db.ts';
import { openIncident, openIncidentFor } from '../_shared/incidents.ts';
import { matchService, parseAlerts } from '../_shared/inbox.ts';
import type { Service } from '../_shared/services.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const key = new URL(req.url).searchParams.get('k') ?? '';
  if (!/^[a-z0-9]{24}$/.test(key)) return json(401, { error: 'bad inbox key' });
  const { data: inbox } = await db.from('alert_inboxes').select('owner').eq('key', key).maybeSingle();
  if (!inbox) return json(401, { error: 'bad inbox key' });
  const raw = await req.text();
  if (raw.length > 262_144) return json(413, { error: 'too large' });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'invalid JSON' });
  }
  const { data: services } = await db.from('services').select().eq('owner', inbox.owner);
  let paged = 0, quiet = 0;
  for (const a of parseAlerts(body).filter((x) => x.firing)) {
    const s = matchService(a.target, (services ?? []) as Service[]);
    if (s) {
      // One open card per service: the first alert opens it, the next 49 only raise its count.
      await openIncident(s, `Alert: ${a.name}`, a.summary);
      const open = await openIncidentFor(s.id);
      if (open) {
        const ctx = open.context as { alert_count?: number };
        await db.from('incidents').update({ context: { ...ctx, alert_count: (ctx.alert_count ?? 0) + 1 } })
          .eq('id', open.id);
        paged++;
        continue;
      }
    }
    await db.from('quiet_alerts').insert({ owner: inbox.owner, name: a.name, summary: a.summary, target: a.target });
    quiet++;
  }
  return json(200, { paged, quiet });
});
