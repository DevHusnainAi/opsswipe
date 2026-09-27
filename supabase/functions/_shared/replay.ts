// Failing production requests, kept as replayable samples. They travel into the revert PR as
// .opsswipe/replays/<sha>.json, so CI can prove the fix against exactly what broke in production.
export type ReplaySample = { method: string; path: string; status: number; body?: string; at: string };

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const SECRET_PARAM = /^(token|key|api_?key|secret|password|pass|auth|session|code|signature)$/i;
const MAX_BODY = 2048;
export const MAX_SAMPLES = 5;

// Keep only what's needed to replay the request, and drop anything that looks like a credential.
// Headers and cookies are never accepted in the first place.
export function scrubSample(raw: Record<string, unknown>, now = new Date()): ReplaySample | null {
  const method = String(raw.method ?? '').toUpperCase();
  const status = Number(raw.status);
  const rawPath = String(raw.path ?? '');
  if (!METHODS.has(method) || !Number.isInteger(status) || status < 500 || status > 599) return null;
  if (!rawPath.startsWith('/') || rawPath.startsWith('//') || rawPath.length > 512) return null;

  const url = new URL(rawPath, 'http://replay.local');
  for (const k of [...url.searchParams.keys()]) if (SECRET_PARAM.test(k)) url.searchParams.set(k, 'REDACTED');
  const body = typeof raw.body === 'string' && raw.body ? raw.body.slice(0, MAX_BODY) : undefined;
  return { method, path: url.pathname + url.search, status, ...(body ? { body } : {}), at: now.toISOString() };
}

// Newest sample per method+path wins; at most MAX_SAMPLES kept, newest first.
export function mergeSamples(existing: ReplaySample[], incoming: ReplaySample[]): ReplaySample[] {
  const seen = new Set<string>();
  return [...incoming, ...existing]
    .filter((s) => {
      const k = `${s.method} ${s.path}`;
      return seen.has(k) ? false : (seen.add(k), true);
    })
    .slice(0, MAX_SAMPLES);
}
