// Railway: restart the live deployment or roll back to the previous good one, over the public GraphQL
// API with the user's token. https://docs.railway.com/integrations/api/manage-deployments
import type { RailwayTarget } from './targets.ts';

const API = 'https://backboard.railway.com/graphql/v2';

type Deployment = { id: string; status: string; createdAt: string };

async function gql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.errors?.length) {
    throw new Error(`railway ${res.status}: ${out.errors?.[0]?.message ?? 'request failed'}`);
  }
  return out.data as T;
}

export async function listDeployments(
  token: string,
  t: Pick<RailwayTarget, 'projectId' | 'serviceId' | 'environmentId'>,
) {
  const d = await gql<{ deployments: { edges: { node: Deployment }[] } }>(
    token,
    `query($input: DeploymentListInput!) { deployments(input: $input, first: 10) { edges { node { id status createdAt } } } }`,
    { input: { projectId: t.projectId, serviceId: t.serviceId, environmentId: t.environmentId } },
  );
  return d.deployments.edges.map((e) => e.node);
}

// Newest first. The live deployment is the newest SUCCESS; the rollback target the one before it.
export function pickDeployments(all: Deployment[]) {
  const ok = [...all].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .filter((d) => d.status === 'SUCCESS');
  return { live: ok.at(0), previous: ok.at(1) };
}

export async function restartRailway(t: RailwayTarget, token: string) {
  const { live } = pickDeployments(await listDeployments(token, t));
  if (!live) throw new Error('no live Railway deployment to restart');
  await gql(token, `mutation($id: String!) { deploymentRestart(id: $id) }`, { id: live.id });
  return 'restart issued';
}

export async function rollbackRailway(t: RailwayTarget, token: string) {
  const { previous } = pickDeployments(await listDeployments(token, t));
  if (!previous) throw new Error('no earlier successful Railway deployment to roll back to');
  await gql(token, `mutation($id: String!) { deploymentRollback(id: $id) }`, { id: previous.id });
  return `rolled back to deployment ${previous.id.slice(0, 8)}`;
}

// The ids come from the service's dashboard link, which users can copy from the browser:
// https://railway.com/project/<projectId>/service/<serviceId>?environmentId=<environmentId>
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export function idsFromLink(link: string) {
  const m = link.match(new RegExp(`/project/(${ID})/service/(${ID})`));
  const env = link.match(new RegExp(`environmentId=(${ID})`));
  return m && env ? { projectId: m[1], serviceId: m[2], environmentId: env[1] } : null;
}
