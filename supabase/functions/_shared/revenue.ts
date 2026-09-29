// Revenue at risk: what an outage costs, from the user's own RevenueCat revenue. The last 28 days of
// revenue spread over the hours in them: a plain estimate, labelled as one everywhere it's shown.
// https://www.revenuecat.com/docs/api-v2/charts-and-metrics (needs Charts & Metrics read)
const API = 'https://api.revenuecat.com/v2';
export const WINDOW_DAYS = 28;

export class RevenueError extends Error {}

export type Revenue = { perHour: number; currency: string };

export const perHour = (value: number, days = WINDOW_DAYS) => (value > 0 ? value / (days * 24) : 0);
export const lostSoFar = (hourly: number, ms: number) => (hourly * Math.max(0, ms)) / 3_600_000;
export const money = (v: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: v < 10 ? 2 : 0,
    maximumFractionDigits: v < 10 ? 2 : 0,
  }).format(v);

export async function revenuePerHour(key: string, projectId: string, now = new Date()): Promise<Revenue> {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const start = day(new Date(now.getTime() - (WINDOW_DAYS - 1) * 86_400_000));
  const res = await fetch(
    `${API}/projects/${encodeURIComponent(projectId)}/metrics/revenue?start_date=${start}&end_date=${day(now)}`,
    { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(3000) },
  );
  if (res.status === 401 || res.status === 403) {
    throw new RevenueError('RevenueCat refused that key. Use a v2 secret key with Charts & Metrics read access.');
  }
  if (res.status === 404) throw new RevenueError('No RevenueCat project with that id.');
  if (!res.ok) throw new Error(`revenuecat metrics ${res.status}`);
  const r = await res.json();
  return { perHour: perHour(Number(r.value) || 0), currency: typeof r.currency === 'string' ? r.currency : 'USD' };
}

// The key's own project, so users don't have to find and paste its id. Needs the key to also have
// "Project configuration: Read"; null when it can't tell (the user then pastes the id).
// ponytail: RevenueCat OAuth (a consent screen, no key at all) needs OpsSwipe registered as a client first.
export async function keyProject(key: string): Promise<string | null> {
  const res = await fetch(`${API}/projects`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(3000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const items = ((await res.json()).items ?? []) as { id: string }[];
  return items.length === 1 ? items[0].id : null;
}
