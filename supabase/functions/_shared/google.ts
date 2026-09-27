// "Connect Google Cloud": the user signs in with Google once, picks a VM, and OpsSwipe uses that
// short-lived token to grant its OWN service account a reset-only role on that one VM. The user's
// token is then deleted; from then on OpsSwipe acts only as itself (see gcp.ts).
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

// access_type=online: no refresh token is ever issued, so nothing long-lived exists to leak.
export const consentUrl = (state: string) =>
  `${AUTH_URL}?${new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'online',
    prompt: 'select_account consent',
    state,
  })}`;

export async function exchangeCode(code: string) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new GoogleError('Google sign-in expired or was cancelled. Try again.');
  const { access_token, id_token } = await res.json();
  // The id_token came straight from Google over TLS, so its claims can be read without re-verifying.
  const claims = id_token ? JSON.parse(new TextDecoder().decode(b64urlDecode(id_token.split('.')[1]))) : {};
  return { token: access_token as string, email: (claims.email as string) ?? null };
}

async function call(token: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
  });
  if (res.ok) return res.json();
  const text = await res.text();
  if (res.status === 401) throw new GoogleError('Your Google sign-in expired. Connect Google Cloud again.');
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
