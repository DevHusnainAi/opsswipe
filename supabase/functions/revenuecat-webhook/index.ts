// RevenueCat webhooks keep a local copy of each user's Pro plan (table `entitlements`), so the pager
// keeps working when RevenueCat's API doesn't: execute falls back to this row. The Authorization
// header is the shared value set in the RevenueCat dashboard (secret RC_WEBHOOK_AUTH).
import { db, env, json } from '../_shared/db.ts';
import { planFromEvent } from '../_shared/entitlement.ts';
import { timingSafeEqual } from '../_shared/hmac.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const expected = env('RC_WEBHOOK_AUTH');
  if (!expected || !timingSafeEqual(req.headers.get('Authorization') ?? '', expected)) {
    return json(401, { error: 'unauthorized' });
  }
  const body = await req.json().catch(() => null);
  const plan = planFromEvent(body?.event ?? {});
  if (!plan) return json(200, { ignored: true }); // TEST events, other entitlements, anonymous ids
  const { error } = await db.from('entitlements').upsert({ ...plan, updated_at: new Date().toISOString() });
  // A user deleted meanwhile violates the foreign key: nothing to keep, and no reason to retry.
  if (error && error.code !== '23503') return json(500, { error: 'could not store the plan' }); // RevenueCat retries
  return json(200, { stored: !error });
});
