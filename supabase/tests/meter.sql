-- Free-tier meter + incident guards. Run against a migrated DB:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/meter.sql
begin;
do $$
declare u uuid := gen_random_uuid();
begin
  assert consume_free_run(u, 1) is true, 'first run should be free';
  assert consume_free_run(u, 1) is null, 'second run must be paywalled';
  perform refund_free_run(u);
  assert consume_free_run(u, 1) is true, 'refunded run should be usable again';
  perform refund_free_run(u); perform refund_free_run(u);
  assert (select free_used from usage where actor = u) = 0, 'refund never goes below zero';

  insert into incidents (title, target_server, metric, action) values ('t', 'box', 'm', 'restart');
  begin
    insert into incidents (title, target_server, metric, action) values ('t', 'box', 'm', 'restart');
    assert false, 'second open incident on same server must be rejected';
  exception when unique_violation then null;
  end;
  raise notice 'meter.sql: all assertions passed';
end $$;
rollback;
