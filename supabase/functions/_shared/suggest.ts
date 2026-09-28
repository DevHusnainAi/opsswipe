// Which fix should the card propose, and why (one sentence, read on a phone at 3am)?
// Rules always produce an answer. Claude (on Vertex, billed to GCP credits) can refine it,
// but only ever picks from the allowlisted actions; any error or refusal falls back to rules.
import { AnthropicVertex } from 'npm:@anthropic-ai/vertex-sdk@0.19.11';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@0.128/helpers/zod';
import { z } from 'npm:zod@4';
import type { Action } from './targets.ts';

export type SuggestInput = {
  target: string;
  provider: 'gcp' | 'render' | 'railway';
  actions: Action[];
  symptom: string; // e.g. "GET app.onrender.com -> 503 (212ms)"
  liveDeploy?: { commit?: string; message?: string; minutesBeforeFailure: number };
  previousDeploy?: { commit?: string };
};
export type Suggestion = { action: Action; reason: string; source: 'rules' | 'ai' };
export type Suggester = (i: SuggestInput) => Promise<{ action: Action; reason: string }>;

const RECENT_DEPLOY_MIN = 30;

export function ruleSuggest(i: SuggestInput): Suggestion {
  const d = i.liveDeploy;
  if (d && d.minutesBeforeFailure <= RECENT_DEPLOY_MIN && i.previousDeploy && i.actions.includes('rollback')) {
    const what = d.commit ? `${d.commit.slice(0, 7)}` : 'A new release';
    return {
      action: 'rollback',
      reason: `${what} deployed ${
        Math.round(d.minutesBeforeFailure)
      }m before the failure. Roll back to the last good release.`,
      source: 'rules',
    };
  }
  // A VM has no rollback. If its app answers 500, the code broke, not the machine: a reset would
  // just boot the same bad release, so the fix is a revert (proven in CI before merge).
  if (!i.actions.includes('rollback') && i.actions.includes('revert_pr') && /(→|->) 500\b/.test(i.symptom)) {
    return {
      action: 'revert_pr',
      reason: `The app answers 500, so the code broke. Revert ${
        d?.commit ? d.commit.slice(0, 7) : 'the release'
      }; CI proves it first.`,
      source: 'rules',
    };
  }
  if (i.actions.includes('restart')) {
    return {
      action: 'restart',
      reason: 'No recent deploy. A restart clears a hung or crashed process.',
      source: 'rules',
    };
  }
  return {
    action: i.actions[0],
    reason: 'The VM stopped answering. A reboot restarts it and its services; disk data stays.',
    source: 'rules',
  };
}

export async function suggest(i: SuggestInput, ai?: Suggester): Promise<Suggestion> {
  const base = ruleSuggest(i);
  if (!ai) return base;
  try {
    const r = await ai(i);
    return i.actions.includes(r.action) && r.reason.trim() ? { ...r, source: 'ai' } : base;
  } catch (e) {
    console.warn('ai suggestion failed, using rules:', String(e));
    return base;
  }
}

const SYSTEM = `You are the triage step of OpsSwipe, a pager that lets an on-call engineer approve one fix with a swipe.
Given a failing health check and deploy context, choose exactly one action from the allowed list and give a reason.
- rollback: restores the previous release now. Prefer it when a deploy landed shortly before the failure.
- restart: restarts the running process. Prefer it when nothing was deployed recently.
- reset: reboots a VM (a power-cycle; disk data stays, memory is lost). Fixes a stopped or hung app, but boots the same code, so it can't fix a bad release. Call it a reboot in the reason, never a reset.
- revert_pr: opens a pull request reverting the bad commit. It fixes the code but only helps after it is merged and deployed, so prefer rollback for restoring service.
- fix_pr: Claude writes the smallest code fix for the bad commit as a pull request. Prefer it over revert_pr when the commit also shipped work worth keeping; like revert_pr, it only helps after merge.
The reason is one plain sentence under 20 words, naming the evidence (the commit, the timing, the status code). No speculation beyond the input.`;

export function vertexSuggester(projectId: string, accessToken: () => Promise<string>): Suggester {
  return async (i) => {
    const client = new AnthropicVertex({ projectId, region: 'global', accessToken: await accessToken() });
    const schema = z.object({ action: z.enum(i.actions as [Action, ...Action[]]), reason: z.string() });
    const res = await client.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 16000,
      output_config: { effort: 'low', format: zodOutputFormat(schema) },
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(i) }],
    });
    if (res.stop_reason === 'refusal' || !res.parsed_output) throw new Error(`no suggestion (${res.stop_reason})`);
    return res.parsed_output;
  };
}

type DeployLike = { createdAt: string; finishedAt?: string; commit?: { id: string; message?: string } };

// Build the triage input from what the health check saw plus Render's deploy history.
export function toSuggestInput(
  target: string,
  provider: 'gcp' | 'render' | 'railway',
  actions: Action[],
  symptom: string,
  deploys: { live?: DeployLike; previous?: DeployLike },
  now = Date.now(),
): SuggestInput {
  const { live, previous } = deploys;
  return {
    target,
    provider,
    actions,
    symptom,
    liveDeploy: live && {
      commit: live.commit?.id,
      message: live.commit?.message,
      minutesBeforeFailure: (now - Date.parse(live.finishedAt ?? live.createdAt)) / 60_000,
    },
    previousDeploy: previous && { commit: previous.commit?.id },
  };
}
