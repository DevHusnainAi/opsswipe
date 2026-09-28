// Sentry issue alerts open OpsSwipe incidents, with no code change in the user's app.
//   POST /sentry?service=<id>   (the webhook URL of the user's Sentry Internal Integration)
// Signed with that integration's Client Secret, which the user pastes into OpsSwipe once.
import { json } from '../_shared/db.ts';
import { verifyHex } from '../_shared/hmac.ts';
import { reportFailure } from '../_shared/incidents.ts';
import { fromSentry } from '../_shared/sentry.ts';
import { getService, readSecret } from '../_shared/services.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }; // Supabase Edge runtime global

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const id = new URL(req.url).searchParams.get('service') ?? '';
  if (!UUID.test(id)) return json(400, { error: 'service id required' });
  const raw = await req.text();
  if (raw.length > 256_000) return json(413, { error: 'payload too large' });

  const service = await getService(id);
  const secret = service?.sentry_secret_id ? await readSecret(service.sentry_secret_id) : null;
  // Same answer for "no such service" and "bad signature": don't reveal which ids exist.
  if (!service || !secret || !(await verifyHex(secret, raw, req.headers.get('sentry-hook-signature')))) {
    return json(401, { error: 'bad signature' });
  }
  // Installation and other resources are acknowledged and ignored; only alerts page anyone.
  if (req.headers.get('sentry-hook-resource') !== 'event_alert') return json(200, { ignored: true });

  let parsed;
  try {
    parsed = fromSentry(JSON.parse(raw));
  } catch {
    return json(400, { error: 'invalid JSON' });
  }
  if (!parsed) return json(200, { ignored: true });
  // Sentry expects an answer within a second; opening an incident (deploy history, suggestion) can take longer.
  EdgeRuntime.waitUntil(
    reportFailure(service, parsed.sample, parsed.metric, parsed.release, true).catch((e) => {
      console.error('sentry incident failed:', String(e));
    }),
  );
  return json(202, { accepted: true });
});
