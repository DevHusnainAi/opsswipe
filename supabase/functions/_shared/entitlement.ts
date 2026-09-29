// RevenueCat REST v1 entitlement: active if it never expires or expires in the future.
export type Entitlement = { expires_date: string | null } | undefined;

export const isActive = (e: Entitlement, now = new Date()) =>
  !!e && (e.expires_date === null || new Date(e.expires_date) > now);

// RevenueCat webhook event → the plan row to keep, or null to ignore. app_user_id is our Supabase uid
// (the app configures Purchases with it); anonymous RevenueCat ids never own anything here.
// https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
export type RcEvent = {
  type?: string;
  app_user_id?: string;
  entitlement_ids?: string[] | null;
  expiration_at_ms?: number | null;
  event_timestamp_ms?: number;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Any paid plan counts: Team includes everything in Pro.
export function planFromEvent(
  e: RcEvent,
  entitlements = ['pro', 'team'],
): { owner: string; pro_until: string; event_at: string } | null {
  if (!e.app_user_id || !UUID.test(e.app_user_id) || !e.entitlement_ids?.some((x) => entitlements.includes(x))) {
    return null;
  }
  // EXPIRATION carries the moment access ended; every other event the moment it will end (null = lifetime).
  const until = e.expiration_at_ms == null ? 'infinity' : new Date(e.expiration_at_ms).toISOString();
  const at = new Date(e.event_timestamp_ms ?? Date.now()).toISOString(); // orders late deliveries
  return { owner: e.app_user_id, pro_until: until, event_at: at };
}

export const proFromRow = (row: { pro_until: string | null } | null, now = new Date()) =>
  !!row?.pro_until && (row.pro_until === 'infinity' || new Date(row.pro_until) > now);
