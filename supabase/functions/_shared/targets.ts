// What a connected service is and which fixes it allows. Services are stored per user
// (table `services`); this module validates their config and maps them to targets.
export type GcpTarget = { provider: 'gcp'; project: string; zone: string; instance: string; url: string };
export type RenderTarget = {
  provider: 'render';
  serviceId: string;
  url: string;
  repo?: string; // "owner/name" the service deploys from; enables revert and merge PRs
  branch?: string; // defaults to main
};
export type Target = GcpTarget | RenderTarget;
export type Action = 'reset' | 'restart' | 'rollback' | 'revert_pr' | 'merge_pr';

export function actionsFor(t: Target): Action[] {
  if (t.provider === 'gcp') return ['reset'];
  return t.repo ? ['restart', 'rollback', 'revert_pr', 'merge_pr'] : ['restart', 'rollback'];
}

const REQUIRED = { gcp: ['project', 'zone', 'instance', 'url'], render: ['serviceId', 'url'] } as const;
// Tight formats: these values end up in cloud API URLs.
const FORMAT: Record<string, RegExp> = {
  project: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/,
  zone: /^[a-z]+-[a-z]+\d+-[a-z]$/,
  instance: /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/,
  serviceId: /^srv-[a-z0-9]+$/,
  url: /^https?:\/\/[^\s]+$/,
  repo: /^[\w.-]+\/[\w.-]+$/,
  branch: /^[\w./-]{1,100}$/,
};

export function validateTarget(provider: string, config: Record<string, unknown>): Target {
  const fields = REQUIRED[provider as keyof typeof REQUIRED];
  if (!fields) throw new Error(`unknown provider ${provider}`);
  for (const f of fields) {
    if (typeof config[f] !== 'string' || !config[f]) throw new Error(`missing ${f}`);
  }
  for (const [k, v] of Object.entries(config)) {
    if (v !== undefined && FORMAT[k] && !FORMAT[k].test(String(v))) throw new Error(`invalid ${k}`);
  }
  return { provider, ...config } as Target;
}
