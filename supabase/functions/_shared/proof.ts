// A CI proof only counts for the exact commit OpsSwipe opened, and only if everything passed.
export type PrRef = { repo: string; number: number; headSha: string; url: string; branch: string };
export type ProofPayload = {
  repo: string;
  pr: number;
  headSha: string;
  replay: { passed: number; total: number };
  tests: { passed: boolean };
  runUrl?: string;
};
export type Proof = ProofPayload['replay'] & {
  ok: boolean;
  tests: boolean;
  headSha: string;
  runUrl?: string;
  at: string;
};

export function parseProof(raw: unknown): ProofPayload | null {
  const p = raw as ProofPayload;
  const nat = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
  if (!p || typeof p.repo !== 'string' || !Number.isInteger(p.pr) || !/^[0-9a-f]{40}$/.test(String(p.headSha))) {
    return null;
  }
  if (!nat(p.replay?.passed) || !nat(p.replay?.total) || p.replay.passed > p.replay.total) return null;
  if (typeof p.tests?.passed !== 'boolean') return null;
  return p;
}

export function evaluateProof(pr: PrRef | undefined, p: ProofPayload, now = new Date()):
  | { status: 'accepted'; proof: Proof }
  | { status: 'stale' | 'unknown' } {
  if (!pr || pr.repo !== p.repo || pr.number !== p.pr) return { status: 'unknown' };
  if (pr.headSha !== p.headSha) return { status: 'stale' }; // someone pushed after we opened it
  const ok = p.tests.passed && p.replay.total > 0 && p.replay.passed === p.replay.total;
  return {
    status: 'accepted',
    proof: { ok, ...p.replay, tests: p.tests.passed, headSha: p.headSha, runUrl: p.runUrl, at: now.toISOString() },
  };
}

// merge_pr is only ever runnable for a passing proof of the commit we opened.
export const canMerge = (pr: PrRef | undefined, proof: Proof | undefined) =>
  !!pr && !!proof?.ok && proof.headSha === pr.headSha;
