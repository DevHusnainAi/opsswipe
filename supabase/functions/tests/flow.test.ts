import { assertEquals } from 'jsr:@std/assert@1';
import {
  afterFix,
  afterProof,
  confirmsReport,
  needsEscalation,
  needsRepage,
  recoveryChecks,
  selfHealed,
  staleClaim,
  stillFailing,
} from '../_shared/flow.ts';
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
  assertEquals((r.update.context as { pr: PrRef }).pr, { ...pr, kind: 'revert_pr' });
});

Deno.test('an AI fix PR is also one-PR-per-incident: both code fixes drop, rollback stays suggested', () => {
  const r = afterFix('fix_pr', { actions: ['restart', 'rollback', 'revert_pr', 'fix_pr'], context: {} }, { pr }, now);
  assertEquals(r.keepOpen, true);
  assertEquals(r.update.actions, ['restart', 'rollback']);
  assertEquals(r.update.action, 'rollback');
  assertEquals(String(r.update.reason).startsWith('AI fix PR opened'), true);
});

Deno.test('on a VM, no reboot is offered while the PR proves: it would boot the same bad code', () => {
  const r = afterFix('revert_pr', { actions: ['reset', 'revert_pr', 'fix_pr'], context: {} }, { pr }, now);
  assertEquals(r.update.actions, []);
  assertEquals(r.update.action, 'merge_pr', 'the card waits for the proof');
  assertEquals((r.update.context as { pr: PrRef }).pr.kind, 'revert_pr', 'the PR remembers what it was');
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

const failed = { ok: false, passed: 2, total: 3 };

Deno.test('a proven PR unlocks the merge and becomes the suggestion', () => {
  const r = afterProof({ actions: ['rollback'], context: { pr } }, { ok: true, passed: 3, total: 3 }, true, {
    ai: true,
    repo: true,
  });
  assertEquals(r.actions, ['rollback', 'merge_pr']);
  assertEquals(r.action, 'merge_pr');
});

Deno.test('a failed proof is not a dead end: the AI fix is offered again with the failures', () => {
  const r = afterProof({ actions: [], context: { pr: { ...pr, kind: 'fix_pr' } } }, failed, false, {
    ai: true,
    repo: true,
  });
  assertEquals(r.actions, ['fix_pr', 'revert_pr'], 'after an AI fix fails, a revert is still worth trying');
  assertEquals(r.action, 'fix_pr');
  assertEquals(r.reason, 'Proof failed: 2/3 pass. Try an AI fix with these failures.');
});

Deno.test('a failed revert is not offered again; without AI the card says what to do', () => {
  const revert = { actions: [], context: { pr: { ...pr, kind: 'revert_pr' } } };
  assertEquals(afterProof(revert, failed, false, { ai: true, repo: true }).actions, ['fix_pr']);
  const none = afterProof(revert, failed, false, { ai: false, repo: true });
  assertEquals(none.actions, []);
  assertEquals(none.reason, 'Proof failed: 2/3 pass. Push a fix to the PR; CI runs the proof again.');
});

Deno.test('a self-healed incident closes only when nothing ran and no PR waits', () => {
  assertEquals(selfHealed({}, 0), true);
  assertEquals(selfHealed({}, 1), false, 'a fix ran: that is a recovery, not a self-heal');
  assertEquals(selfHealed({ pr }, 0), false, 'the PR still needs its proof and merge');
});

Deno.test('one reported 500 is held; a second within a minute pages', () => {
  const now = Date.parse('2026-09-29T03:00:00Z');
  assertEquals(confirmsReport(null, now), false, 'first report: held, nobody paged');
  assertEquals(confirmsReport('2026-09-29T02:59:30Z', now), true, 'second within 60 s: an outage');
  assertEquals(confirmsReport('2026-09-29T02:58:00Z', now), false, 'a stray 500 two minutes ago is not a trend');
});

Deno.test('a reported incident closes itself only after 10 quiet minutes', () => {
  const now = Date.parse('2026-09-29T03:20:00Z');
  const recent = { replay: [{ at: '2026-09-29T03:15:00Z' }] }, quiet = { replay: [{ at: '2026-09-29T03:05:00Z' }] };
  assertEquals(selfHealed(recent, 0, true, now), false, 'still failing 5 minutes ago');
  assertEquals(selfHealed(quiet, 0, true, now), true);
  assertEquals(selfHealed(recent, 0, false, now), true, 'a health-check incident closes on the healthy check');
});

Deno.test('no code fixes are re-offered when there is nothing to replay', () => {
  const r = afterProof({ actions: [], context: { pr: { ...pr, kind: 'fix_pr' } } }, failed, false, {
    ai: true,
    repo: false,
  });
  assertEquals(r.actions, []);
});

Deno.test('an untouched incident pages the team once, after 5 minutes', () => {
  const t0 = Date.parse('2026-09-29T03:00:00Z');
  const inc = { created_at: '2026-09-29T03:00:00Z', status: 'active', context: {} };
  assertEquals(needsEscalation(inc, 0, t0 + 4 * 60_000), false, 'give the owner 5 minutes');
  assertEquals(needsEscalation(inc, 0, t0 + 5 * 60_000), true);
  assertEquals(needsEscalation(inc, 1, t0 + 9 * 60_000), false, 'someone is already on it');
  assertEquals(needsEscalation({ ...inc, context: { escalated_at: 'x' } }, 0, t0 + 9 * 60_000), false, 'only once');
  assertEquals(needsEscalation({ ...inc, status: 'resolved' }, 0, t0 + 9 * 60_000), false);
});

Deno.test('a fix still running after 5 minutes is handed back', () => {
  const t0 = Date.parse('2026-09-29T03:00:00Z');
  assertEquals(staleClaim('2026-09-29T03:00:00Z', t0 + 4 * 60_000), false, 'a slow fix is left alone');
  assertEquals(staleClaim('2026-09-29T03:00:00Z', t0 + 5 * 60_000), true);
  assertEquals(staleClaim(null, t0), true, 'claimed before claimed_at existed');
});

Deno.test('back up means the failing requests work: GETs re-checked on the service, nothing else', () => {
  const replay = [
    { method: 'GET', path: '/api/price' },
    { method: 'POST', path: '/checkout' }, // never replayed against production
    { method: 'GET', path: '/api/price' }, // once
    { method: 'GET', path: '//evil.test/x' }, // can't point the check at another host
  ];
  assertEquals(recoveryChecks(replay, 'http://34.1.2.3/health'), [{ method: 'GET', url: 'http://34.1.2.3/api/price' }]);
  assertEquals(recoveryChecks([{ method: 'POST', path: '/checkout' }], 'https://a.example.com/'), []);
  assertEquals(recoveryChecks(undefined, 'https://a.example.com/'), []);
});

Deno.test('a fix still failing 10 minutes later brings the card back, once', () => {
  const t0 = Date.parse('2026-09-29T19:00:00Z');
  assertEquals(stillFailing('2026-09-29T19:00:00Z', false, t0 + 9 * 60_000), false);
  assertEquals(stillFailing('2026-09-29T19:00:00Z', false, t0 + 10 * 60_000), true);
  assertEquals(stillFailing('2026-09-29T19:00:00Z', true, t0 + 30 * 60_000), false, 'only once');
});

Deno.test('an unanswered outage is paged again every 2 minutes, 5 pages in all, until someone acts or opens it', () => {
  const t0 = Date.parse('2026-09-30T03:00:00Z');
  const inc = (context: Record<string, unknown> = {}) => ({ created_at: '2026-09-30T03:00:00Z', context });
  assertEquals(needsRepage(inc(), 0, t0 + 60_000), false, 'not before 2 minutes');
  assertEquals(needsRepage(inc(), 0, t0 + 2 * 60_000), true, 'second page');
  assertEquals(needsRepage(inc({ pages: 2, paged_at: '2026-09-30T03:02:00Z' }), 0, t0 + 3 * 60_000), false);
  assertEquals(needsRepage(inc({ pages: 2, paged_at: '2026-09-30T03:02:00Z' }), 0, t0 + 4 * 60_000), true);
  assertEquals(
    needsRepage(inc({ pages: 5, paged_at: '2026-09-30T03:08:00Z' }), 0, t0 + 60 * 60_000),
    false,
    'stops at 5',
  );
  assertEquals(needsRepage(inc(), 1, t0 + 9 * 60_000), false, 'someone acted');
  assertEquals(needsRepage(inc({ acked_at: 'x' }), 0, t0 + 9 * 60_000), false, 'someone opened it');
});
