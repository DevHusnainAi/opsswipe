import { assertEquals } from 'jsr:@std/assert@1';
import { afterFix } from '../_shared/flow.ts';
import type { PrRef } from '../_shared/proof.ts';

const now = new Date('2026-09-28T10:00:00Z');
const pr: PrRef = { repo: 'me/app', number: 7, headSha: 'a'.repeat(40), url: 'u', branch: 'b' };
const fresh = { actions: ['restart', 'rollback', 'revert_pr'], context: {} };

Deno.test('a plain fix resolves the incident', () => {
  assertEquals(afterFix('rollback', fresh, {}, now), {
    keepOpen: false,
    update: { status: 'resolved', resolved_at: now.toISOString() },
  });
});

Deno.test('revert PR keeps the incident open, drops itself, and points the card at rollback', () => {
  const r = afterFix('revert_pr', fresh, { pr }, now);
  assertEquals(r.keepOpen, true);
  assertEquals(r.update.actions, ['restart', 'rollback']);
  assertEquals(r.update.action, 'rollback', 'the suggested fix must still be offered');
  assertEquals((r.update.context as { pr: PrRef }).pr, pr);
});

Deno.test('rolling back while a revert PR is open restores service but waits for the proven merge', () => {
  const withPr = { actions: ['restart', 'rollback'], context: { pr } };
  const r = afterFix('rollback', withPr, {}, now);
  assertEquals(r.keepOpen, true, 'resolving here would orphan the proof and the merge');
  assertEquals(r.update.actions, [], 'nothing to run until CI proves the PR');
  assertEquals(r.update.action, 'merge_pr');
  assertEquals((r.update.context as { mitigated_by: string }).mitigated_by, 'rollback');

  const proven = afterFix('restart', { actions: ['restart', 'rollback', 'merge_pr'], context: { pr } }, {}, now);
  assertEquals(proven.update.actions, ['merge_pr'], 'an already-proven merge stays available');
});

Deno.test('merging the proven PR resolves the incident', () => {
  const r = afterFix('merge_pr', { actions: ['merge_pr'], context: { pr } }, {}, now);
  assertEquals(r.keepOpen, false);
  assertEquals(r.update.status, 'resolved');
});
