// Sentry issue alerts as an incident source: the user's Sentry project already sees the failing
// request, so no code change is needed in their app. The alert's Internal Integration signs each
// webhook with its Client Secret (HMAC-SHA256 hex in Sentry-Hook-Signature).
// https://docs.sentry.io/organization/integrations/integration-platform/webhooks/issue-alerts/
import { type ReplaySample, scrubSample } from './replay.ts';

type SentryEvent = {
  title?: string;
  culprit?: string;
  release?: string | null;
  request?: { method?: string | null; url?: string | null } | null;
};

// Only the request line is kept: Sentry events carry no response status, so a triggered alert counts
// as a 500. Headers, cookies and bodies from the event are never read.
export function fromSentry(payload: unknown): { sample: ReplaySample | null; metric: string; release?: string } | null {
  const event = (payload as { data?: { event?: SentryEvent } })?.data?.event;
  if (!event?.title) return null;
  let path = '';
  try {
    const u = new URL(event.request?.url ?? '');
    path = u.pathname + u.search;
  } catch {
    // an event without a request (a background job): no replay sample, still an incident
  }
  const method = (event.request?.method || 'GET').toUpperCase();
  const sample = path ? scrubSample({ method, path, status: 500 }) : null;
  const release = typeof event.release === 'string' && /^[0-9a-f]{40}$/.test(event.release) ? event.release : undefined;
  const metric = `${event.title.slice(0, 120)}${path ? ` · ${method} ${path.slice(0, 80)}` : ''} (Sentry)`;
  return { sample, metric, release };
}
