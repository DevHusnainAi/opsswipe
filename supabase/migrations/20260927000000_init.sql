create table incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  target_server text not null,
  environment text not null default 'production',
  severity text not null default 'CRITICAL',
  metric text not null,
  action text not null default 'reboot',
  status text not null default 'active' check (status in ('active', 'resolving', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- one open incident per server, so overlapping health checks can't double-page
create unique index one_open_incident on incidents (target_server) where status in ('active', 'resolving');

create table audit_log (
  id bigint generated always as identity primary key,
  incident_id uuid references incidents (id),
  actor uuid not null,
  action text not null,
  target text not null,
  outcome text not null check (outcome in ('executed', 'paywalled', 'failed')),
  detail text,
  created_at timestamptz not null default now()
);

create table usage (
  actor uuid primary key,
  free_used int not null default 0
);

-- clients only read; every write goes through the execute/healthcheck functions (service role)
alter table incidents enable row level security;
alter table audit_log enable row level security;
alter table usage enable row level security;
create policy "signed-in users see incidents" on incidents for select to authenticated using (true);
create policy "users see their own audit trail" on audit_log for select to authenticated using (actor = auth.uid());
create policy "users see their own usage" on usage for select to authenticated using (actor = auth.uid());

alter publication supabase_realtime add table incidents, audit_log, usage;

-- atomic metering: returns true only if a free run was available and consumed
create function consume_free_run(uid uuid, free_limit int) returns boolean
language sql as $$
  insert into usage (actor, free_used) values (uid, 1)
  on conflict (actor) do update set free_used = usage.free_used + 1
    where usage.free_used < free_limit
  returning true;
$$;

create function refund_free_run(uid uuid) returns void
language sql as $$
  update usage set free_used = free_used - 1 where actor = uid and free_used > 0;
$$;

revoke execute on function consume_free_run, refund_free_run from public, anon, authenticated;
