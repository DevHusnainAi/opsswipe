// What a connected service is and which fixes it allows. Services are stored per user
// (table `services`); this module validates their config and maps them to targets.
// Any service can be linked to the GitHub repo it deploys from ("owner/name" + branch). That
// enables the code fixes: revert PR, AI fix PR, and merging a PR once CI proves it.
type Linked = { repo?: string; branch?: string };
export type GcpTarget = { provider: 'gcp'; project: string; zone: string; instance: string; url: string } & Linked;
export type RenderTarget = { provider: 'render'; serviceId: string; url: string } & Linked;
export type Target = GcpTarget | RenderTarget;
export type Action = 'reset' | 'restart' | 'rollback' | 'revert_pr' | 'fix_pr' | 'merge_pr';

export const CODE_FIXES: Action[] = ['revert_pr', 'fix_pr'];

export function actionsFor(t: Target): Action[] {
  const code: Action[] = t.repo ? ['revert_pr', 'fix_pr', 'merge_pr'] : [];
  return t.provider === 'gcp' ? ['reset', ...code] : ['restart', 'rollback', ...code];
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
