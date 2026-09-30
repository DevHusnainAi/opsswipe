-- Public status pages: an unguessable slug per account. The page shows only service names, up/down,
-- daily downtime and incident titles (supabase/functions/status). Server only, no policies.
create table status_pages (
  owner uuid primary key references auth.users (id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9]{10}$'),
  created_at timestamptz not null default now()
);
alter table status_pages enable row level security;
