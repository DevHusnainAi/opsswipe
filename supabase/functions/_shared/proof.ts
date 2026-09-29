// A CI proof only counts for the exact commit OpsSwipe opened, and only if everything passed.
export type PrRef = { repo: string; number: number; headSha: string; url: string; branch: string; kind?: string };
export type ProofResult = { method: string; path: string; now: number }; // "now": the status this PR's build gave
export type ProofPayload = {
  repo: string;
  pr: number;
  headSha: string;
  results: ProofResult[];
  tests: { passed: boolean };
  runUrl?: string;
};
export type Proof = {
  ok: boolean;
  passed: number;
  total: number;
  results: { method: string; path: string; was: number; now: number }[];
  tests: boolean;
  headSha: string;
  runUrl?: string;
  at: string;
};

// The body CI sends. Which repo and PR it's for comes from the verified OIDC token, not the body.
export type ProofBody = Omit<ProofPayload, 'repo' | 'pr'>;

const status = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 599;

export function parseProof(raw: unknown): ProofBody | null {
  const p = raw as ProofBody;
  if (!p || !/^[0-9a-f]{40}$/.test(String(p.headSha))) return null;
  if (!Array.isArray(p.results) || p.results.length > 200) return null;
  const okResult = (r: ProofResult) =>
    r && /^[A-Z]{3,7}$/.test(String(r.method)) && typeof r.path === 'string' && r.path.startsWith('/') &&
    r.path.length <= 2048 && status(r.now);
  if (!p.results.every(okResult)) return null;
  if (typeof p.tests?.passed !== 'boolean') return null;
  if (p.runUrl !== undefined && !/^https:\/\/github\.com\//.test(String(p.runUrl))) return null;
  return p;
}

// A request counts as fixed only when it failed in production (5xx) and this build answers 2xx. A 4xx or
// a redirect is a changed error, not a fix, and "passed" is decided here against the requests OpsSwipe
// saved: CI reports what each one returned now, so it can't leave a failing request out or grade itself.
export const fixed = (was: number, now: number) => was >= 500 && now >= 200 && now < 300;

export function evaluateProof(
  pr: PrRef | undefined,
  p: ProofPayload,
  expected: { method: string; path: string; status: number }[],
  at = new Date(),
):
  | { status: 'accepted'; proof: Proof }
  | { status: 'stale' | 'unknown' } {
  if (!pr || pr.repo !== p.repo || pr.number !== p.pr) return { status: 'unknown' };
  if (pr.headSha !== p.headSha) return { status: 'stale' }; // someone pushed after we opened it
  const results = expected.map((e) => ({
    method: e.method,
    path: e.path,
    was: e.status,
    now: p.results.find((r) => r.method === e.method && r.path === e.path)?.now ?? 0, // missing = not replayed
  }));
  const passed = results.filter((r) => fixed(r.was, r.now)).length;
  const ok = p.tests.passed && results.length > 0 && passed === results.length;
  return {
    status: 'accepted',
    proof: {
      ok,
      passed,
      total: results.length,
      results,
      tests: p.tests.passed,
      headSha: p.headSha,
      runUrl: p.runUrl,
      at: at.toISOString(),
    },
  };
}

// merge_pr is only ever runnable for a passing proof of the commit we opened.
export const canMerge = (pr: PrRef | undefined, proof: Proof | undefined) =>
  !!pr && !!proof?.ok && proof.headSha === pr.headSha;
