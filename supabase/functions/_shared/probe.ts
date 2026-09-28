// The health check's probe. One failed request is not an outage: a network blip at 3am must not
// page anyone, so a failure is confirmed by a second probe before an incident opens.
export type Probe = { status: string; ms: number }; // "200", "503", or an error name like "TimeoutError"

export async function probe(url: string): Promise<Probe> {
  const t0 = Date.now();
  const status = await fetch(url, { signal: AbortSignal.timeout(4000) }).then(
    async (r) => (await r.body?.cancel(), String(r.status)),
    (e) => e.name,
  );
  return { status, ms: Date.now() - t0 };
}

export const isUp = (p: Probe) => p.status.startsWith('2');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ponytail: one retry after 10s; multi-region checks would cut false alarms further.
export async function confirmedProbe(url: string, wait = 10_000): Promise<Probe> {
  const first = await probe(url);
  if (isUp(first)) return first;
  await sleep(wait);
  return await probe(url);
}
