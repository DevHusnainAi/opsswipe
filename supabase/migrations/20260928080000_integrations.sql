-- Integrations: Railway as a host, Discord/Slack as an alert channel, Sentry as an incident source.
alter table services drop constraint services_provider_check;
alter table services add constraint services_provider_check check (provider in ('gcp', 'render', 'railway'));

-- 'railway' holds the Railway API token, 'alerts' the Discord or Slack webhook URL (both in Vault).
alter table connections drop constraint connections_kind_check;
alter table connections add constraint connections_kind_check
  check (kind in ('github', 'render', 'google', 'railway', 'alerts'));

-- Vault id of the Client Secret of the user's Sentry Internal Integration, which signs its webhooks.
alter table services add column sentry_secret_id uuid;
