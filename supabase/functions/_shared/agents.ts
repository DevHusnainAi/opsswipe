// Approval API: any AI agent (an AI SRE, a script, CI) can propose a fix; a human approves it on
// their phone with a swipe and a fingerprint, and the agent polls for the outcome. The agent can
// only propose fixes the service already allows; it never runs anything itself.
import type { Action } from './targets.ts';

export const newToken = () =>
  `ops_${Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('')}`;

// Only this hash is stored, so a database leak can't be used to call the API.
export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type Proposal = { service: string; action: Action; reason: string; symptom: string };

// What an agent may ask for: a fix the service allows, except merging (that needs CI proof first).
export function parseProposal(raw: unknown, allowed: (service: string) => Action[] | null): Proposal | string {
  const b = (raw ?? {}) as Record<string, unknown>;
  const service = typeof b.service === 'string' ? b.service : '';
  const actions = allowed(service);
  if (!actions) return 'unknown service';
  const action = b.action as Action;
  if (action === 'merge_pr' || !actions.includes(action)) {
    return `action must be one of: ${actions.filter((a) => a !== 'merge_pr').join(', ')}`;
  }
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (!reason || reason.length > 300) {
    return 'reason is required (up to 300 characters): the human reads it before approving';
  }
  const symptom = typeof b.symptom === 'string' && b.symptom.trim()
    ? b.symptom.trim().slice(0, 200)
    : 'Proposed by an AI agent';
  return { service, action, reason, symptom };
}

type Inc = { status: string; context: { declined?: boolean; pr?: { url: string } } };
type Audit = { outcome: string; detail: string | null };

// pending: waiting for the human · running: being executed · approved: executed (detail/PR) ·
// declined: the human said no · failed: approved but the fix failed (the card stays for a retry).
export function proposalStatus(inc: Inc, latest: Audit | null) {
  if (inc.context.declined) return { status: 'declined' as const };
  if (latest?.outcome === 'executed') {
    return { status: 'approved' as const, detail: latest.detail, pr: inc.context.pr?.url };
  }
  if (latest?.outcome === 'failed' && inc.status === 'active') {
    return { status: 'failed' as const, detail: latest.detail };
  }
  return { status: inc.status === 'resolving' ? ('running' as const) : ('pending' as const) };
}
