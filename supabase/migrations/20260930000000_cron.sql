-- The health check (every minute) and the weekly report run from pg_cron. They were set up by hand from
-- infra/cron.sql, so when the extension disappeared nothing brought it back and "back up" stopped arriving.
-- Now a migration owns them: `db push` restores both. cron.schedule replaces a job of the same name, so
-- this is safe to run again. The URL and secret come from Vault (project_url, cron_secret), not from here.
-- Plain Postgres without pg_cron (CI) skips it.
do $outer$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron not available here: schedules skipped';
    return;
  end if;
  create extension if not exists pg_cron;
  create extension if not exists pg_net;

  perform cron.schedule('opsswipe-healthcheck', '* * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/healthcheck',
      headers := jsonb_build_object(
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 8000
    );
  $job$);

  -- Mondays 09:00 PKT.
  perform cron.schedule('opsswipe-weekly', '0 4 * * 1', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/weekly',
      headers := jsonb_build_object(
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 30000
    );
  $job$);
end
$outer$;
