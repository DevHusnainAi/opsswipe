-- Root fixes from the Sep 29 audit. Each block names its finding.

-- P0-2: when a fix was claimed, so the health check can hand back a claim whose function died.
alter table incidents add column claimed_at timestamptz;
