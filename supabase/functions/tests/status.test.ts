import { assertEquals } from 'jsr:@std/assert@1';
import { DAYS, statusReport } from '../_shared/status.ts';

const now = Date.parse('2026-09-29T12:00:00Z');
const api = { id: 's1', name: 'api' }, web = { id: 's2', name: 'web' };

Deno.test('downtime lands on the right days and an open incident means down now', () => {
  const r = statusReport([api, web], [
    // 30 min yesterday, recovered
    {
      service_id: 's1',
      title: 'Requests are failing',
      created_at: '2026-09-28T10:00:00Z',
      recovered_at: '2026-09-28T10:30:00Z',
      resolved_at: '2026-09-28T10:31:00Z',
      status: 'resolved',
    },
    // still down since 11:50 today
    {
      service_id: 's2',
      title: 'HTTP health check failing',
      created_at: '2026-09-29T11:50:00Z',
      recovered_at: null,
      resolved_at: null,
      status: 'active',
    },
  ], now);
  const [a, w] = r.services;
  assertEquals(a.days.length, DAYS);
  assertEquals(a.days.at(-2), 30);
  assertEquals(a.days.at(-1), 0);
  assertEquals(a.up, true);
  assertEquals(w.up, false);
  assertEquals(w.days.at(-1), 10);
  assertEquals(r.incidents.map((i) => [i.service, i.minutes, i.ongoing]), [['web', 10, true], ['api', 30, false]]);
  assertEquals(a.uptime < 100 && a.uptime > 99.9, true);
});

Deno.test('nothing leaves the server but names, times and titles', () => {
  const r = statusReport([api], [], now);
  assertEquals(Object.keys(r.services[0]).sort(), ['days', 'name', 'up', 'uptime']);
  assertEquals(r.services[0].uptime, 100);
});
