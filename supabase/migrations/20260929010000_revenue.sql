-- Revenue at risk: the user's own RevenueCat v2 secret key (Vault) and project id (account), read-only
-- use of Charts & Metrics to estimate what an outage costs per hour.
alter table connections drop constraint connections_kind_check;
alter table connections add constraint connections_kind_check
  check (kind in ('github', 'render', 'google', 'railway', 'alerts', 'revenuecat'));
