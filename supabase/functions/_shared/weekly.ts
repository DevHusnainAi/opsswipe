// The weekly report: what OpsSwipe did for you when nothing is on fire. Posted to your phone and
// your Slack/Discord channel every Monday (pg_cron -> weekly/).
import type { Push } from './push.ts';
import { money } from './revenue.ts';

export type WeekIncident = {
  created_at: string;
  recovered_at: string | null;
  resolved_at: string | null;
  context: { revenue?: { perHour: number; currency: string }; prepared?: boolean; proof?: { ok: boolean } };
};
export type WeekAudit = { action: string; outcome: string };

const WEEK = 7 * 86_400_000;
const dur = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export function weeklySummary(
  services: number,
  incidents: WeekIncident[],
  audits: WeekAudit[],
  now = Date.now(),
): Push {
  const scope = `${services} service${services === 1 ? '' : 's'}`;
  if (!incidents.length) {
    return {
      title: 'Quiet week: 100% up',
      body: `No outages across ${scope}. OpsSwipe checked every minute so you didn't have to.`,
    };
  }
  const downs = incidents.map((i) =>
    Math.max(0, (Date.parse(i.recovered_at ?? i.resolved_at ?? '') || now) - Date.parse(i.created_at))
  );
  const total = downs.reduce((a, b) => a + b, 0);
  const cost = incidents.reduce((sum, i, n) => sum + (i.context.revenue?.perHour ?? 0) * downs[n] / 3_600_000, 0);
  const currency = incidents.find((i) => i.context.revenue)?.context.revenue?.currency ?? 'USD';
  const fixes = audits.filter((a) => a.outcome === 'executed' && a.action !== 'approve').length;
  const proven = incidents.filter((i) => i.context.proof?.ok).length;
  const prepared = incidents.filter((i) => i.context.prepared).length;
  const uptime = Math.max(0, 100 - (total / (WEEK * services)) * 100);
  const n = incidents.length;
  return {
    title: `This week: ${n} outage${n === 1 ? '' : 's'}, back up in ${dur(total / n)} on average`,
    body: [
      `${uptime.toFixed(2)}% uptime across ${scope}, ${dur(total)} down in total`,
      cost >= 0.01 ? ` (~${money(cost, currency)} of revenue at risk)` : '',
      `. ${fixes} fix${fixes === 1 ? '' : 'es'} approved from your phone`,
      proven ? `, ${proven} proven in CI before merging` : '',
      prepared ? `, ${prepared} written by AI before you looked` : '',
      '.',
    ].join(''),
  };
}
