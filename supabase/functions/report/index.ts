// Event-driven detection: a service reports its own failing requests the moment they happen.
// Signed with HMAC-SHA256 (REPORT_SECRET); only 5xx responses count; samples are scrubbed and
// kept on the incident so a PR can later be proven against exactly these requests.
import { env, json } from '../_shared/db.ts';
import { verify } from '../_shared/hmac.ts';
import { addSamples, openIncident, openIncidentFor } from '../_shared/incidents.ts';
import { scrubSample } from '../_shared/replay.ts';
import { parseTargets } from '../_shared/targets.ts';

const TARGETS = parseTargets(env('TARGETS'));

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const raw = await req.text();
  if (raw.length > 16_384) return json(413, { error: 'report too large' });
  if (!(await verify(env('REPORT_SECRET'), raw, req.headers.get('x-opsswipe-signature')))) {
    return json(401, { error: 'bad signature' });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'invalid JSON' });
  }
  const name = String(body.target ?? '');
  const target = TARGETS[name];
  if (!target) return json(404, { error: 'unknown target' });

  const sample = scrubSample(body);
  if (!sample) return json(202, { ignored: true }); // not a 5xx, or not replayable

  const open = await openIncidentFor(name);
  if (open) {
    await addSamples(open.id, open.context ?? {}, [sample]);
    return json(200, { added: true });
  }
  const metric = `${sample.method} ${sample.path} → ${sample.status} (reported by the app)`;
  const { opened } = await openIncident(name, target, 'Requests are failing', metric, [sample]);
  return json(200, { opened });
});
