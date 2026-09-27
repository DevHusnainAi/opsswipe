// CI reports whether a PR fixed the failing production requests. Signed with HMAC (PROOF_SECRET).
// Accepted only for the exact head commit OpsSwipe opened; merge_pr unlocks only when the replay
// and the test suite all passed.
import { db, env, json } from '../_shared/db.ts';
import { verify } from '../_shared/hmac.ts';
import { canMerge, evaluateProof, parseProof, type Proof, type PrRef } from '../_shared/proof.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const raw = await req.text();
  if (!(await verify(env('PROOF_SECRET'), raw, req.headers.get('x-opsswipe-signature')))) {
    return json(401, { error: 'bad signature' });
  }
  let payload;
  try {
    payload = parseProof(JSON.parse(raw));
  } catch {
    payload = null;
  }
  if (!payload) return json(400, { error: 'invalid proof' });

  const { data: inc } = await db.from('incidents').select('id, actions, context')
    .in('status', ['active', 'resolving'])
    .eq('context->pr->>repo', payload.repo)
    .eq('context->pr->>number', String(payload.pr))
    .maybeSingle<{ id: string; actions: string[]; context: { pr?: PrRef; proof?: Proof } }>();
  if (!inc) return json(404, { error: 'no open incident for this PR' });

  const result = evaluateProof(inc.context.pr, payload);
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
