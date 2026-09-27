// CI reports whether a PR fixed the failing production requests. No shared secrets: the request
// carries a GitHub Actions OIDC token, which proves which repo and which PR the run was for.
// Accepted only for the exact head commit OpsSwipe opened; merge_pr unlocks only on a full pass.
import { db, json } from '../_shared/db.ts';
import { prNumberFromRef, verifyGithubOidc } from '../_shared/oidc.ts';
import { canMerge, evaluateProof, parseProof, type Proof, type PrRef } from '../_shared/proof.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  let repo: string, prNumber: number | null;
  try {
    const claims = await verifyGithubOidc(req.headers.get('Authorization')?.replace(/^Bearer /i, '') ?? '');
    if (claims.event_name !== 'pull_request') throw new Error('not a pull_request run');
    repo = claims.repository;
    prNumber = prNumberFromRef(claims.ref);
  } catch (e) {
    return json(401, { error: `untrusted proof: ${(e as Error).message}` });
  }
  if (!prNumber) return json(400, { error: 'run is not for a pull request' });

  let body;
  try {
    body = parseProof(JSON.parse(await req.text()));
  } catch {
    body = null;
  }
  if (!body) return json(400, { error: 'invalid proof' });

  const { data: inc } = await db.from('incidents').select('id, actions, context')
    .in('status', ['active', 'resolving'])
    .eq('context->pr->>repo', repo)
    .eq('context->pr->>number', String(prNumber))
    .maybeSingle<{ id: string; actions: string[]; context: { pr?: PrRef; proof?: Proof } }>();
  if (!inc) return json(404, { error: 'no open incident for this PR' });

  const result = evaluateProof(inc.context.pr, { ...body, repo, pr: prNumber });
  if (result.status !== 'accepted') {
    return result.status === 'stale'
      ? json(409, { error: 'proof is for a different commit than OpsSwipe opened' })
      : json(404, { error: 'PR does not match' });
  }

  const actions = inc.actions.filter((a) => a !== 'merge_pr');
  if (canMerge(inc.context.pr, result.proof)) actions.push('merge_pr');
  await db.from('incidents').update({
    actions,
    // a proven PR becomes the suggested fix
    ...(result.proof.ok
      ? { action: 'merge_pr', reason: 'CI proved the fix against the failing production requests.' }
      : {}),
    context: { ...inc.context, proof: result.proof },
  }).eq('id', inc.id);
  return json(200, { accepted: true, ok: result.proof.ok });
});
