export function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}

type Timeline = {
  created_at: string;
  resolved_at: string | null;
  recovered_at: string | null;
  context?: { self_healed?: boolean } | null;
};

// Recovery proof shown under a fixed incident, e.g. "down 3m 12s · back 41s after fix".
export function recoveryLine(i: Timeline) {
  if (!i.resolved_at) return '';
  if (i.context?.self_healed && i.recovered_at) {
    return `down ${formatDuration(Date.parse(i.recovered_at) - Date.parse(i.created_at))} · recovered on its own`;
  }
  if (!i.recovered_at) return 'fix sent · waiting for health check';
  const back = Date.parse(i.recovered_at);
  return `down ${formatDuration(back - Date.parse(i.created_at))} · back ${formatDuration(back - Date.parse(i.resolved_at))} after fix`;
}

// "just now", "42s ago", "3m ago", "2h ago" for incident and audit timestamps.
export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// "opsswipe://auth?a=1#b=2" -> { a: '1', b: '2' }. RN's URL has no searchParams, and OAuth
// redirects put tokens after '#', with values that may themselves contain '='.
export function paramsOf(url: string): Record<string, string> {
  const query = url.split(/[?#]/).slice(1).join('&');
  return Object.fromEntries(
    query.split('&').filter(Boolean).map((kv) => {
      const i = kv.includes('=') ? kv.indexOf('=') : kv.length;
      const dec = (s: string) => decodeURIComponent(s.replace(/\+/g, ' '));
      return [dec(kv.slice(0, i)), dec(kv.slice(i + 1))];
    }),
  );
}

type Recovered = Timeline & {
  id: string;
  target_server: string;
  metric: string;
  context?: { self_healed?: boolean; proof?: { ok: boolean; passed: number; total: number }; pr?: { url: string } } | null;
};

// A plain-text incident report to paste to customers, a status page or a team chat: what broke, what
// ran, how long it took, and whether the code fix was proven. Only facts OpsSwipe recorded.
export function incidentReport(i: Recovered, fix: string | null) {
  const at = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;
  const lines = [`${i.target_server}: incident report`, '', `Detected ${at(i.created_at)}: ${i.metric}`];
  if (i.context?.self_healed) lines.push('Recovered on its own; no fix was needed.');
  else if (fix && i.resolved_at) lines.push(`${fix}, approved with biometrics, at ${at(i.resolved_at)}`);
  if (i.recovered_at) lines.push(`Back up at ${at(i.recovered_at)} (down ${formatDuration(Date.parse(i.recovered_at) - Date.parse(i.created_at))})`);
  const p = i.context?.proof;
  if (p?.ok) lines.push(`Code fix proven in CI: ${p.passed}/${p.total} failing production requests now pass${i.context?.pr ? ` (${i.context.pr.url})` : ''}`);
  return [...lines, '', 'Sent from OpsSwipe'].join('\n');
}

// The week at a glance: incidents, median time back up, and code fixes proven in CI.
export function weekStats(fixed: Recovered[], now = Date.now()) {
  const week = fixed.filter((i) => now - Date.parse(i.created_at) < 7 * 86_400_000);
  const downs = week.filter((i) => i.recovered_at).map((i) => Date.parse(i.recovered_at!) - Date.parse(i.created_at))
    .sort((a, b) => a - b);
  const median = downs.length
    ? (downs.length % 2 ? downs[(downs.length - 1) / 2] : (downs[downs.length / 2 - 1] + downs[downs.length / 2]) / 2)
    : null;
  return { incidents: week.length, median, proven: week.filter((i) => i.context?.proof?.ok).length };
}

// Revenue at risk, as the server estimates it (the owner's RevenueCat revenue, last 28 days, per hour).
export const money = (v: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: v < 10 ? 2 : 0, maximumFractionDigits: v < 10 ? 2 : 0 }).format(v);

type WithRevenue = Timeline & { context?: { revenue?: { perHour: number; currency: string } } | null };

export const atRisk = (i: WithRevenue) =>
  i.context?.revenue?.perHour ? `~${money(i.context.revenue.perHour, i.context.revenue.currency)}/h at risk` : null;

// "about $0.08 lost" once it's back: the hourly estimate times how long it was down.
export function lostLine(i: WithRevenue) {
  const r = i.context?.revenue;
  if (!r?.perHour || !i.recovered_at) return null;
  const lost = (r.perHour * (Date.parse(i.recovered_at) - Date.parse(i.created_at))) / 3_600_000;
  return `about ${money(lost, r.currency)} lost (estimate)`;
}

// The line shared with a report link: short enough for a post on X.
export function shareLine(i: Recovered) {
  const down = i.recovered_at ? ` was down ${formatDuration(Date.parse(i.recovered_at) - Date.parse(i.created_at))} and` : '';
  const proven = i.context?.proof?.ok ? ', with the fix proven in CI against the requests that failed' : '';
  return `${i.target_server}${down} is back up${proven}. Full report:`;
}
