// Called by pg_cron every 60s. A liveness check for services too dead to report their own
// failures, plus recovery proof: a healthy target stamps recovered_at on its last fix.
// App-level failures arrive event-driven through /report instead.
import { env, json } from '../_shared/db.ts';
import { markRecovered, openIncident } from '../_shared/incidents.ts';
import { parseTargets, type Target } from '../_shared/targets.ts';

const TARGETS = parseTargets(env('TARGETS'));

async function check(name: string, t: Target) {
  const t0 = Date.now();
  const status = await fetch(t.url, { signal: AbortSignal.timeout(4000) }).then(
    async (r) => (await r.body?.cancel(), String(r.status)),
    (e) => e.name,
  );
  const ms = Date.now() - t0;
  if (status.startsWith('2')) {
    await markRecovered(name);
    return { name, up: true, ms };
  }
  const metric = `GET ${new URL(t.url).host} → ${status} (${ms}ms)`;
  const { opened } = await openIncident(name, t, 'HTTP health check failing', metric);
  return { name, up: false, opened };
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== env('CRON_SECRET')) return json(403, { error: 'forbidden' });
  return json(200, await Promise.all(Object.entries(TARGETS).map(([name, t]) => check(name, t))));
});
