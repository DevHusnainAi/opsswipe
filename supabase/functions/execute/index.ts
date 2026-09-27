// Swipe → authorize → remediate. The phone sends an incident id and which offered fix to run.
// Who is asking comes from the verified JWT and must own the incident; what can run comes from
// the service's validated config AND the fixes stored on the incident. Nothing else is trusted.
import { db, env, json } from '../_shared/db.ts';
import { isActive } from '../_shared/entitlement.ts';
import { resetInstance } from '../_shared/gcp.ts';
import { mergePr, openRevertPr } from '../_shared/github.ts';
import { afterFix } from '../_shared/flow.ts';
import { canMerge, type Proof, type PrRef } from '../_shared/proof.ts';
import type { ReplaySample } from '../_shared/replay.ts';
import { type Deploy, listDeploys, pickRollback, restartService, rollbackToPrevious } from '../_shared/render.ts';
import { getService, githubToken, platformSa, renderKey, type Service, toTarget } from '../_shared/services.ts';
import { type Action, actionsFor } from '../_shared/targets.ts';

const ENTITLEMENT = 'pro';
const FREE_RUNS = 1;

type Incident = {
  id: string;
  title: string;
  target_server: string;
  metric: string;
  actions: string[];
  action: string;
  reason: string | null;
  suggested_by: string | null;
  service_id: string;
  owner: string;
  context: { replay?: ReplaySample[]; pr?: PrRef; proof?: Proof; live?: Deploy | null; [k: string]: unknown };
};

// What a fix did, and how the incident should change afterwards.
type Outcome = { detail: string; pr?: PrRef };

async function isPro(uid: string) {
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${uid}`, {
    headers: { Authorization: `Bearer ${env('REVENUECAT_SECRET_KEY')}` },
  });
  if (!res.ok) throw new Error(`revenuecat ${res.status}`);
  return isActive((await res.json()).subscriber.entitlements[ENTITLEMENT]);
}

// Runs one fix. The detail goes to the audit log (e.g. the PR link).
async function runAction(s: Service, action: Action, inc: Incident): Promise<Outcome> {
  const t = toTarget(s);
  if (t.provider === 'gcp') {
    await resetInstance(t, platformSa());
    return { detail: 'vm reset issued' };
  }
  const key = await renderKey(s.owner);
  if (action === 'restart') {
    await restartService(t.serviceId, key);
    return { detail: 'restart issued' };
  }
  if (action === 'rollback') return { detail: await rollbackToPrevious(t.serviceId, key) };
  if (action === 'merge_pr') return { detail: await mergePr(inc.context.pr!, await githubToken(s.owner)) };

  // revert_pr: revert the release that was live when the incident opened. A rollback since then
  // changes what's live, but the bad commit is still the one to revert.
  const live = inc.context.live?.commit?.id ? inc.context.live : pickRollback(await listDeploys(t.serviceId, key)).live;
  if (!live?.commit?.id) throw new Error('no deploy commit to revert');
  const pr = await openRevertPr({
    repo: t.repo!,
    branch: t.branch ?? 'main',
    commitSha: live.commit.id,
    body: [
      'Opened by OpsSwipe after the on-call engineer approved it with biometrics.',
      '',
      `**Incident:** ${inc.title} on \`${inc.target_server}\``,
      `**Symptom:** ${inc.metric}`,
      inc.reason ? `**Why this commit:** ${inc.reason} _(suggested by ${inc.suggested_by ?? 'rules'})_` : null,
      '',
      `Merging deploys the code from before \`${live.commit.id.slice(0, 7)}\`.`,
      `CI replays the ${inc.context.replay?.length ?? 0} failing production request(s) against this PR;`,
      'OpsSwipe only lets you merge once they all pass. Roll back in OpsSwipe to restore service now.',
    ].filter((l) => l !== null).join('\n'),
    replay: inc.context.replay ?? [],
  }, await githubToken(s.owner));
  return { detail: pr.url, pr };
}

Deno.serve(async (req) => {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return json(401, { error: 'unauthorized' });

  const { incidentId, action: requested } = await req.json().catch(() => ({}));
  if (typeof incidentId !== 'string') return json(400, { error: 'incidentId required' });
  if (requested !== undefined && typeof requested !== 'string') return json(400, { error: 'action must be a string' });

  // Claim the incident atomically: a double swipe can't run a fix twice, and only its owner can
  // claim it at all (someone else's incident looks exactly like a missing one).
  const { data: inc } = await db.from('incidents').update({ status: 'resolving' })
    .eq('id', incidentId).eq('owner', user.id).eq('status', 'active').select().maybeSingle<Incident>();
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

  const service = inc.service_id ? await getService(inc.service_id) : null;
  if (!service || !actionsFor(toTarget(service)).includes(action) || !inc.actions.includes(action)) {
    await release();
    await audit('failed', 'fix not allowed for this target');
    return json(403, { error: 'fix not allowed' });
  }
  // Checked before metering, so nobody pays for a merge that was never going to run.
  if (action === 'merge_pr' && !canMerge(inc.context.pr, inc.context.proof)) {
    await release();
    await audit('failed', 'no passing proof for the current PR commit');
    return json(403, { error: 'PR is not proven' });
  }

  let usedFreeRun = false;
  let outcome: Outcome;
  try {
    if (!(await isPro(user.id))) {
      const { data: ok } = await db.rpc('consume_free_run', { uid: user.id, free_limit: FREE_RUNS });
      if (!ok) {
        await release();
        await audit('paywalled');
        return json(402, { error: 'free tier exhausted' });
      }
      usedFreeRun = true;
    }
    outcome = await runAction(service, action, inc);
  } catch (e) {
    await release();
    if (usedFreeRun) await db.rpc('refund_free_run', { uid: user.id });
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
