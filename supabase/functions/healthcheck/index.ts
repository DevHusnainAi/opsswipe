// Called by pg_cron every minute. A liveness check for every connected service (services too dead
// to report their own failures), plus recovery proof: a healthy service stamps recovered_at on
// its last fix. App-level failures arrive event-driven through /report instead.
import { env, json } from '../_shared/db.ts';
import { markRecovered, openIncident } from '../_shared/incidents.ts';
import { scrubSample } from '../_shared/replay.ts';
import { allServices, type Service } from '../_shared/services.ts';

async function check(s: Service) {
  const t0 = Date.now();
  const status = await fetch(s.config.url, { signal: AbortSignal.timeout(4000) }).then(
    async (r) => (await r.body?.cancel(), String(r.status)),
    (e) => e.name,
  );
  const ms = Date.now() - t0;
  if (status.startsWith('2')) {
    await markRecovered(s.id);
    return { service: s.id, up: true, ms };
  }
  const url = new URL(s.config.url);
  const metric = `GET ${url.host} → ${status} (${ms}ms)`;
  // The failing probe becomes a replay sample, so a PR can still be proven when the app didn't
  // report anything itself. Network errors count as 599; a 4xx isn't an outage to replay.
  const code = Number(status);
  const sample = scrubSample({ method: 'GET', path: url.pathname + url.search, status: code >= 500 ? code : 599 });
  const samples = !code || code >= 500 ? [sample!] : [];
  const { opened } = await openIncident(s, 'HTTP health check failing', metric, samples);
  return { service: s.id, up: false, opened };
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== env('CRON_SECRET')) return json(403, { error: 'forbidden' });
  const results = await Promise.allSettled((await allServices()).map(check));
  return json(200, results.map((r) => (r.status === 'fulfilled' ? r.value : { error: String(r.reason) })));
});
