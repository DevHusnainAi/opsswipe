import { assertEquals } from 'jsr:@std/assert@1';
import { matchService, parseAlerts } from '../_shared/inbox.ts';

Deno.test('Alertmanager and Grafana alerts become one line each', () => {
  const r = parseAlerts({
    status: 'firing',
    alerts: [
      {
        status: 'firing',
        labels: { alertname: 'HighErrorRate', job: 'checkout-api', instance: '10.0.0.4:9100' },
        annotations: { summary: '5xx above 5% for 5 minutes' },
      },
      { status: 'resolved', labels: { alertname: 'DiskFull', instance: 'db-1:9100' }, annotations: {} },
    ],
  });
  assertEquals(r, [
    { name: 'HighErrorRate', summary: '5xx above 5% for 5 minutes', target: 'checkout-api', firing: true },
    { name: 'DiskFull', summary: 'DiskFull', target: 'db-1:9100', firing: false },
  ]);
});

Deno.test('plain JSON from any tool works too', () => {
  assertEquals(parseAlerts({ service: 'web', title: 'Site down', message: 'HTTP 502' }), [
    { name: 'Site down', summary: 'HTTP 502', target: 'web', firing: true },
  ]);
  assertEquals(parseAlerts('nonsense'), []);
});

Deno.test('an alert finds its service by name or by host', () => {
  const services = [
    { name: 'checkout-api', config: { url: 'https://api.example.com/health' } },
    { name: 'opsswipe-demo', config: { url: 'http://34.135.145.87/' } },
  ];
  assertEquals(matchService('Checkout-API', services)?.name, 'checkout-api');
  assertEquals(matchService('34.135.145.87:9100', services)?.name, 'opsswipe-demo');
  assertEquals(matchService('unrelated-db', services), null);
  assertEquals(matchService('', services), null);
});
