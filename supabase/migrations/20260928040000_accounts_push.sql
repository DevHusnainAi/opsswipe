-- Connect v2: a short-lived Google connection (deleted after granting a VM) and phones to page.
alter table connections drop constraint connections_kind_check;
alter table connections add constraint connections_kind_check check (kind in ('github', 'render', 'google'));

-- Expo push tokens. Server only: RLS on with no policies, so the app can't read anyone's tokens.
create table push_tokens (
  token text primary key,
  owner uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table push_tokens enable row level security;
