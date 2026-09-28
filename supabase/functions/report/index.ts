// Event-driven detection: a service reports its own failing requests the moment they happen.
// POST /report?service=<id>, signed with that service's own HMAC secret (shown once at connect).
// Only 5xx responses count; samples are scrubbed and kept so a PR can be proven against them.
// Optional `release`: the commit the app is running (e.g. GIT_SHA set at deploy). On hosts with no
// deploy history of their own (a VM), it tells a revert or AI fix which commit broke things.
import { json } from '../_shared/db.ts';
import { verify } from '../_shared/hmac.ts';
import { reportFailure } from '../_shared/incidents.ts';
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

  const metric = `${sample.method} ${sample.path} → ${sample.status} (reported by the app)`;
  const release = typeof body.release === 'string' && /^[0-9a-f]{40}$/.test(body.release) ? body.release : undefined;
  return json(200, await reportFailure(service, sample, metric, release));
});
