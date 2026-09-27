-- Free-fix meter. Run against a migrated DB:
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

  -- one-open-incident-per-service is covered in tenancy.sql
  raise notice 'meter.sql: all assertions passed';
end $$;
rollback;
