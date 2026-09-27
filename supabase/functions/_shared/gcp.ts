// GCP Compute with OpsSwipe's own platform service account. Users never hand over keys:
// they grant this identity a custom role (reset + get) on one VM, and can revoke it anytime.
// https://developers.google.com/identity/protocols/oauth2/service-account
import { signRs256 } from './jwt.ts';

export type ServiceAccount = { client_email: string; private_key: string; project_id?: string };
export type GcpVm = { project: string; zone: string; instance: string };

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// cloud-platform covers Compute (reset) and Vertex AI (suggestions); IAM decides what's allowed.
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

export const signJwt = (sa: ServiceAccount, now = Math.floor(Date.now() / 1000)) =>
  signRs256({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }, sa.private_key);

// ponytail: one cached token for the one platform service account.
let cached: { token: string; expiresAt: number } | undefined;

export async function accessToken(sa: ServiceAccount) {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: await signJwt(sa),
    }),
  });
  if (!res.ok) throw new Error(`gcp token ${res.status}: ${await res.text()}`);
  const { access_token, expires_in } = await res.json();
  cached = { token: access_token, expiresAt: Date.now() + expires_in * 1000 };
  return access_token as string;
}

const vmUrl = (t: GcpVm) =>
  `https://compute.googleapis.com/compute/v1/projects/${t.project}/zones/${t.zone}/instances/${t.instance}`;

export async function resetInstance(t: GcpVm, sa: ServiceAccount) {
  const res = await fetch(`${vmUrl(t)}/reset`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken(sa)}` },
  });
  if (!res.ok) throw new Error(`gcp reset ${res.status}: ${await res.text()}`);
}

// "Verify access": proves the user granted our identity the role on this exact VM.
export async function getInstanceStatus(t: GcpVm, sa: ServiceAccount): Promise<string> {
  const res = await fetch(vmUrl(t), { headers: { Authorization: `Bearer ${await accessToken(sa)}` } });
  if (res.status === 403 || res.status === 404) {
    throw new Error(`OpsSwipe can't see ${t.instance} yet. Run the two commands, then try again.`);
  }
  if (!res.ok) throw new Error(`gcp get ${res.status}: ${await res.text()}`);
  return (await res.json()).status as string;
}
