// Swipe → authorize → remediate. The phone sends an incident id and which offered fix to run.
// Who is asking comes from the verified JWT; what can run comes from the TARGETS allowlist
// AND the fixes stored on the incident when it was opened. Nothing else is trusted.
import { db, env, json } from '../_shared/db.ts';
import { isActive } from '../_shared/entitlement.ts';
import { resetInstance } from '../_shared/gcp.ts';
import { mergePr, openRevertPr } from '../_shared/github.ts';
import { canMerge, type Proof, type PrRef } from '../_shared/proof.ts';
import type { ReplaySample } from '../_shared/replay.ts';
import { listDeploys, pickRollback, restartService, rollbackToPrevious } from '../_shared/render.ts';
import { type Action, actionsFor, parseTargets, type Target } from '../_shared/targets.ts';

const ENTITLEMENT = 'pro';
const FREE_RUNS = 1;
const TARGETS = parseTargets(env('TARGETS'));

type Incident = {
  id: string;
  title: string;
  target_server: string;
  metric: string;
  actions: string[];
  action: string;
  reason: string | null;
  suggested_by: string | null;
  context: { replay?: ReplaySample[]; pr?: PrRef; proof?: Proof; [k: string]: unknown };
};

// What a fix did, and how the incident should change afterwards.
type Outcome = { detail: string; keepOpen?: boolean; update?: Record<string, unknown> };

async function isPro(uid: string) {
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${uid}`, {
    headers: { Authorization: `Bearer ${env('REVENUECAT_SECRET_KEY')}` },
  });
  if (!res.ok) throw new Error(`revenuecat ${res.status}`);
  return isActive((await res.json()).subscriber.entitlements[ENTITLEMENT]);
}

// Runs one fix. The detail goes to the audit log (e.g. the PR link).
async function runAction(t: Target, action: Action, inc: Incident): Promise<Outcome> {
  if (t.provider === 'gcp') {
    await resetInstance(t, JSON.parse(env('GCP_SA_KEY')));
    return { detail: 'vm reset issued' };
  }
  const key = env('RENDER_API_KEY');
  if (action === 'restart') {
    await restartService(t.serviceId, key);
    return { detail: 'restart issued' };
  }
  if (action === 'rollback') return { detail: await rollbackToPrevious(t.serviceId, key) };
  if (action === 'merge_pr') return { detail: await mergePr(inc.context.pr!, env('GITHUB_TOKEN')) };

  // revert_pr: re-read the live deploy now, so we revert what is actually running.
  const { live } = pickRollback(await listDeploys(t.serviceId, key));
  if (!live?.commit?.id) throw new Error('live deploy has no commit to revert');
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
  }, env('GITHUB_TOKEN'));
  // A PR fixes the code, not production: keep the incident open (rollback still available)
  // until CI proves the PR and it's merged.
  return {
    detail: pr.url,
    keepOpen: true,
    update: { context: { ...inc.context, pr }, actions: inc.actions.filter((a) => a !== 'revert_pr') },
  };
}

Deno.serve(async (req) => {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return json(401, { error: 'unauthorized' });

  const { incidentId, action: requested } = await req.json().catch(() => ({}));
  if (typeof incidentId !== 'string') return json(400, { error: 'incidentId required' });
  if (requested !== undefined && typeof requested !== 'string') return json(400, { error: 'action must be a string' });

  // claim the incident atomically: a double swipe can't run a fix twice
  const { data: inc } = await db.from('incidents').update({ status: 'resolving' })
    .eq('id', incidentId).eq('status', 'active').select().maybeSingle<Incident>();
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

  const target = TARGETS[inc.target_server];
  if (!target || !actionsFor(target).includes(action) || !inc.actions.includes(action)) {
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
    outcome = await runAction(target, action, inc);
  } catch (e) {
    await release();
    if (usedFreeRun) await db.rpc('refund_free_run', { uid: user.id });
    await audit('failed', String(e));
    return json(502, { error: 'remediation failed' });
  }

  const after = outcome.keepOpen
    ? { status: 'active', ...outcome.update }
    : { status: 'resolved', resolved_at: new Date().toISOString(), ...outcome.update };
  await db.from('incidents').update(after).eq('id', inc.id);
  await audit('executed', `${outcome.detail}${usedFreeRun ? ' (free run)' : ''}`);
  return json(200, { ok: true, action, detail: outcome.detail });
});
