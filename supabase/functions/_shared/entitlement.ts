// RevenueCat REST v1 entitlement: active if it never expires or expires in the future.
export type Entitlement = { expires_date: string | null } | undefined;

export const isActive = (e: Entitlement, now = new Date()) =>
  !!e && (e.expires_date === null || new Date(e.expires_date) > now);
