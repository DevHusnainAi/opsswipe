// node --test src/   (Node runs TypeScript natively; no test framework needed)
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDuration, recoveryLine, timeAgo } from './format.ts';

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(41_400), '41s');
  assert.equal(formatDuration(192_000), '3m 12s');
  assert.equal(formatDuration(-5), '0s');
});

test('recoveryLine walks the incident timeline', () => {
  const created_at = '2026-09-27T10:00:00Z';
  assert.equal(recoveryLine({ created_at, resolved_at: null, recovered_at: null }), '');
  assert.equal(
    recoveryLine({ created_at, resolved_at: '2026-09-27T10:02:31Z', recovered_at: null }),
    'fix sent · waiting for health check',
  );
  assert.equal(
    recoveryLine({ created_at, resolved_at: '2026-09-27T10:02:31Z', recovered_at: '2026-09-27T10:03:12Z' }),
    'down 3m 12s · back 41s after fix',
  );
});

test('timeAgo', () => {
  const now = Date.parse('2026-09-27T10:00:00Z');
  assert.equal(timeAgo('2026-09-27T09:59:58Z', now), 'just now');
  assert.equal(timeAgo('2026-09-27T09:59:18Z', now), '42s ago');
  assert.equal(timeAgo('2026-09-27T09:57:00Z', now), '3m ago');
  assert.equal(timeAgo('2026-09-27T08:00:00Z', now), '2h ago');
  assert.equal(timeAgo('2026-09-27T10:00:09Z', now), 'just now', 'clock skew never shows negative time');
});
