// What happens to an incident after a fix ran. Pure, so every path is unit-tested.
//
// Two kinds of fix:
//   - production fixes (restart, reset, rollback, merge_pr) restore service
//   - code fixes (revert_pr, fix_pr) change the code and need CI proof + merge before they count
// While a PR is open, the incident stays open even if production is mitigated by a rollback, so the
// proof can still land and the merge can still be approved. One PR at a time per incident; a failed
// proof re-offers a code fix (afterProof). A VM reboot is not offered meanwhile: it boots the same bad
// code, so on a VM the card just waits for the proof.
import type { PrRef } from './proof.ts';
import { CODE_FIXES } from './targets.ts';

type Inc = { actions: string[]; context: { pr?: PrRef; [k: string]: unknown } };
export type AfterFix = { keepOpen: boolean; update: Record<string, unknown> };

export function afterFix(action: string, inc: Inc, extra: { pr?: PrRef } = {}, now = new Date()): AfterFix {
  if ((CODE_FIXES as string[]).includes(action)) {
    const actions = inc.actions.filter((a) => !(CODE_FIXES as string[]).includes(a) && a !== 'reset');
    const mitigate = actions.includes('rollback') ? 'rollback' : null;
    const what = action === 'fix_pr' ? 'AI fix PR' : 'Revert PR';
    return {
      keepOpen: true,
      update: {
        actions,
        action: mitigate ?? actions[0] ?? 'merge_pr',
        reason: `${what} opened; CI is proving it.${mitigate ? ' Roll back to restore service meanwhile.' : ''}`,
        suggested_by: 'rules',
        context: { ...inc.context, pr: extra.pr && { ...extra.pr, kind: action } },
      },
    };
  }

  const prOpen = !!inc.context.pr && action !== 'merge_pr';
  if (prOpen) {
    // Service is restored, but the code fix is still in flight: wait for the proven merge.
    const actions = inc.actions.filter((a) => a === 'merge_pr');
    return {
      keepOpen: true,
      update: {
        actions,
        action: 'merge_pr',
        reason: 'Service restored. Merge the PR once CI proves it.',
        suggested_by: 'rules',
        context: { ...inc.context, mitigated_at: now.toISOString(), mitigated_by: action },
      },
    };
  }

  return { keepOpen: false, update: { status: 'resolved', resolved_at: now.toISOString() } };
}

// An incident closes on its own when nothing was run and no PR waits for its proof. One the app
// reported also needs 10 quiet minutes: its health URL can be fine while /checkout still fails.
const QUIET_MS = 10 * 60_000;
export const selfHealed = (
  context: { pr?: unknown; replay?: { at: string }[] },
  executed: number,
  reported = false,
  now = Date.now(),
) =>
  !context.pr && executed === 0 &&
  (!reported || (context.replay ?? []).every((s) => now - Date.parse(s.at) > QUIET_MS));

// A single reported failure is held; a second one within a minute confirms an outage worth a page.
// ponytail: two reports in 60 s; a per-service threshold if someone's traffic needs it.
export const confirmsReport = (pendingAt: string | null | undefined, now = Date.now()) =>
  !!pendingAt && now - Date.parse(pendingAt) <= 60_000;

type ProofResult = { ok: boolean; passed: number; total: number };

// What the card offers once CI reports. A pass unlocks the merge. A failure is not a dead end: the
// AI fix is offered again (Claude sees the same failing requests), and so is a revert unless the
// revert itself just failed (reverting the same commit again proves nothing new).
export function afterProof(
  inc: { actions: string[]; context: { pr?: PrRef } },
  proof: ProofResult,
  mergeable: boolean,
  opts: { ai: boolean; repo: boolean },
): { actions: string[]; action?: string; reason?: string } {
  const actions = inc.actions.filter((a) => a !== 'merge_pr');
  if (mergeable) {
    return {
      actions: [...actions, 'merge_pr'],
      action: 'merge_pr',
      reason: 'CI proved the fix against the failing production requests.',
    };
  }
  if (proof.ok || !opts.repo) return { actions };
  const retry = [
    ...(opts.ai ? ['fix_pr'] : []),
    ...(inc.context.pr?.kind === 'revert_pr' ? [] : ['revert_pr']),
  ].filter((a) => !actions.includes(a));
  const next = [...actions, ...retry];
  const failed = `Proof failed: ${proof.passed}/${proof.total} pass.`;
  if (next.includes('fix_pr')) {
    return { actions: next, action: 'fix_pr', reason: `${failed} Try an AI fix with these failures.` };
  }
  if (next.includes('revert_pr')) return { actions: next, action: 'revert_pr', reason: `${failed} Try a revert.` };
  return { actions: next, reason: `${failed} Push a fix to the PR; CI runs the proof again.` };
}

// Escalation: an incident nobody has touched for 5 minutes pages the owner's team, once.
export const ESCALATE_AFTER_MS = 5 * 60_000;
export const needsEscalation = (
  inc: { created_at: string; status: string; context: { escalated_at?: string } },
  actions: number, // audit rows so far: a fix tried, a dismissal
  now = Date.now(),
) =>
  inc.status === 'active' && !inc.context.escalated_at && actions === 0 &&
  now - Date.parse(inc.created_at) >= ESCALATE_AFTER_MS;
