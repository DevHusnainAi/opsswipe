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

-- P0-6: a connection finishes only on the phone the provider redirects back to. The callback keeps the
-- result here under a one-time claim (its hash), and the same user's app claims it.
alter table oauth_states
  add column completed_at timestamptz,
  add column claim_hash text unique,
  add column result jsonb;

-- P2-6: incidents.context is written by several jobs at once (the AI's second opinion, the proof,
-- escalation, alerts). An update now merges into the stored context instead of replacing it, and each
-- writer sends only its own keys, so no writer erases another's.
create function incidents_merge_context() returns trigger language plpgsql as $$
begin
  new.context := coalesce(old.context, '{}'::jsonb) || coalesce(new.context, '{}'::jsonb);
  return new;
end $$;
create trigger incidents_merge_context before update of context on incidents
  for each row execute function incidents_merge_context();

-- P2-1: a phone's push token belongs to each account signed in on it, not to whoever registered it last,
-- so one account can't take over another's pages by registering the same token.
alter table push_tokens drop constraint push_tokens_pkey;
alter table push_tokens add primary key (owner, token);

-- P2-3: at most 10 people per team, enforced where two joins at once can't both slip under the cap.
create function team_cap() returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.owner::text));
  if (select count(*) from team_members where owner = new.owner and member <> new.member) >= 10 then
    raise exception 'team is full' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger team_cap before insert on team_members for each row execute function team_cap();
