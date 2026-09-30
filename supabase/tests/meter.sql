-- Free-outage meter. Run against a migrated DB:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/meter.sql
begin;
do $$
declare
  u uuid := gen_random_uuid();
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
begin
  assert consume_free_run(u, 1, a) is true, 'the first outage is free';
  assert consume_free_run(u, 1, a) is true, 'every fix of that outage is free (revert, then the proven merge)';
  assert (select free_used from usage where actor = u) = 1, 'one outage used, however many fixes';
  assert consume_free_run(u, 1, b) is null, 'a second outage hits the paywall';

  perform refund_free_run(u, a);
  assert consume_free_run(u, 1, b) is true, 'a refunded outage frees the meter for the next one';
  perform refund_free_run(u, a); -- not the claimed incident: no effect
  assert (select free_used from usage where actor = u) = 1, 'only the claimed outage can be refunded';

  -- one-open-incident-per-service is covered in tenancy.sql
  raise notice 'meter.sql: all assertions passed';
end $$;
rollback;

-- RevenueCat webhooks arrive out of order: an older event never overwrites a newer plan.
begin;
do $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (u);
  perform store_entitlement(u, '2026-11-01', '2026-09-29 10:00');
  perform store_entitlement(u, '2026-10-01', '2026-09-29 09:00'); -- older event, delivered late
  assert (select pro_until from entitlements where owner = u) = '2026-11-01', 'older event ignored';
  perform store_entitlement(u, '2026-09-29 11:00', '2026-09-29 11:00'); -- a newer EXPIRATION
  assert (select pro_until from entitlements where owner = u) = '2026-09-29 11:00', 'newer event applies';
  raise notice 'entitlement ordering: all assertions passed';
end $$;
rollback;
