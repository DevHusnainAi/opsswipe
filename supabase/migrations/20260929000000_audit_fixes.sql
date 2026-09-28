-- F1: one reported failure is held, not paged. A second report within a minute opens the incident.
alter table services add column pending_report jsonb, add column pending_at timestamptz;

-- S3: RevenueCat can deliver webhooks out of order; only a newer event may change the stored plan.
alter table entitlements add column event_at timestamptz not null default '-infinity';

create function store_entitlement(p_owner uuid, p_until timestamptz, p_at timestamptz) returns void
language sql as $$
  insert into entitlements (owner, pro_until, event_at, updated_at) values (p_owner, p_until, p_at, now())
  on conflict (owner) do update set pro_until = excluded.pro_until, event_at = excluded.event_at, updated_at = now()
    where entitlements.event_at < excluded.event_at;
$$;
revoke execute on function store_entitlement from public, anon, authenticated;
grant execute on function store_entitlement(uuid, timestamptz, timestamptz) to service_role;
