// Event-driven detection: a service reports its own failing requests the moment they happen.
// POST /report?service=<id>, signed with that service's own HMAC secret (shown once at connect).
// Only 5xx responses count; samples are scrubbed and kept so a PR can be proven against them.
import { json } from '../_shared/db.ts';
import { verify } from '../_shared/hmac.ts';
import { addSamples, openIncident, openIncidentFor } from '../_shared/incidents.ts';
import { scrubSample } from '../_shared/replay.ts';
import { getService, readSecret } from '../_shared/services.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const id = new URL(req.url).searchParams.get('service') ?? '';
  if (!UUID.test(id)) return json(400, { error: 'service id required' });
  const raw = await req.text();
  if (raw.length > 16_384) return json(413, { error: 'report too large' });

  const service = await getService(id);
  const secret = service?.report_secret_id ? await readSecret(service.report_secret_id) : null;
  // Same answer for "no such service" and "bad signature": don't reveal which ids exist.
  if (!service || !secret || !(await verify(secret, raw, req.headers.get('x-opsswipe-signature')))) {
    return json(401, { error: 'bad signature' });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'invalid JSON' });
  }
  const sample = scrubSample(body);
  if (!sample) return json(202, { ignored: true }); // not a 5xx, or not replayable

  const open = await openIncidentFor(service.id);
  if (open) {
    await addSamples(open.id, open.context ?? {}, [sample]);
    return json(200, { added: true });
  }
  const metric = `${sample.method} ${sample.path} → ${sample.status} (reported by the app)`;
  const { opened } = await openIncident(service, 'Requests are failing', metric, [sample]);
  return json(200, { opened });
});
