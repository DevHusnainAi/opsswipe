-- A false alarm can be dismissed from the card: resolved with no fix run, and logged like every fix.
alter table audit_log drop constraint audit_log_outcome_check;
alter table audit_log add constraint audit_log_outcome_check
  check (outcome in ('executed', 'paywalled', 'failed', 'dismissed'));
