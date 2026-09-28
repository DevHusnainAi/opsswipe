-- One-time OAuth states: the server finishes a GitHub install or Google sign-in itself when the provider
-- calls back, so a lost deep link back to the phone (dev builds, aggressive Android memory) loses nothing.
create table oauth_states (
  nonce text primary key,
  owner uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('github', 'google')),
  created_at timestamptz not null default now()
);
alter table oauth_states enable row level security; -- server only, no policies
