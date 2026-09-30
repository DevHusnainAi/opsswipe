-- Team invites by email: each emailed invite is its own one-time code (the plain "Invite a teammate" code
-- stays one per owner). The address is kept only to cap how many a day one account can send.
alter table team_invites add column email text check (email is null or length(email) <= 254);
create index team_invites_owner_day on team_invites (owner, created_at);
