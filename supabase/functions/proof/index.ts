// CI reports whether a PR fixed the failing production requests. No shared secrets: the request
// carries a GitHub Actions OIDC token, which proves which repo and which PR the run was for.
// Accepted only for the exact head commit OpsSwipe opened; merge_pr unlocks only on a full pass.
import { db, json } from '../_shared/db.ts';
import { afterProof } from '../_shared/flow.ts';
import { aiEnabled } from '../_shared/incidents.ts';
import { prNumberFromRef, verifyGithubOidc } from '../_shared/oidc.ts';
import { notify } from '../_shared/services.ts';
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

  const { data: inc } = await db.from('incidents').select('id, owner, target_server, actions, context')
    .in('status', ['active', 'resolving'])
    .eq('context->pr->>repo', repo)
    .eq('context->pr->>number', String(prNumber))
    .maybeSingle<
      { id: string; owner: string; target_server: string; actions: string[]; context: { pr?: PrRef; proof?: Proof } }
    >();
  if (!inc) return json(404, { error: 'no open incident for this PR' });

  const result = evaluateProof(inc.context.pr, { ...body, repo, pr: prNumber });
  if (result.status !== 'accepted') {
    return result.status === 'stale'
      ? json(409, { error: 'proof is for a different commit than OpsSwipe opened' })
      : json(404, { error: 'PR does not match' });
  }

  const next = afterProof(inc, result.proof, canMerge(inc.context.pr, result.proof), { ai: aiEnabled(), repo: true });
  await db.from('incidents').update({
    ...next,
    ...(next.action ? { suggested_by: 'rules' } : {}),
    context: { ...inc.context, proof: result.proof },
  }).eq('id', inc.id);
  const { passed, total } = result.proof;
  await notify(
    inc.owner,
    result.proof.ok
      ? {
        title: `Fix proven for ${inc.target_server}`,
        body: `${passed}/${total} failing production requests now pass. Ready to merge.`,
        data: { incidentId: inc.id },
      }
      : {
        title: `Fix not proven for ${inc.target_server}`,
        body: `${next.reason ?? `Only ${passed}/${total} failing requests pass.`}`,
        data: { incidentId: inc.id },
      },
  );
  return json(200, { accepted: true, ok: result.proof.ok });
});
