-- Multi-tenant Connect: each user connects their own services, GitHub and Render.
-- Credentials live encrypted in Supabase Vault; tables only hold references to them.

create table services (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users (id) on delete cascade,
  name text not null,
  provider text not null check (provider in ('gcp', 'render')),
  -- non-secret config: render {serviceId, url, repo?, branch?} | gcp {project, zone, instance, url}
  config jsonb not null,
  report_secret_id uuid, -- vault: HMAC secret the service signs failure reports with
  created_at timestamptz not null default now(),
  unique (owner, name)
);

create table connections (
  owner uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('github', 'render')),
  secret_id uuid,            -- vault: render API key
  installation_id bigint,    -- github app installation, verified to belong to this user
  account text,              -- display only: github login / render owner
  created_at timestamptz not null default now(),
  primary key (owner, kind)
);

-- Incidents now belong to a service and its owner.
alter table incidents add column service_id uuid references services (id) on delete cascade;
alter table incidents add column owner uuid references auth.users (id) on delete cascade;
drop index one_open_incident;
create unique index one_open_incident on incidents (service_id) where status in ('active', 'resolving');

-- Row-level security: everyone sees only their own rows; all writes go through Edge Functions.
alter table services enable row level security;
alter table connections enable row level security;
create policy "owners see their services" on services for select to authenticated using (owner = auth.uid());
create policy "owners see their connections" on connections for select to authenticated using (owner = auth.uid());
drop policy "signed-in users see incidents" on incidents;
create policy "owners see their incidents" on incidents for select to authenticated using (owner = auth.uid());

alter publication supabase_realtime add table services, connections;

-- Vault access for the server only (service role).
create function opsswipe_store_secret(value text) returns uuid
language sql security definer set search_path = '' as $$
  select vault.create_secret(value);
$$;

create function opsswipe_read_secret(secret_id uuid) returns text
language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where id = secret_id;
$$;

create function opsswipe_delete_secret(secret_id uuid) returns void
language sql security definer set search_path = '' as $$
  delete from vault.secrets where id = secret_id;
$$;

revoke execute on function opsswipe_store_secret, opsswipe_read_secret, opsswipe_delete_secret
  from public, anon, authenticated;
grant execute on function opsswipe_store_secret, opsswipe_read_secret, opsswipe_delete_secret to service_role;
