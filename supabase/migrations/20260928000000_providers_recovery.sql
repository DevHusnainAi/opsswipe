-- Which cloud the target lives on (shown on the card), and when the health check
-- confirmed the service was back after a fix (recovery proof / time to recover).
alter table incidents add column provider text;
alter table incidents add column recovered_at timestamptz;
alter table incidents alter column action drop default;
