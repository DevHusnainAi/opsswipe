import { assertEquals } from 'jsr:@std/assert@1';
import { weeklySummary } from '../_shared/weekly.ts';

const now = Date.parse('2026-10-05T09:00:00Z');

Deno.test('a quiet week still says what OpsSwipe did', () => {
  assertEquals(weeklySummary(2, [], [], now).title, 'Quiet week: 100% up');
});

Deno.test('outages add up to downtime, cost, and what was fixed and proven', () => {
  const r = weeklySummary(
    1,
    [
      {
        created_at: '2026-10-01T10:00:00Z',
        recovered_at: '2026-10-01T10:20:00Z',
        resolved_at: null,
        context: { revenue: { perHour: 60, currency: 'USD' }, proof: { ok: true }, prepared: true },
      },
      { created_at: '2026-10-02T10:00:00Z', recovered_at: '2026-10-02T10:10:00Z', resolved_at: null, context: {} },
    ],
    [{ action: 'merge_pr', outcome: 'executed' }, { action: 'reset', outcome: 'executed' }],
    now,
  );
  assertEquals(r.title, 'This week: 2 outages, back up in 15 min on average');
  assertEquals(
    r.body,
    '99.70% uptime across 1 service, 30 min down in total (~$20 of revenue at risk). 2 fixes approved from your phone, 1 proven in CI before merging, 1 written by AI before you looked.',
  );
});
