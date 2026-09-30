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

// Sets variables on the service; Railway redeploys it with them. Used to hand the app its report URL and secret, so
// there's nothing to copy (like the VM metadata on Google Cloud).
export async function setRailwayVariables(t: RailwayTarget, token: string, variables: Record<string, string>) {
  await gql(
    token,
    `mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`,
    { input: { projectId: t.projectId, environmentId: t.environmentId, serviceId: t.serviceId, variables } },
  );
}

// The ids come from the service's dashboard link, which users can copy from the browser:
// https://railway.com/project/<projectId>/service/<serviceId>?environmentId=<environmentId>
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export function idsFromLink(link: string) {
  const m = link.match(new RegExp(`/project/(${ID})/service/(${ID})`));
  const env = link.match(new RegExp(`environmentId=(${ID})`));
  return m && env ? { projectId: m[1], serviceId: m[2], environmentId: env[1] } : null;
}

// "Connect Railway" with OAuth: the user picks which projects OpsSwipe may use on Railway's consent screen
// (project:member), instead of pasting an account-wide token. offline_access + prompt=consent returns a
// refresh token. https://docs.railway.com/integrations/oauth/login-and-tokens
const OAUTH = 'https://backboard.railway.com/oauth';
const env = (k: string) => Deno.env.get(k) ?? '';
const redirectUri = () => `${env('SUPABASE_URL')}/functions/v1/oauth-callback`;

export const railwayOAuthEnabled = () => !!env('RAILWAY_CLIENT_ID') && !!env('RAILWAY_CLIENT_SECRET');

export const railwayAuthorizeUrl = (state: string) =>
  `${OAUTH}/auth?${new URLSearchParams({
    response_type: 'code',
    client_id: env('RAILWAY_CLIENT_ID'),
    redirect_uri: redirectUri(),
    scope: 'openid offline_access project:member',
    prompt: 'consent',
    state,
  })}`;

// What's kept in Vault for an OAuth connection. A pasted token is kept as the plain token instead.
export type RailwayGrant = { refresh: string; access: string; exp: number };
export const isGrant = (stored: string) => stored.startsWith('{');

async function tokenCall(params: Record<string, string>, now = Date.now()): Promise<RailwayGrant> {
  const res = await fetch(`${OAUTH}/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${env('RAILWAY_CLIENT_ID')}:${env('RAILWAY_CLIENT_SECRET')}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(10_000),
  });
  const t = await res.json().catch(() => ({}));
  if (!res.ok || !t.access_token) throw new Error(`railway oauth ${res.status}: ${t.error ?? 'no token'}`);
  return {
    refresh: t.refresh_token ?? params.refresh_token,
    access: t.access_token,
    exp: now + (t.expires_in ?? 3600) * 1000,
  };
}

export const exchangeRailway = (code: string) =>
  tokenCall({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });

// A usable access token from a stored grant: the cached one while it has a minute left, else a refresh. Railway
// rotates refresh tokens, so the caller must store the returned grant when it changed.
// ponytail: two refreshes at the same moment could race on a rotated token; one retry, or a lock, if that shows up.
export async function accessFromGrant(g: RailwayGrant, now = Date.now()) {
  if (g.exp - 60_000 > now) return { access: g.access, next: null };
  const next = await tokenCall({ grant_type: 'refresh_token', refresh_token: g.refresh }, now);
  return { access: next.access, next };
}

export type RailwayService = {
  projectId: string;
  project: string;
  serviceId: string;
  service: string;
  environments: { id: string; name: string }[];
};

// The projects the user shared on the consent screen, as project/service pairs with their environments. Railway's
// documented path: externalWorkspaces lists the shared projects (id, name); each project's services and environments
// come from project(id).
export async function listRailwayServices(token: string): Promise<RailwayService[]> {
  const w = await gql<{ externalWorkspaces: { projects: { id: string; name: string }[] }[] }>(
    token,
    `query { externalWorkspaces { projects { id name } } }`,
    {},
  );
  const projects = w.externalWorkspaces.flatMap((x) => x.projects).slice(0, 20);
  const details = await Promise.all(projects.map((p) =>
    gql<{
      project: {
        services: { edges: { node: { id: string; name: string } }[] };
        environments: { edges: { node: { id: string; name: string } }[] };
      };
    }>(
      token,
      `query($id: String!) { project(id: $id) { services { edges { node { id name } } } environments { edges { node { id name } } } } }`,
      { id: p.id },
    )
  ));
  return projects.flatMap((p, i) =>
    details[i].project.services.edges.map(({ node: s }) => ({
      projectId: p.id,
      project: p.name,
      serviceId: s.id,
      service: s.name,
      environments: details[i].project.environments.edges.map((e) => e.node),
    }))
  );
}
