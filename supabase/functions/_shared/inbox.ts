// The alert inbox: alerts from the tools a team already runs (Prometheus Alertmanager, Grafana, or plain JSON
// from anything else) arrive at one private URL. An alert about a service OpsSwipe watches joins that service's
// single card (50 alerts, one page); everything else is kept quiet and counted in the weekly report.
export type InboxAlert = { name: string; summary: string; target: string; firing: boolean };

const str = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 200) : '');

// Alertmanager and Grafana send {alerts: [{status, labels, annotations}]}; anything else may send
// {service, title, summary, status} (or a list of them).
export function parseAlerts(body: unknown): InboxAlert[] {
  const b = (body ?? {}) as Record<string, unknown>;
  const list = Array.isArray(b.alerts) ? b.alerts : Array.isArray(body) ? body : [body];
  return (list as Record<string, unknown>[]).slice(0, 100).flatMap((a) => {
    if (!a || typeof a !== 'object') return [];
    const labels = (a.labels ?? {}) as Record<string, unknown>;
    const notes = (a.annotations ?? {}) as Record<string, unknown>;
    const name = str(labels.alertname) || str(a.title) || str(a.name) || 'Alert';
    const target = str(labels.service) || str(labels.job) || str(labels.instance) || str(a.service) || str(a.host);
    const summary = str(notes.summary) || str(notes.description) || str(a.summary) || str(a.message) || name;
    const status = (str(a.status) || str(b.status) || 'firing').toLowerCase();
    return [{ name, summary, target, firing: !['resolved', 'ok', 'up'].includes(status) }];
  });
}

// Which watched service an alert is about: its name, or the host in its URL (instance labels are host:port).
export function matchService<S extends { name: string; config: { url?: string } }>(target: string, services: S[]) {
  const t = target.toLowerCase().replace(/:\d+$/, '');
  if (!t) return null;
  return services.find((s) => {
    const host = (() => {
      try {
        return new URL(s.config.url ?? '').hostname.toLowerCase();
      } catch {
        return '';
      }
    })();
    return s.name.toLowerCase() === t || (host !== '' && host === t);
  }) ?? null;
}
