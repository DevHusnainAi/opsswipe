-- 1. The free tier covers one whole outage, not one action: the revert PR and the proven merge of
--    the same incident are both free. Paying mid-outage is the worst moment to meet a paywall.
alter table usage add column free_incident uuid;

drop function consume_free_run(uuid, int);
drop function refund_free_run(uuid);

create function consume_free_run(uid uuid, free_limit int, incident uuid) returns boolean
language sql as $$
  insert into usage (actor, free_used, free_incident) values (uid, 1, incident)
  on conflict (actor) do update
    set free_used = usage.free_used + (usage.free_incident is distinct from incident)::int,
        free_incident = incident
    where usage.free_incident = incident or usage.free_used < free_limit
  returning true;
$$;

-- Refund only a claim that bought nothing: the first fix of that outage failed.
create function refund_free_run(uid uuid, incident uuid) returns void
language sql as $$
  update usage set free_used = free_used - 1, free_incident = null
  where actor = uid and free_incident = incident and free_used > 0
    and not exists (select 1 from audit_log where incident_id = incident and outcome = 'executed');
$$;

revoke execute on function consume_free_run, refund_free_run from public, anon, authenticated;
grant execute on function consume_free_run(uuid, int, uuid), refund_free_run(uuid, uuid) to service_role;

-- 2. A copy of each user's Pro plan, kept by RevenueCat webhooks. The execute function asks
--    RevenueCat first and falls back to this row, so a billing API outage never blocks a fix.
--    Server only: RLS on, no policies.
create table entitlements (
  owner uuid primary key references auth.users (id) on delete cascade,
  pro_until timestamptz, -- 'infinity' for lifetime
  updated_at timestamptz not null default now()
);
alter table entitlements enable row level security;
