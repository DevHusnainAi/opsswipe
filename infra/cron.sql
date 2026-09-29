-- Run once in the Supabase SQL editor after deploying the healthcheck function.
-- Secrets live in Vault, not in the job definition.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<CRON_SECRET>', 'cron_secret');

-- Liveness only: app failures arrive instantly via /report, so once a minute is enough.
select cron.schedule('opsswipe-healthcheck', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/healthcheck',
    headers := jsonb_build_object(
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 8000
  );
$$);

-- The weekly report (uptime, time to fix, revenue at risk, fixes proven): Mondays 09:00 PKT.
select cron.schedule('opsswipe-weekly', '0 4 * * 1', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/weekly',
    headers := jsonb_build_object(
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 30000
  );
$$);
