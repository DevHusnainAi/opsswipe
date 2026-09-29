-- Guarantees that must not regress quietly: every client write is refused (all writes go through Edge
-- Functions), every table has RLS on, the team audit policy shows exactly the owner's incident trail,
-- context updates merge, the team cap holds, and a push token can belong to two accounts.
begin;
-- Grant everything: RLS alone must refuse writes, so a future stray grant can't open them.
grant select, insert, update, delete on incidents, services, connections, audit_log, push_tokens, team_members,
  usage, entitlements, fix_keys, oauth_states to authenticated;

do $$
declare
  alice uuid := '00000000-0000-4000-8000-00000000000a';
  bob uuid := '00000000-0000-4000-8000-00000000000b';
  carol uuid := '00000000-0000-4000-8000-00000000000c';
  s_alice uuid;
  s_bob uuid;
  i_alice uuid;
  i_bob uuid;
  n int;
begin
  insert into auth.users values (alice), (bob), (carol);
  insert into team_members (owner, member) values (alice, carol);
  insert into services (owner, name, provider, config) values (alice, 'web', 'render', '{"serviceId":"srv-1","url":"u"}')
    returning id into s_alice;
  insert into services (owner, name, provider, config) values (bob, 'web', 'render', '{"serviceId":"srv-2","url":"u"}')
    returning id into s_bob;
  insert into incidents (title, target_server, metric, action, service_id, owner) values ('t', 'web', 'm', 'restart', s_alice, alice)
    returning id into i_alice;
  insert into incidents (title, target_server, metric, action, service_id, owner) values ('t', 'web', 'm', 'restart', s_bob, bob)
    returning id into i_bob;
  insert into audit_log (incident_id, actor, action, target, outcome) values
    (i_alice, alice, 'restart', 'web', 'executed'),
    (i_bob, bob, 'restart', 'web', 'executed'),
    (null, alice, 'restart', 'web', 'failed'); -- alice's own row with no incident
  insert into fix_keys (owner, key_hash) values (alice, 'h');
  insert into oauth_states (nonce, owner, kind) values ('n', alice, 'github');
  insert into entitlements (owner, pro_until) values (alice, 'infinity');
  insert into usage (actor, free_used) values (alice, 1);

  -- Context updates merge: two writers adding different keys both stick.
  update incidents set context = '{"ai": {"agreed": true}}' where id = i_alice;
  update incidents set context = '{"proof": {"ok": true}}' where id = i_alice;
  assert (select context ? 'ai' and context ? 'proof' from incidents where id = i_alice), 'context writes merge';

  -- Team cap: 10 people; the 11th is refused, re-joining is fine.
  insert into auth.users select gen_random_uuid() from generate_series(1, 9);
  insert into team_members (owner, member) select alice, id from auth.users where id not in (alice, bob, carol);
  assert (select count(*) from team_members where owner = alice) = 10;
  begin
    insert into team_members (owner, member) values (alice, bob);
    assert false, 'an 11th member must be refused';
  exception when check_violation then null;
  end;
  insert into team_members (owner, member) values (alice, carol) on conflict do nothing; -- already in: fine

  -- One phone, two accounts: each keeps its own row, neither takes the other's.
  insert into push_tokens (token, owner) values ('ExponentPushToken[phone]', alice), ('ExponentPushToken[phone]', bob);
  assert (select count(*) from push_tokens where token = 'ExponentPushToken[phone]') = 2;

  -- Every table in public has RLS on, so a new table can't ship readable by everyone.
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  assert n = 0, format('%s public table(s) without RLS', n);
end $$;

-- As alice, with full grants: no insert, update or delete gets through RLS.
do $$ begin perform set_config('test.uid', '00000000-0000-4000-8000-00000000000a', true); end $$;
set local role authenticated;
do $$
declare
  t text;
  n int;
  col text;
begin
  foreach t in array array['incidents', 'services', 'connections', 'audit_log', 'push_tokens', 'team_members', 'usage',
    'entitlements', 'fix_keys', 'oauth_states'] loop
    col := case when t in ('audit_log', 'usage') then 'actor' else 'owner' end;
    execute format('update %I set %I = %I', t, col, col);
    get diagnostics n = row_count;
    assert n = 0, format('client update on %s changed %s row(s)', t, n);
    execute format('delete from %I', t);
    get diagnostics n = row_count;
    assert n = 0, format('client delete on %s removed %s row(s)', t, n);
  end loop;
  begin
    insert into incidents (title, target_server, metric, action, owner) values ('spoof', 'web', 'm', 'restart', auth.uid());
    assert false, 'client insert into incidents must be refused';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into entitlements (owner, pro_until) values (auth.uid(), 'infinity');
    assert false, 'a client must not grant itself Pro';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into fix_keys (owner, key_hash) values (auth.uid(), 'mine');
    assert false, 'a client must not add its own fix key';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into audit_log (incident_id, actor, action, target, outcome) values (null, auth.uid(), 'x', 'y', 'executed');
    assert false, 'a client must not write the audit log';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Carol (on alice's team) sees the audit trail of alice's incident, her own rows, and nothing else.
do $$ begin perform set_config('test.uid', '00000000-0000-4000-8000-00000000000c', true); end $$;
set local role authenticated;
do $$
begin
  assert (select count(*) from audit_log) = 1, 'exactly alice''s incident audit row';
  assert (select count(*) from audit_log where actor = '00000000-0000-4000-8000-00000000000b') = 0, 'nothing of bob''s';
  assert (select count(*) from audit_log where incident_id is null) = 0, 'not alice''s rows outside incidents';
end $$;
reset role;

do $$ begin raise notice 'hardening.sql: all assertions passed'; end $$;
rollback;
