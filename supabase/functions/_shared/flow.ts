// What happens to an incident after a fix ran. Pure, so every path is unit-tested.
//
// Two kinds of fix:
//   - production fixes (restart, reset, rollback, merge_pr) restore service
//   - code fixes (revert_pr, fix_pr) change the code and need CI proof + merge before they count
// While a PR is open, the incident stays open even if production is mitigated by a rollback or
// reset, so the proof can still land and the merge can still be approved. One PR per incident.
import type { PrRef } from './proof.ts';
import { CODE_FIXES } from './targets.ts';

type Inc = { actions: string[]; context: { pr?: PrRef; [k: string]: unknown } };
export type AfterFix = { keepOpen: boolean; update: Record<string, unknown> };

export function afterFix(action: string, inc: Inc, extra: { pr?: PrRef } = {}, now = new Date()): AfterFix {
  if ((CODE_FIXES as string[]).includes(action)) {
    const actions = inc.actions.filter((a) => !(CODE_FIXES as string[]).includes(a));
    const mitigate = actions.includes('rollback') ? 'rollback' : actions.includes('reset') ? 'reset' : null;
    const what = action === 'fix_pr' ? 'AI fix PR' : 'Revert PR';
    return {
      keepOpen: true,
      update: {
        actions,
        action: mitigate ?? actions[0] ?? 'merge_pr',
        reason: `${what} opened; CI is proving it.${
          mitigate ? ` ${mitigate === 'rollback' ? 'Roll back' : 'Reset'} to restore service meanwhile.` : ''
        }`,
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
