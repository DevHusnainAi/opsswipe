// The public status page's numbers: per service, up or down now and 90 days of daily downtime; plus
// recent incidents. Only names, times and titles leave the server: no paths, errors or configs.
export type StatusService = { id: string; name: string };
export type StatusIncident = {
  service_id: string;
  title: string;
  created_at: string;
  recovered_at: string | null;
  resolved_at: string | null;
  status: string;
};

const DAY = 86_400_000;
export const DAYS = 90;

// When an outage ended: back up (health check), else resolved, else it's still going.
const endOf = (i: StatusIncident, now: number) =>
  Date.parse(i.recovered_at ?? i.resolved_at ?? '') || (i.status === 'resolved' ? Date.parse(i.created_at) : now);

export function statusReport(services: StatusService[], incidents: StatusIncident[], now = Date.now()) {
  const today = Math.floor(now / DAY) * DAY;
  const from = today - (DAYS - 1) * DAY;
  return {
    updated: new Date(now).toISOString(),
    services: services.map((s) => {
      const mine = incidents.filter((i) => i.service_id === s.id);
      const down = new Array<number>(DAYS).fill(0); // minutes per day, oldest first
      for (const i of mine) {
        const start = Date.parse(i.created_at), end = endOf(i, now);
        for (let d = 0; d < DAYS; d++) {
          const d0 = from + d * DAY, d1 = d0 + DAY;
          const overlap = Math.min(end, d1) - Math.max(start, d0);
          if (overlap > 0) down[d] += overlap / 60_000;
        }
      }
      const minutes = down.reduce((a, b) => a + b, 0);
      const span = (now - from) / 60_000;
      return {
        name: s.name,
        up: !mine.some((i) => i.status !== 'resolved' && !i.recovered_at),
        uptime: Math.max(0, Math.round((1 - minutes / span) * 10_000) / 100), // percent, 2 decimals
        days: down.map((m) => Math.round(m)),
      };
    }),
    incidents: incidents
      .filter((i) => Date.parse(i.created_at) >= from)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 20)
      .map((i) => ({
        service: services.find((s) => s.id === i.service_id)?.name ?? '',
        title: i.title,
        started: i.created_at,
        minutes: Math.round((endOf(i, now) - Date.parse(i.created_at)) / 60_000),
        ongoing: i.status !== 'resolved' && !i.recovered_at,
      })),
  };
}
