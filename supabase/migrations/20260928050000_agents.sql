-- Approval API: an AI agent proposes a fix; the owner approves it with a swipe and a fingerprint.
alter table incidents drop constraint incidents_suggested_by_check;
alter table incidents add constraint incidents_suggested_by_check check (suggested_by in ('rules', 'ai', 'agent'));

-- Agents authenticate with a token shown once at creation; only its SHA-256 is stored.
-- Server only: RLS on with no policies; the app lists and revokes tokens through /connect.
create table agent_tokens (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users (id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table agent_tokens enable row level security;
