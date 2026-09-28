import { assert, assertEquals } from 'jsr:@std/assert@1';
import { hashToken, newToken, parseProposal, proposalStatus } from '../_shared/agents.ts';
import type { Action } from '../_shared/targets.ts';

const allowed = (name: string): Action[] | null =>
  name === 'web' ? ['restart', 'rollback', 'revert_pr', 'fix_pr', 'merge_pr'] : null;

Deno.test('agent tokens are random, prefixed, and stored only as a stable hash', async () => {
  const a = newToken();
  assert(a.startsWith('ops_') && a.length === 52 && a !== newToken());
  assertEquals(await hashToken(a), await hashToken(a));
  assert((await hashToken(a)) !== a, 'the token itself is never stored');
});

Deno.test('an agent may propose only fixes the service allows, never a merge, and must say why', () => {
  assertEquals(parseProposal({ service: 'web', action: 'rollback', reason: ' Bad deploy at 10:02. ' }, allowed), {
    service: 'web',
    action: 'rollback',
    reason: 'Bad deploy at 10:02.',
    symptom: 'Proposed by an AI agent',
  });
  assertEquals(parseProposal({ service: 'db', action: 'restart', reason: 'x' }, allowed), 'unknown service');
  assert(
    String(parseProposal({ service: 'web', action: 'merge_pr', reason: 'x' }, allowed)).startsWith('action must be'),
  );
  assert(String(parseProposal({ service: 'web', action: 'reset', reason: 'x' }, allowed)).startsWith('action must be'));
  assert(String(parseProposal({ service: 'web', action: 'restart' }, allowed)).startsWith('reason is required'));
  assert(String(parseProposal(null, allowed)) === 'unknown service');
});

Deno.test('proposal status tells the agent what the human did', () => {
  const open = { status: 'active', context: {} };
  assertEquals(proposalStatus(open, null), { status: 'pending' });
  assertEquals(proposalStatus({ status: 'resolving', context: {} }, null), { status: 'running' });
  assertEquals(
    proposalStatus(open, { outcome: 'paywalled', detail: null }),
    { status: 'pending' },
    'waiting on an upgrade',
  );
  assertEquals(proposalStatus(open, { outcome: 'failed', detail: 'boom' }), { status: 'failed', detail: 'boom' });
  assertEquals(proposalStatus({ status: 'resolved', context: {} }, { outcome: 'executed', detail: 'restart issued' }), {
    status: 'approved',
    detail: 'restart issued',
    pr: undefined,
  });
  assertEquals(proposalStatus({ status: 'resolved', context: { declined: true } }, null), { status: 'declined' });
});
