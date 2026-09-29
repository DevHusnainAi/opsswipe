// The health check's probe. One failed request is not an outage: a network blip at 3am must not
// page anyone, so a failure is confirmed by a second probe before an incident opens.
import { resolvesPublic } from './netguard.ts';

export type Probe = { status: string; ms: number }; // "200", "503", or an error name like "TimeoutError"

export async function probe(url: string): Promise<Probe> {
  const t0 = Date.now();
  // Never probe inside a network (netguard.ts), and don't follow redirects there either: a redirect
  // is an answer (3xx), not something to chase.
  if (!(await resolvesPublic(url))) return { status: 'BlockedAddress', ms: 0 };
  const status = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: 'manual' }).then(
    async (r) => (await r.body?.cancel(), String(r.status)),
    (e) => e.name,
  );
  return { status, ms: Date.now() - t0 };
}

// A 2xx or a redirect: the server is answering.
export const isUp = (p: Probe) => /^[23]\d\d$/.test(p.status);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ponytail: one retry after 10s; multi-region checks would cut false alarms further.
export async function confirmedProbe(url: string, wait = 10_000): Promise<Probe> {
  const first = await probe(url);
  if (isUp(first)) return first;
  await sleep(wait);
  return await probe(url);
}
