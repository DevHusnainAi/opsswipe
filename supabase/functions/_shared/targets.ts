// The remediation allowlist. Only servers named in the TARGETS secret can ever be touched,
// and only with the fixes listed for their provider. The phone never supplies any of this.
export type GcpTarget = { provider: 'gcp'; project: string; zone: string; instance: string; url: string };
export type RenderTarget = {
  provider: 'render';
  serviceId: string;
  url: string;
  repo?: string; // "owner/name" the service deploys from; enables revert PRs
  branch?: string; // defaults to main
};
export type Target = GcpTarget | RenderTarget;
export type Action = 'reset' | 'restart' | 'rollback' | 'revert_pr' | 'merge_pr';

export function actionsFor(t: Target): Action[] {
  if (t.provider === 'gcp') return ['reset'];
  return t.repo ? ['restart', 'rollback', 'revert_pr', 'merge_pr'] : ['restart', 'rollback'];
}

const REQUIRED = { gcp: ['project', 'zone', 'instance', 'url'], render: ['serviceId', 'url'] } as const;

export function parseTargets(raw: string): Record<string, Target> {
  const parsed = JSON.parse(raw || '{}');
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('TARGETS must be a JSON object of name -> target');
  }
  for (const [name, t] of Object.entries<Record<string, unknown>>(parsed)) {
    const fields = REQUIRED[t?.provider as keyof typeof REQUIRED];
    if (!fields) throw new Error(`target ${name}: unknown provider ${String(t?.provider)}`);
    for (const f of fields) {
      if (typeof t[f] !== 'string' || !t[f]) throw new Error(`target ${name}: missing ${f}`);
    }
    if (t.repo !== undefined && !/^[\w.-]+\/[\w.-]+$/.test(String(t.repo))) {
      throw new Error(`target ${name}: repo must be "owner/name"`);
    }
  }
  return parsed;
}
