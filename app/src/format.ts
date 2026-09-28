export function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
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
