// "Connect Google Cloud": the user signs in with Google once. OpsSwipe keeps the refresh token
// (encrypted in Vault) so the user can browse projects and add VMs later without signing in again,
// and uses it only to grant its OWN service account a reset-only role on each chosen VM. Resets
// always run as OpsSwipe's identity (see gcp.ts). Disconnect revokes the token at Google.
// https://developers.google.com/identity/protocols/oauth2/web-server
// https://docs.cloud.google.com/compute/docs/reference/rest/v1/instances/setIamPolicy
import { type GcpVm, vmUrl } from './gcp.ts';
import { b64urlDecode } from './jwt.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = 'openid email https://www.googleapis.com/auth/cloud-platform';
export const ROLE_ID = 'opsswipeReset';
export const ROLE_PERMISSIONS = ['compute.instances.reset', 'compute.instances.get'];

export class GoogleError extends Error {}

const redirectUri = () => `${env('SUPABASE_URL')}/functions/v1/oauth-callback`;

// access_type=offline + prompt=consent: Google always returns a refresh token, so the connection lasts.
export const consentUrl = (state: string) =>
  `${AUTH_URL}?${new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'select_account consent',
    state,
  })}`;

async function tokenRequest(params: Record<string, string>) {
  return await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      ...params,
    }),
  });
}

export async function exchangeCode(code: string) {
  const res = await tokenRequest({ code, redirect_uri: redirectUri(), grant_type: 'authorization_code' });
  if (!res.ok) throw new GoogleError('Google sign-in expired or was cancelled. Try again.');
  const { access_token, refresh_token, id_token } = await res.json();
  if (!refresh_token) throw new GoogleError('Google did not grant lasting access. Connect Google Cloud again.');
  // The id_token came straight from Google over TLS, so its claims can be read without re-verifying.
  const claims = id_token ? JSON.parse(new TextDecoder().decode(b64urlDecode(id_token.split('.')[1]))) : {};
  return { access: access_token as string, refresh: refresh_token as string, email: (claims.email as string) ?? null };
}

// A fresh 1-hour access token from the stored refresh token.
export async function accessFromRefresh(refresh: string) {
  const res = await tokenRequest({ refresh_token: refresh, grant_type: 'refresh_token' });
  if (!res.ok) throw new GoogleError('Google access was removed. Connect Google Cloud again.');
  return (await res.json()).access_token as string;
}

// Best effort: Disconnect should also end the access at Google, not just forget our copy.
export async function revoke(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' })
    .catch(() => {});
}

async function call(token: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
  });
  if (res.ok) return res.json();
  const text = await res.text();
  if (res.status === 401) throw new GoogleError('Google access was removed. Connect Google Cloud again.');
  if (text.includes('SERVICE_DISABLED') || text.includes('has not been used')) {
    const api = url.includes('iam.googleapis')
      ? 'IAM'
      : url.includes('cloudresourcemanager')
      ? 'Resource Manager'
      : 'Compute Engine';
    throw new GoogleError(`Turn on the ${api} API in this project, then try again.`);
  }
  if (res.status === 403) {
    throw new GoogleError('Your Google account needs Owner (or permission to manage IAM) on this project.');
  }
  throw Object.assign(new Error(`google ${res.status}: ${text.slice(0, 300)}`), { status: res.status });
}

export async function listProjects(token: string) {
  const r = await call(token, 'https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState:ACTIVE');
  return ((r.projects ?? []) as { projectId: string; name: string }[]).map((p) => ({ id: p.projectId, name: p.name }));
}

export type VmOption = { name: string; zone: string; status: string; ip: string | null };

export async function listVms(token: string, project: string): Promise<VmOption[]> {
  const r = await call(
    token,
    `https://compute.googleapis.com/compute/v1/projects/${project}/aggregated/instances?returnPartialSuccess=true`,
  );
  // deno-lint-ignore no-explicit-any
  return Object.values(r.items ?? {}).flatMap((z: any) => z.instances ?? []).map((i: any) => ({
    name: i.name,
    zone: String(i.zone).split('/').pop()!,
    status: i.status,
    ip: i.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP ?? null,
  }));
}

type Binding = { role: string; members: string[]; condition?: unknown };
export type Policy = { bindings?: Binding[]; etag?: string; version?: number };

// Adds member to role (unconditional binding), leaving every other binding untouched. Idempotent.
export function withBinding(policy: Policy, role: string, member: string): Policy {
  const bindings = (policy.bindings ?? []).map((b) => ({ ...b, members: [...b.members] }));
  const b = bindings.find((x) => x.role === role && !x.condition);
  if (!b) bindings.push({ role, members: [member] });
  else if (!b.members.includes(member)) b.members.push(member);
  return { ...policy, bindings };
}

// The same two steps the gcloud commands did: create the custom role, bind our identity on one VM.
export async function grantReset(token: string, vm: GcpVm, serviceAccountEmail: string) {
  try {
    await call(token, `https://iam.googleapis.com/v1/projects/${vm.project}/roles`, {
      method: 'POST',
      body: JSON.stringify({
        roleId: ROLE_ID,
        role: { title: 'OpsSwipe reset', includedPermissions: ROLE_PERMISSIONS, stage: 'GA' },
      }),
    });
  } catch (e) {
    if ((e as { status?: number }).status !== 409) throw e; // 409: the role already exists
    // It may exist only as deleted (revokeReset removes it; Google keeps it 7 days). Undelete is a
    // no-op error on a live role.
    await call(token, `https://iam.googleapis.com/v1/projects/${vm.project}/roles/${ROLE_ID}:undelete`, {
      method: 'POST',
      body: '{}',
    }).catch(() => {});
  }
  const policy = await call(token, `${vmUrl(vm)}/getIamPolicy?optionsRequestedPolicyVersion=3`);
  // The etag in the policy makes this fail rather than overwrite a concurrent change.
  await call(token, `${vmUrl(vm)}/setIamPolicy`, {
    method: 'POST',
    body: JSON.stringify({
      policy: withBinding(policy, `projects/${vm.project}/roles/${ROLE_ID}`, `serviceAccount:${serviceAccountEmail}`),
    }),
  });
}

// The reverse of withBinding: our member leaves the role; a binding left empty goes too.
export function withoutBinding(policy: Policy, role: string, member: string): Policy {
  const bindings = (policy.bindings ?? [])
    .map((b) => (b.role === role && !b.condition ? { ...b, members: b.members.filter((m) => m !== member) } : b))
    .filter((b) => b.members.length > 0);
  return { ...policy, bindings };
}

// Removing a VM (or Google, or the account) takes OpsSwipe's reset right away at Google, not just in
// our database. The custom role goes when it's the project's last OpsSwipe VM.
export async function revokeReset(token: string, vm: GcpVm, serviceAccountEmail: string, lastInProject: boolean) {
  const policy = await call(token, `${vmUrl(vm)}/getIamPolicy?optionsRequestedPolicyVersion=3`);
  await call(token, `${vmUrl(vm)}/setIamPolicy`, {
    method: 'POST',
    body: JSON.stringify({
      policy: withoutBinding(
        policy,
        `projects/${vm.project}/roles/${ROLE_ID}`,
        `serviceAccount:${serviceAccountEmail}`,
      ),
    }),
  });
  if (lastInProject) {
    await call(token, `https://iam.googleapis.com/v1/projects/${vm.project}/roles/${ROLE_ID}`, { method: 'DELETE' });
  }
}

// Checked before every reset: the owner's own Google account must still be able to manage this VM.
// OpsSwipe's reset identity is shared, so this is what ties each reset to someone who controls the VM,
// and losing access in Google Cloud stops OpsSwipe resets the same minute.
export async function canManage(token: string, vm: GcpVm) {
  const permission = 'compute.instances.setIamPolicy';
  const r = await call(token, `${vmUrl(vm)}/testIamPermissions`, {
    method: 'POST',
    body: JSON.stringify({ permissions: [permission] }),
  });
  return ((r.permissions ?? []) as string[]).includes(permission);
}
