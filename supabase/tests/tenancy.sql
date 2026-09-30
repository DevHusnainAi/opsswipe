-- Multi-tenant isolation and vault access. Run against a migrated DB (see meter.sql).
begin;
grant select on incidents, services, connections, audit_log, push_tokens, team_members to authenticated;

do $$
declare
  alice uuid := gen_random_uuid();
  bob uuid := gen_random_uuid();
  carol uuid := gen_random_uuid();
  s_alice uuid;
  secret_id uuid;
begin
  insert into auth.users values (alice), (bob), (carol);
  insert into team_members (owner, member) values (alice, carol); -- carol is on alice's team
  insert into services (owner, name, provider, config) values (alice, 'web', 'render', '{"serviceId":"srv-1","url":"u"}')
    returning id into s_alice;
  insert into services (owner, name, provider, config) values (bob, 'web', 'render', '{"serviceId":"srv-2","url":"u"}');
  insert into incidents (title, target_server, metric, action, service_id, owner) values ('t', 'web', 'm', 'restart', s_alice, alice);
  insert into connections (owner, kind, account) values (alice, 'github', 'alice-gh'), (alice, 'google', 'a@x.com');
  insert into push_tokens (token, owner) values ('ExponentPushToken[alice]', alice), ('ExponentPushToken[bob]', bob);

  -- the same name on two accounts is fine; one open incident per service
  begin
    insert into incidents (title, target_server, metric, action, service_id, owner) values ('t', 'web', 'm', 'restart', s_alice, alice);
    assert false, 'second open incident on the same service must be rejected';
  exception when unique_violation then null;
  end;

  secret_id := opsswipe_store_secret('rnd_supersecret');
  assert opsswipe_read_secret(secret_id) = 'rnd_supersecret', 'vault round trip';
  perform opsswipe_delete_secret(secret_id);
  assert opsswipe_read_secret(secret_id) is null, 'deleted secret is gone';

  perform set_config('test.uid', bob::text, true);
end $$;

-- A teammate sees the owner's incidents (to fix them), and nothing else of the owner's.
do $$ begin perform set_config('test.uid', (select member::text from team_members limit 1), true); end $$;
set local role authenticated;
do $$
begin
  assert (select count(*) from incidents) = 1, 'carol sees alice''s incident';
  assert (select count(*) from services) = 0, 'but not her services';
  assert (select count(*) from connections) = 0, 'or her connections';
  assert (select count(*) from team_members) = 1, 'carol sees the team she is on';
end $$;
reset role;
do $$ begin perform set_config('test.uid', (select owner::text from services where config->>'serviceId' = 'srv-2'), true); end $$;

set local role authenticated;
do $$
begin
  assert (select count(*) from services) = 1, 'bob sees only his own service';
  assert (select count(*) from incidents) = 0, 'bob cannot see alice''s incidents';
  assert (select count(*) from connections) = 0, 'bob cannot see alice''s connections';
  assert (select count(*) from push_tokens) = 0, 'push tokens are server-only, even your own';
end $$;
reset role;

do $$
begin
  assert not has_function_privilege('authenticated', 'opsswipe_read_secret(uuid)', 'execute'), 'users cannot read vault';
  assert has_function_privilege('service_role', 'opsswipe_read_secret(uuid)', 'execute'), 'the server can';
  raise notice 'tenancy.sql: all assertions passed';
end $$;
rollback;
