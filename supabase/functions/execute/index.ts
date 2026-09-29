// Swipe → authorize → remediate. The phone sends an incident id and which offered fix to run.
// Who is asking comes from the verified JWT and must own the incident; what can run comes from
// the service's validated config AND the fixes stored on the incident. Nothing else is trusted.
import { aiFixPr, badCommit, type Incident, isPro, type Outcome, revertPr } from '../_shared/codeFix.ts';
import { db, json } from '../_shared/db.ts';
import { resetInstance } from '../_shared/gcp.ts';
import { mergePr } from '../_shared/github.ts';
import { afterFix } from '../_shared/flow.ts';
import { aiPatcher } from '../_shared/incidents.ts';
import { canMerge } from '../_shared/proof.ts';
import { restartService, rollbackToPrevious } from '../_shared/render.ts';
import { restartRailway, rollbackRailway } from '../_shared/railway.ts';
import {
  getService,
  githubToken,
  ownersFor,
  platformSa,
  railwayToken,
  renderKey,
  type Service,
  toTarget,
} from '../_shared/services.ts';
import { type Action, actionsFor } from '../_shared/targets.ts';

const FREE_RUNS = 1; // free outages (every fix of that incident is included)

// Runs one fix. The detail goes to the audit log (e.g. the PR link).
async function runAction(s: Service, action: Action, inc: Incident): Promise<Outcome> {
  const t = toTarget(s);
  if (action === 'merge_pr') return { detail: await mergePr(inc.context.pr!, await githubToken(s.owner)) };
  if (action === 'revert_pr' || action === 'fix_pr') {
    const token = await githubToken(s.owner);
    const sha = await badCommit(s, t, inc, token);
    return action === 'fix_pr' ? await aiFixPr(t, sha, inc, token, aiPatcher()) : await revertPr(t, sha, inc, token);
  }
  if (t.provider === 'railway') {
    const token = await railwayToken(s.owner);
    return { detail: action === 'rollback' ? await rollbackRailway(t, token) : await restartRailway(t, token) };
  }
  if (t.provider === 'gcp') {
    await resetInstance(t, platformSa());
    return { detail: 'vm reboot issued' };
  }
  const key = await renderKey(s.owner);
  if (action === 'restart') {
    await restartService(t.serviceId, key);
    return { detail: 'restart issued' };
  }
  return { detail: await rollbackToPrevious(t.serviceId, key) };
}

Deno.serve(async (req) => {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return json(401, { error: 'unauthorized' });

  const { incidentId, action: requested } = await req.json().catch(() => ({}));
  if (typeof incidentId !== 'string') return json(400, { error: 'incidentId required' });
  if (requested !== undefined && typeof requested !== 'string') return json(400, { error: 'action must be a string' });

  // Claim the incident atomically: a double swipe can't run a fix twice, and only its owner (or their
  // team) can claim it at all (someone else's incident looks exactly like a missing one). claimed_at
  // lets the health check hand back a claim whose function died mid-fix (sweepStaleClaims).
  const { data: inc } = await db.from('incidents').update({ status: 'resolving', claimed_at: new Date().toISOString() })
    .eq('id', incidentId).in('owner', await ownersFor(user.id)).eq('status', 'active').select().maybeSingle<Incident>();
  if (!inc) return json(409, { error: 'incident is not active' });

  const action = (requested ?? inc.action) as Action;
  const release = () => db.from('incidents').update({ status: 'active' }).eq('id', inc.id);
  const audit = (outcome: string, detail?: string) =>
    db.from('audit_log').insert({
      incident_id: inc.id,
      actor: user.id,
      action,
      target: inc.target_server,
      outcome,
      detail,
    });
  const refuse = async (status: number, error: string, outcome: string, detail?: string) => {
    await release();
    await audit(outcome, detail);
    return json(status, { error });
  };

  // From the claim on, every exit either finishes the incident or hands it back: nothing between
  // here and the final update can leave it stuck in 'resolving'.
  let usedFreeRun = false;
  let outcome: Outcome;
  try {
    // An agent's own command: the human's approval is the whole action; OpsSwipe runs nothing.
    const approval = action === 'approve' && inc.suggested_by === 'agent' && inc.actions.includes('approve');
    const service = !approval && inc.service_id ? await getService(inc.service_id) : null;
    if (
      !approval && (!service || !actionsFor(toTarget(service)).includes(action) || !inc.actions.includes(action))
    ) return await refuse(403, 'fix not allowed', 'failed', 'fix not allowed for this target');
    // Checked before metering, so nobody pays for a merge that was never going to run.
    if (action === 'merge_pr' && !canMerge(inc.context.pr, inc.context.proof)) {
      return await refuse(403, 'PR is not proven', 'failed', 'no passing proof for the current PR commit');
    }
    // The account that owns the outage pays, whoever on the team swipes. Approving an agent's own
    // command runs nothing, so it never uses the free outage.
    if (!approval && !(await isPro(inc.owner))) {
      const { data: ok } = await db.rpc('consume_free_run', {
        uid: inc.owner,
        free_limit: FREE_RUNS,
        incident: inc.id,
      });
      if (!ok) return await refuse(402, 'free tier exhausted', 'paywalled');
      usedFreeRun = true;
    }
    outcome = approval ? { detail: 'approved' } : await runAction(service!, action, inc);
  } catch (e) {
    await release();
    if (usedFreeRun) await db.rpc('refund_free_run', { uid: inc.owner, incident: inc.id });
    await audit('failed', String(e));
    return json(502, { error: 'remediation failed' });
  }

  const next = afterFix(action, inc, { pr: outcome.pr });
  await db.from('incidents').update(next.keepOpen ? { status: 'active', ...next.update } : next.update).eq(
    'id',
    inc.id,
  );
  await audit('executed', `${outcome.detail}${usedFreeRun ? ' (free run)' : ''}`);
  return json(200, { ok: true, action, detail: outcome.detail });
});
