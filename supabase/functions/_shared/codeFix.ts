// The code fixes, shared by execute/ (after the engineer's swipe) and incidents.ts (a fix prepared
// automatically when an incident opens). Both only open pull requests: merging still needs CI proof
// and a swipe.
import { db, env } from './db.ts';
import { isActive, proFromRow } from './entitlement.ts';
import { branchHead, commitFiles, commitMessage, openFilesPr, openRevertPr, testExample } from './github.ts';
import { checkPatch, type Patcher, regressionTestPath } from './patch.ts';
import type { Proof, PrRef } from './proof.ts';
import type { ReplaySample } from './replay.ts';
import { type Deploy, listDeploys, pickRollback } from './render.ts';
import { renderKey, type Service } from './services.ts';
import type { Target } from './targets.ts';

export type Incident = {
  id: string;
  title: string;
  status: string;
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
export type Outcome = { detail: string; pr?: PrRef };

// RevenueCat is the source of truth. If its API is down, the copy its webhooks keep decides: a pager
// that can't fix production because billing is unreachable would fail exactly when it's needed.
// Plans: Pro grants the `pro` entitlement, Team grants `team`. Team includes everything in Pro, so either
// one unlocks fixes, however the products are attached in RevenueCat (the server never knows product ids).
export const isPro = (uid: string) => entitled(uid, ['pro', 'team']);
export const isTeam = (uid: string) => entitled(uid, ['team']);

async function entitled(uid: string, any: ('pro' | 'team')[]) {
  try {
    const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${uid}`, {
      headers: { Authorization: `Bearer ${env('REVENUECAT_SECRET_KEY')}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`revenuecat ${res.status}`);
    const all = (await res.json()).subscriber.entitlements;
    return any.some((e) => isActive(all[e]));
  } catch (e) {
    // ponytail: the webhook copy only tracks Pro, so a RevenueCat outage treats any paid plan as Team.
    console.warn('revenuecat unavailable, using the webhook copy:', String(e));
    const { data } = await db.from('entitlements').select('pro_until').eq('owner', uid).maybeSingle();
    return proFromRow(data);
  }
}

// The commit that broke production: the release live when the incident opened (Render's deploy
// history, or the `release` the app reported). A rollback since then changes what's live, but the
// bad commit is still the one to fix. A VM with neither falls back to the branch head.
export async function badCommit(s: Service, t: Target, inc: Incident, token: string) {
  if (inc.context.live?.commit?.id) return inc.context.live.commit.id;
  if (t.provider === 'render') {
    const live = pickRollback(await listDeploys(t.serviceId, await renderKey(s.owner))).live;
    if (live?.commit?.id) return live.commit.id;
  }
  return await branchHead(t.repo!, t.branch ?? 'main', token);
}

// The model writes the smallest fix to the files the bad commit touched; it ships as a PR with the
// failing requests, so the merge still waits for CI to prove it.
export async function aiFixPr(
  t: Target,
  sha: string,
  inc: Incident,
  token: string,
  patcher: Patcher | undefined,
  prepared = false, // opened automatically when the incident opened, before anyone approved anything
): Promise<Outcome> {
  if (!patcher) throw new Error('AI fixes are not switched on for this server');
  const branch = t.branch ?? 'main';
  const commit = await commitMessage(t.repo!, sha, token);
  const example = await testExample(t.repo!, branch, token);
  const input = {
    repo: t.repo!,
    commit: { sha, message: commit },
    symptom: inc.metric,
    failing: inc.context.replay ?? [],
    files: await commitFiles(t.repo!, sha, branch, token),
    test: example ? { example, path: regressionTestPath(example.path, sha) } : null,
  };
  const patch = checkPatch(await patcher(input), input);
  const test = patch.files.find((f) => f.path === input.test?.path);
  const short = sha.slice(0, 7);
  const pr = await openFilesPr({
    repo: t.repo!,
    branch,
    branchName: `opsswipe/fix-${short}-${Date.now().toString(36)}`,
    title: `Fix ${inc.title.toLowerCase()} after ${short}`,
    body: [
      prepared
        ? 'Written by AI and opened by OpsSwipe automatically when the outage began. Nothing is merged until the on-call engineer approves it with their fingerprint.'
        : 'Written by AI and opened by OpsSwipe after the on-call engineer approved it with their fingerprint.',
      '',
      `**Incident:** ${inc.title} on \`${inc.target_server}\``,
      `**Symptom:** ${inc.metric}`,
      `**Broke in:** \`${short}\` ${commit.split('\n')[0]}`,
      `**Fix:** ${patch.summary}`,
      '',
      '### How this is proven',
      test
        ? `- Your test suite runs, including a new regression test for the failing requests: \`${test.path}\``
        : '- Your test suite runs (no test file found to model a regression test on)',
      `- CI starts this PR's build and replays the ${input.failing.length} production request(s) that failed`,
      '',
      'OpsSwipe only lets you merge once both pass. Review the change like any other PR.',
    ].join('\n'),
    files: [
      ...patch.files,
      {
        path: `.opsswipe/replays/${short}.json`,
        content: `${JSON.stringify({ fixes: sha, samples: input.failing }, null, 2)}\n`,
      },
    ],
  }, token);
  return { detail: pr.url, pr };
}

export async function revertPr(t: Target, sha: string, inc: Incident, token: string): Promise<Outcome> {
  const pr = await openRevertPr({
    repo: t.repo!,
    branch: t.branch ?? 'main',
    commitSha: sha,
    body: [
      'Opened by OpsSwipe after the on-call engineer approved it with biometrics.',
      '',
      `**Incident:** ${inc.title} on \`${inc.target_server}\``,
      `**Symptom:** ${inc.metric}`,
      inc.reason ? `**Why this commit:** ${inc.reason} _(suggested by ${inc.suggested_by ?? 'rules'})_` : null,
      '',
      `Merging deploys the code from before \`${sha.slice(0, 7)}\`.`,
      `CI replays the ${inc.context.replay?.length ?? 0} failing production request(s) against this PR;`,
      'OpsSwipe only lets you merge once they all pass.',
    ].filter((l) => l !== null).join('\n'),
    replay: inc.context.replay ?? [],
  }, token);
  return { detail: pr.url, pr };
}
