// Revert PRs that carry their own proof, and merges pinned to the proven commit.
// Git Data API, no clone. A commit whose tree is the parent's tree is an exact revert when the bad
// commit is the branch head; if someone pushed on top of it, we refuse rather than guess.
// https://docs.github.com/en/rest/git · https://docs.github.com/en/rest/pulls
import type { PrRef } from './proof.ts';
import type { ReplaySample } from './replay.ts';

const API = 'https://api.github.com';

export type RevertInput = { repo: string; branch: string; commitSha: string; body: string; replay: ReplaySample[] };

// A branch or ref inside a URL: encoded, keeping the slashes of names like "feature/x".
const refPath = (r: string) => encodeURIComponent(r).replace(/%2F/g, '/');

async function gh(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`${API}/repos/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const err = new Error(`github ${init.method ?? 'GET'} ${path} ${res.status}: ${await res.text()}`);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  return res.json();
}

export async function openRevertPr(
  { repo, branch, commitSha, body, replay }: RevertInput,
  token: string,
): Promise<PrRef> {
  const head = await gh(`${repo}/git/ref/heads/${refPath(branch)}`, token);
  if (head.object.sha !== commitSha) {
    throw new Error(`${commitSha.slice(0, 7)} is no longer the head of ${branch}; revert it by hand`);
  }
  const bad = await gh(`${repo}/git/commits/${commitSha}`, token);
  const parent = await gh(`${repo}/git/commits/${bad.parents[0].sha}`, token);
  const short = commitSha.slice(0, 7);

  // The parent's tree (the revert) plus the failing production requests, kept in the repo as a
  // permanent regression fixture that CI replays on every PR from now on.
  const tree = await gh(`${repo}/git/trees`, token, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: parent.tree.sha,
      tree: [{
        path: `.opsswipe/replays/${short}.json`,
        mode: '100644',
        type: 'blob',
        content: `${JSON.stringify({ reverts: commitSha, samples: replay }, null, 2)}\n`,
      }],
    }),
  });
  const firstLine = String(bad.message).split('\n')[0];
  const revert = await gh(`${repo}/git/commits`, token, {
    method: 'POST',
    body: JSON.stringify({
      message:
        `Revert "${firstLine}"\n\nThis reverts commit ${commitSha}.\nAdds the failing production requests as a replay test.\nOpened by OpsSwipe.`,
      tree: tree.sha,
      parents: [commitSha],
    }),
  });
  const branchName = `opsswipe/revert-${short}`;
  await upsertRef(repo, branchName, revert.sha, token);
  const pr = await openPull(
    repo,
    { title: `Revert "${firstLine}"`, head: branchName, base: branch, body },
    token,
  );
  return { repo, number: pr.number, headSha: revert.sha, url: pr.html_url, branch: branchName };
}

// Merge only the commit CI proved: GitHub returns 409 if the head moved since.
export async function mergePr(pr: PrRef, token: string) {
  try {
    await gh(`${pr.repo}/pulls/${pr.number}/merge`, token, {
      method: 'PUT',
      body: JSON.stringify({ sha: pr.headSha, merge_method: 'squash' }),
    });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 409) throw new Error('the PR changed after it was proven; re-run the proof');
    if (status === 405) throw new Error('GitHub says the PR is not mergeable (conflicts or branch rules)');
    throw e;
  }
  return `merged #${pr.number}`;
}

export async function commitMessage(repo: string, sha: string, token: string): Promise<string> {
  return String((await gh(`${repo}/git/commits/${sha}`, token)).message);
}

// The commit a branch points at now.
export async function branchHead(repo: string, branch: string, token: string): Promise<string> {
  return (await gh(`${repo}/git/ref/heads/${refPath(branch)}`, token)).object.sha;
}

export type ChangedFile = { path: string; patch: string; content: string | null };

// A file's text on a branch, or null when it's missing or bigger than `max` bytes.
export async function fileText(repo: string, path: string, ref: string, token: string, max = 40_000) {
  const c = await gh(
    `${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(ref)}`,
    token,
  )
    .catch(() => null);
  if (!c?.content || c.size > max) return null;
  return new TextDecoder().decode(Uint8Array.from(atob(c.content.replace(/\n/g, '')), (ch) => ch.charCodeAt(0)));
}

// What a commit changed (its diff per file) and each file's content now on the branch, for the AI
// fix. Capped so the prompt stays small: at most 5 files, 40 KB each; removed files have no content.
export async function commitFiles(repo: string, sha: string, branch: string, token: string): Promise<ChangedFile[]> {
  const commit = await gh(`${repo}/commits/${sha}`, token);
  const files = (commit.files ?? []).slice(0, 5) as { filename: string; patch?: string; status: string }[];
  return await Promise.all(files.map(async (f) => ({
    path: f.filename,
    patch: (f.patch ?? '').slice(0, 20_000),
    content: f.status === 'removed' ? null : await fileText(repo, f.filename, branch, token),
  })));
}

export const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

// One of the repo's own tests, so the AI's regression test follows the same style and runner.
export async function testExample(repo: string, branch: string, token: string) {
  const tree = await gh(`${repo}/git/trees/${refPath(branch)}?recursive=1`, token).catch(() => null);
  const path = (tree?.tree ?? []).map((e: { path: string; type: string }) => e.type === 'blob' ? e.path : '')
    .find((p: string) => TEST_FILE.test(p) && !p.includes('node_modules/'));
  const content = path ? await fileText(repo, path, branch, token, 20_000) : null;
  return path && content ? { path, content } : null;
}

// The commit a PR's branch points at right now, from GitHub itself (not from what CI says it tested).
export async function prHead(pr: PrRef, token: string): Promise<string> {
  return (await gh(`${pr.repo}/pulls/${pr.number}`, token)).head.sha;
}

// Is this a real branch of the repo? Checked when a branch is linked, so a typo fails at setup.
export async function branchExists(repo: string, branch: string, token: string) {
  return await gh(`${repo}/branches/${refPath(branch)}`, token).then(() => true, () => false);
}

export type PrFile = { file: string; status: string; additions: number; deletions: number; patch: string };

// A PR's diff, for reading it on the phone before merging. Capped at 20 KB of patch in total.
export async function prFiles(pr: PrRef, token: string): Promise<PrFile[]> {
  const files = await gh(`${pr.repo}/pulls/${pr.number}/files?per_page=30`, token) as {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }[];
  let budget = 20_000;
  return files.map((f) => {
    const patch = (f.patch ?? '').slice(0, Math.max(budget, 0));
    budget -= patch.length;
    return { file: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch };
  });
}

// Point a branch at a commit: create the ref, or move the one an earlier attempt left behind
// (GitHub 422s "Reference already exists" on a second create).
async function upsertRef(repo: string, branchName: string, sha: string, token: string) {
  try {
    await gh(`${repo}/git/refs`, token, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
    });
  } catch (e) {
    if ((e as { status?: number }).status !== 422) throw e;
    await gh(`${repo}/git/refs/heads/${branchName}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ sha, force: true }),
    });
  }
}

// Open the PR, or hand back the one that head branch already has open (a retry after a failed run).
async function openPull(
  repo: string,
  { title, head, base, body }: { title: string; head: string; base: string; body: string },
  token: string,
) {
  try {
    return await gh(`${repo}/pulls`, token, {
      method: 'POST',
      body: JSON.stringify({ title, head, base, body }),
    }) as { number: number; html_url: string };
  } catch (e) {
    if ((e as { status?: number }).status !== 422) throw e;
    const open = await gh(`${repo}/pulls?state=open&head=${repo.split('/')[0]}:${head}`, token) as {
      number: number;
      html_url: string;
    }[];
    if (open[0]) return open[0];
    throw e;
  }
}

// Open a PR that adds or changes files on top of the branch head (the proof workflow, an AI fix).
// The user reviews and merges; with a replay file in it, merging is gated on CI proof.
export async function openFilesPr(
  { repo, branch, branchName, title, body, files }: {
    repo: string;
    branch: string;
    branchName: string;
    title: string;
    body: string;
    files: { path: string; content: string }[];
  },
  token: string,
): Promise<PrRef> {
  const head = await gh(`${repo}/git/ref/heads/${refPath(branch)}`, token);
  const base = await gh(`${repo}/git/commits/${head.object.sha}`, token);
  const tree = await gh(`${repo}/git/trees`, token, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: base.tree.sha,
      tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
    }),
  });
  const commit = await gh(`${repo}/git/commits`, token, {
    method: 'POST',
    body: JSON.stringify({ message: title, tree: tree.sha, parents: [head.object.sha] }),
  });
  await upsertRef(repo, branchName, commit.sha, token);
  const pr = await openPull(repo, { title, head: branchName, base: branch, body }, token);
  return { repo, number: pr.number, headSha: commit.sha, url: pr.html_url, branch: branchName };
}
