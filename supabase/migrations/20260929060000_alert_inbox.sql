-- The alert inbox: one private URL per account for alerts from the tools a team already runs. Alerts about
-- a watched service join its card; the rest are kept here, quietly, and counted in the weekly report.
create table alert_inboxes (
  owner uuid primary key references auth.users (id) on delete cascade,
  key text not null unique check (key ~ '^[a-z0-9]{24}$'),
  created_at timestamptz not null default now()
);
create table quiet_alerts (
  id bigint generated always as identity primary key,
  owner uuid not null references auth.users (id) on delete cascade,
  name text not null,
  summary text not null,
  target text not null,
  received_at timestamptz not null default now()
);
create index quiet_alerts_owner_time on quiet_alerts (owner, received_at);
alter table alert_inboxes enable row level security; -- server only, no policies
alter table quiet_alerts enable row level security;
create policy "owners see their quiet alerts" on quiet_alerts for select to authenticated using (owner = auth.uid());
