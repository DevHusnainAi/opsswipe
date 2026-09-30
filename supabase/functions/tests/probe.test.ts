import { assertEquals } from 'jsr:@std/assert@1';
import { confirmedProbe } from '../_shared/probe.ts';

// Answers each probe with the next status in the list.
function statuses(...codes: number[]) {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => Promise.resolve(new Response('x', { status: codes[calls++] }))) as typeof fetch;
  return { calls: () => calls, restore: () => (globalThis.fetch = real) };
}

Deno.test('one failed probe is a blip: the retry decides, so a 3am network hiccup pages nobody', async () => {
  const f = statuses(503, 200);
  try {
    assertEquals((await confirmedProbe('http://34.1.2.3/', 0)).status, '200');
    assertEquals(f.calls(), 2);
  } finally {
    f.restore();
  }
});

Deno.test('a failure confirmed twice is an outage; a healthy first probe is not retried', async () => {
  let f = statuses(503, 502);
  try {
    assertEquals((await confirmedProbe('http://34.1.2.3/', 0)).status, '502');
  } finally {
    f.restore();
  }
  f = statuses(200);
  try {
    assertEquals((await confirmedProbe('http://34.1.2.3/', 0)).status, '200');
    assertEquals(f.calls(), 1);
  } finally {
    f.restore();
  }
});
