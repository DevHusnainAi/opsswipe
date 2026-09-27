// What happens to an incident after a fix ran. Pure, so every path is unit-tested.
//
// Two kinds of fix:
//   - production fixes (restart, reset, rollback, merge_pr) restore service
//   - code fixes (revert_pr) change the code and need CI proof + merge before they count
// While a revert PR is open, the incident stays open even if production is mitigated by a
// rollback, so the proof can still land and the merge can still be approved.
import type { PrRef } from './proof.ts';

type Inc = { actions: string[]; context: { pr?: PrRef; [k: string]: unknown } };
export type AfterFix = { keepOpen: boolean; update: Record<string, unknown> };

export function afterFix(action: string, inc: Inc, extra: { pr?: PrRef } = {}, now = new Date()): AfterFix {
  if (action === 'revert_pr') {
    const actions = inc.actions.filter((a) => a !== 'revert_pr');
    return {
      keepOpen: true,
      update: {
        actions,
        action: actions.includes('rollback') ? 'rollback' : actions[0] ?? 'merge_pr',
        reason: 'Revert PR opened; CI is proving it. Roll back to restore service meanwhile.',
        suggested_by: 'rules',
        context: { ...inc.context, pr: extra.pr },
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
        reason: 'Service restored. Merge the revert PR once CI proves it.',
        suggested_by: 'rules',
        context: { ...inc.context, mitigated_at: now.toISOString(), mitigated_by: action },
      },
    };
  }

  return { keepOpen: false, update: { status: 'resolved', resolved_at: now.toISOString() } };
}
