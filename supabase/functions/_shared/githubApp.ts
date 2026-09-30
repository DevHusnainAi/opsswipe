// The OpsSwipe GitHub App: users install it on the repos they choose; we act with 1-hour
// installation tokens. Installation ids from the redirect can be spoofed, so we only accept one
// after proving, with the installing user's own OAuth token, that the installation is theirs.
// https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app
import { env } from './db.ts';
import { signRs256 } from './jwt.ts';

const API = 'https://api.github.com';
const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

export const appJwt = (now = Math.floor(Date.now() / 1000)) =>
  signRs256({ iat: now - 60, exp: now + 9 * 60, iss: env('GITHUB_APP_ID') }, env('GITHUB_APP_PRIVATE_KEY'));

export const installUrl = () => `https://github.com/apps/${env('GITHUB_APP_SLUG')}/installations/new`;

// Connect starts here, not at the install page: authorizing always returns a code, while the install
// page returns none when the app is already installed. The callback then finds the installation, or
// sends the browser on to install it.
export const authorizeUrl = (state: string) =>
  `https://github.com/login/oauth/authorize?${new URLSearchParams({
    client_id: env('GITHUB_APP_CLIENT_ID'),
    redirect_uri: `${env('SUPABASE_URL')}/functions/v1/oauth-callback`,
    state,
  })}`;

const cache = new Map<number, { token: string; expiresAt: number }>();

export async function installationToken(installationId: number) {
  const hit = cache.get(installationId);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const res = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: headers(await appJwt()),
  });
  if (!res.ok) throw new Error(`github installation token ${res.status}: ${await res.text()}`);
  const { token, expires_at } = await res.json();
  cache.set(installationId, { token, expiresAt: Date.parse(expires_at) });
  return token as string;
}

// Exchange the one-time OAuth code, then find the installation that belongs to that GitHub user: the
// one named in the redirect (after a fresh install), else the one on their own account, else any they
// can reach. Returns the GitHub login, and the installation id, or null when there is none yet.
export async function findInstallation(code: string, installationId?: number) {
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env('GITHUB_APP_CLIENT_ID'),
      client_secret: env('GITHUB_APP_CLIENT_SECRET'),
      code,
    }),
  });
  const { access_token: userToken, error } = await tokenRes.json();
  if (!userToken) throw new Error(`github oauth: ${error ?? tokenRes.status}`);

  const [me, installs] = await Promise.all([
    fetch(`${API}/user`, { headers: headers(userToken) }).then((r) => r.json()),
    fetch(`${API}/user/installations`, { headers: headers(userToken) }).then((r) => r.json()),
  ]);
  const mine = (installs.installations ?? []) as { id: number; account?: { login?: string } }[];
  if (installationId && !mine.some((i) => i.id === installationId)) {
    throw new Error('that GitHub installation does not belong to you');
  }
  const found = installationId ?? (mine.find((i) => i.account?.login === me.login) ?? mine.at(0))?.id ?? null;
  return { login: me.login as string, installationId: found };
}

// The install redirect names its installation: it must be one the user can reach.
export async function verifyInstallation(code: string, installationId: number): Promise<string> {
  return (await findInstallation(code, installationId)).login;
}

export type RepoOption = { name: string; branch: string };

// The repos this installation can reach, with each one's default branch.
export async function listRepos(installationId: number): Promise<RepoOption[]> {
  const res = await fetch(`${API}/installation/repositories?per_page=100`, {
    headers: headers(await installationToken(installationId)),
  });
  if (!res.ok) throw new Error(`github repos ${res.status}`);
  return (await res.json()).repositories.map((r: { full_name: string; default_branch: string }) => ({
    name: r.full_name,
    branch: r.default_branch,
  }));
}
