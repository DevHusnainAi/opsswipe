-- Connect Railway with OAuth (project-scoped, chosen on Railway's consent screen) next to a pasted token.
alter table oauth_states drop constraint oauth_states_kind_check;
alter table oauth_states add constraint oauth_states_kind_check
  check (kind in ('github', 'google', 'slack', 'discord', 'railway'));

-- Railway rotates refresh tokens: every refresh returns the one to use next, so the stored grant is updated in
-- place (the connection keeps pointing at the same secret).
create function opsswipe_update_secret(secret_id uuid, value text) returns void
language sql security definer set search_path = '' as $$
  select vault.update_secret(secret_id, value);
$$;
revoke execute on function opsswipe_update_secret from public, anon, authenticated;
grant execute on function opsswipe_update_secret to service_role;
