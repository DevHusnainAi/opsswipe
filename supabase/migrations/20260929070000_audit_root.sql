-- Root fixes from the Sep 29 audit. Each block names its finding.

-- P0-2: when a fix was claimed, so the health check can hand back a claim whose function died.
alter table incidents add column claimed_at timestamptz;

-- P1-7: a fix needs a key that lives in the phone's secure hardware and is only readable after the
-- fingerprint. Only its hash is kept. Server only: RLS on, no policies.
create table fix_keys (
  owner uuid not null references auth.users (id) on delete cascade,
  key_hash text not null,
  created_at timestamptz not null default now(),
  primary key (owner, key_hash)
);
alter table fix_keys enable row level security;
