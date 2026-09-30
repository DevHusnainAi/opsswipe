// node --test src/   (Node runs TypeScript natively; no test framework needed)
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atRisk, formatDuration, money, incidentReport, lostLine, paramsOf, recoveryLine, timeAgo, weekStats } from './format.ts';

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(41_400), '41s');
  assert.equal(formatDuration(192_000), '3m 12s');
  assert.equal(formatDuration(-5), '0s');
  assert.equal(formatDuration(3_905_000), '1h 5m', 'rolls into hours, not "65m 5s"');
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
  const healed = { created_at, resolved_at: '2026-09-27T10:01:30Z', recovered_at: '2026-09-27T10:01:30Z' };
  assert.equal(recoveryLine({ ...healed, context: { self_healed: true } }), 'down 1m 30s · recovered on its own');
});

test('timeAgo', () => {
  const now = Date.parse('2026-09-27T10:00:00Z');
  assert.equal(timeAgo('2026-09-27T09:59:58Z', now), 'just now');
  assert.equal(timeAgo('2026-09-27T09:59:18Z', now), '42s ago');
  assert.equal(timeAgo('2026-09-27T09:57:00Z', now), '3m ago');
  assert.equal(timeAgo('2026-09-27T08:00:00Z', now), '2h ago');
  assert.equal(timeAgo('2026-09-27T10:00:09Z', now), 'just now', 'clock skew never shows negative time');
});

test('paramsOf reads OAuth redirects: query, fragment, and values with =', () => {
  assert.deepEqual(paramsOf('opsswipe://connect?code=4%2F0Ab&installation_id=7'), { code: '4/0Ab', installation_id: '7' });
  assert.deepEqual(paramsOf('opsswipe://auth#access_token=a.b=&refresh_token=r&token_type=bearer'), {
    access_token: 'a.b=',
    refresh_token: 'r',
    token_type: 'bearer',
  });
  assert.deepEqual(paramsOf('opsswipe://auth?error=access_denied&error_description=Identity+is+already+linked'), {
    error: 'access_denied',
    error_description: 'Identity is already linked',
  });
  assert.deepEqual(paramsOf('opsswipe://connect'), {});
});

const outage = {
  id: 'i1',
  target_server: 'api',
  metric: 'POST /checkout → 500 (reported by the app)',
  created_at: '2026-09-28T10:00:00Z',
  resolved_at: '2026-09-28T10:01:10Z',
  recovered_at: '2026-09-28T10:02:00Z',
  context: { proof: { ok: true, passed: 3, total: 3 }, pr: { url: 'https://github.com/me/app/pull/7' } },
};

test('incidentReport tells what broke, what ran, how long, and the proof', () => {
  assert.equal(
    incidentReport(outage, 'Revert PR'),
    [
      'api: incident report',
      '',
      'Detected 2026-09-28 10:00 UTC: POST /checkout → 500 (reported by the app)',
      'Revert PR, approved with biometrics, at 2026-09-28 10:01 UTC',
      'Back up at 2026-09-28 10:02 UTC (down 2m 0s)',
      'Code fix proven in CI: 3/3 failing production requests now pass (https://github.com/me/app/pull/7)',
      '',
      'Sent from OpsSwipe',
    ].join('\n'),
  );
  const healed = incidentReport({ ...outage, context: { self_healed: true } }, null);
  assert.match(healed, /Recovered on its own/);
  assert.doesNotMatch(healed, /approved/);
});

test('weekStats counts this week only, takes the median time back up, and counts proven fixes', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const s = weekStats(
    [
      outage, // down 2m, proven
      { ...outage, id: 'i2', recovered_at: '2026-09-28T10:04:00Z', context: null }, // down 4m
      { ...outage, id: 'i3', created_at: '2026-09-01T10:00:00Z', recovered_at: '2026-09-01T11:00:00Z' }, // last month
    ],
    now,
  );
  assert.deepEqual(s, { incidents: 2, median: 180_000, proven: 1 });
  assert.deepEqual(weekStats([], now), { incidents: 0, median: null, proven: 0 });
});

test('revenue at risk reads per hour on the card and as money lost once back up', () => {
  const i = {
    created_at: '2026-09-29T03:00:00Z',
    resolved_at: '2026-09-29T03:00:40Z',
    recovered_at: '2026-09-29T03:01:12Z',
    context: { revenue: { perHour: 4.2, currency: 'USD' } },
  };
  assert.equal(atRisk(i), '~$4.20/h at risk');
  assert.equal(lostLine(i), 'about $0.08 lost (estimate)');
  assert.equal(atRisk({ ...i, context: null }), null, 'no RevenueCat connected: nothing shown');
  assert.equal(lostLine({ ...i, recovered_at: null }), null);
});

test('money: cents under $10, whole dollars above', () => {
  assert.equal(money(4.2), '$4.20');
  assert.equal(money(12.5), '$13');
  assert.equal(money(1234), '$1,234');
});
