// Render: restart a service, or roll it back to its previous good deploy.
// https://api-docs.render.com/reference/restart-service · rollback-deploy · list-deploys
const API = 'https://api.render.com/v1';

export type Deploy = {
  id: string;
  status: string;
  createdAt: string;
  finishedAt?: string;
  commit?: { id: string; message?: string };
};

async function call(path: string, apiKey: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`render ${path.split('/').at(-1)} ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

export async function restartService(serviceId: string, apiKey: string) {
  await call(`/services/${serviceId}/restart`, apiKey, { method: 'POST' });
}

export async function listDeploys(serviceId: string, apiKey: string): Promise<Deploy[]> {
  const rows = await call(`/services/${serviceId}/deploys?limit=10`, apiKey);
  return (rows ?? []).map((r: { deploy: Deploy }) => r.deploy);
}

// Newest first (as Render returns them): the live deploy, and the most recent one that
// was live before it. A failed build was never live, so it can't be a rollback target.
export function pickRollback(deploys: Deploy[]) {
  const liveIdx = deploys.findIndex((d) => d.status === 'live');
  if (liveIdx === -1) return { live: undefined, previous: undefined };
  return { live: deploys[liveIdx], previous: deploys.slice(liveIdx + 1).find((d) => d.status === 'deactivated') };
}

export async function rollbackToPrevious(serviceId: string, apiKey: string) {
  const { live, previous } = pickRollback(await listDeploys(serviceId, apiKey));
  if (!previous) throw new Error('no previous good deploy to roll back to');
  await call(`/services/${serviceId}/rollback`, apiKey, {
    method: 'POST',
    body: JSON.stringify({ deployId: previous.id }),
  });
  return `rolled back ${live?.commit?.id?.slice(0, 7) ?? live?.id} -> ${
    previous.commit?.id?.slice(0, 7) ?? previous.id
  }`;
}

// Connect: the user's web services, and one service's details (for its URL, repo and branch).
export type RenderService = { id: string; name: string; url: string; repo?: string; branch?: string };

type RawService = {
  id: string;
  name: string;
  type: string;
  repo?: string;
  branch?: string;
  serviceDetails?: { url?: string };
};

// "https://github.com/owner/name(.git)" -> "owner/name"; other hosts aren't supported for PRs.
export const githubRepo = (url?: string) =>
  /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(\.git)?\/?$/.exec(url ?? '')?.[1];

const toRenderService = (s: RawService): RenderService => ({
  id: s.id,
  name: s.name,
  url: s.serviceDetails?.url ?? '',
  repo: githubRepo(s.repo),
  branch: s.branch,
});

export async function listServices(apiKey: string): Promise<RenderService[]> {
  const rows = await call('/services?limit=100&type=web_service', apiKey);
  return (rows ?? []).map((r: { service: RawService }) => toRenderService(r.service));
}

export async function getRenderService(serviceId: string, apiKey: string): Promise<RenderService> {
  return toRenderService(await call(`/services/${serviceId}`, apiKey));
}
