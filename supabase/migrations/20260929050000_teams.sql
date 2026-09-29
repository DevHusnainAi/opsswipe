-- Teams: an owner invites teammates (one-time code). Teammates see and can fix the owner's incidents
-- (execute checks the same), and get paged when an incident sits unanswered (healthcheck escalates).
-- They never see the owner's services, connections or keys: those policies stay owner-only.
create table team_members (
  owner uuid not null references auth.users (id) on delete cascade,
  member uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner, member),
  check (owner <> member)
);
create index team_members_member on team_members (member);
create table team_invites (
  code text primary key check (code ~ '^[A-Z2-9]{8}$'),
  owner uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table team_members enable row level security;
alter table team_invites enable row level security; -- server only, no policies
create policy "members see their teams" on team_members for select to authenticated
  using (owner = auth.uid() or member = auth.uid());

drop policy "owners see their incidents" on incidents;
create policy "owners and their team see incidents" on incidents for select to authenticated
  using (owner = auth.uid() or owner in (select t.owner from team_members t where t.member = auth.uid()));

-- Who did what on an incident you can see (a teammate's fix on your outage, or yours on theirs).
drop policy "users see their own audit trail" on audit_log;
create policy "users see the audit trail of incidents they can see" on audit_log for select to authenticated
  using (actor = auth.uid() or incident_id in (select i.id from incidents i));
