// GCP Compute: reset one VM using a service-account key. Zero dependencies:
// sign an RS256 JWT with WebCrypto, swap it for an access token, call instances.reset.
// https://developers.google.com/identity/protocols/oauth2/service-account
import type { GcpTarget } from './targets.ts';

export type ServiceAccount = { client_email: string; private_key: string; project_id?: string };

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// cloud-platform covers both Compute (reset) and Vertex AI (suggestions); IAM decides what's allowed.
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const text = (s: string) => new TextEncoder().encode(s);

export async function signJwt(sa: ServiceAccount, now = Math.floor(Date.now() / 1000)) {
  const header = b64url(text(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(
    text(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })),
  );
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, text(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(new Uint8Array(sig))}`;
}

// ponytail: one cached token for the one service account we use; key the cache by email if that changes.
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

export async function resetInstance(t: GcpTarget, sa: ServiceAccount) {
  const url =
    `https://compute.googleapis.com/compute/v1/projects/${t.project}/zones/${t.zone}/instances/${t.instance}/reset`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${await accessToken(sa)}` } });
  if (!res.ok) throw new Error(`gcp reset ${res.status}: ${await res.text()}`);
}
