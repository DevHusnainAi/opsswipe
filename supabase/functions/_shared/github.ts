// Revert PRs that carry their own proof, and merges pinned to the proven commit.
// Git Data API, no clone. A commit whose tree is the parent's tree is an exact revert when the bad
// commit is the branch head; if someone pushed on top of it, we refuse rather than guess.
// https://docs.github.com/en/rest/git · https://docs.github.com/en/rest/pulls
import type { PrRef } from './proof.ts';
import type { ReplaySample } from './replay.ts';

const API = 'https://api.github.com';

export type RevertInput = { repo: string; branch: string; commitSha: string; body: string; replay: ReplaySample[] };

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
  const head = await gh(`${repo}/git/ref/heads/${branch}`, token);
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
  await gh(`${repo}/git/refs`, token, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: revert.sha }),
  });
  const pr = await gh(`${repo}/pulls`, token, {
    method: 'POST',
    body: JSON.stringify({ title: `Revert "${firstLine}"`, head: branchName, base: branch, body }),
  });
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
  return (await gh(`${repo}/git/ref/heads/${branch}`, token)).object.sha;
}

export type ChangedFile = { path: string; patch: string; content: string | null };

// What a commit changed (its diff per file) and each file's content now on the branch, for the AI
// fix. Capped so the prompt stays small: at most 5 files, 40 KB each; removed files have no content.
export async function commitFiles(repo: string, sha: string, branch: string, token: string): Promise<ChangedFile[]> {
  const commit = await gh(`${repo}/commits/${sha}`, token);
  const files = (commit.files ?? []).slice(0, 5) as { filename: string; patch?: string; status: string }[];
  return await Promise.all(files.map(async (f) => {
    let content: string | null = null;
    if (f.status !== 'removed') {
      const c = await gh(`${repo}/contents/${encodeURIComponent(f.filename).replace(/%2F/g, '/')}?ref=${branch}`, token)
        .catch(() => null);
      if (c?.content && c.size <= 40_000) {
        content = new TextDecoder().decode(
          Uint8Array.from(atob(c.content.replace(/\n/g, '')), (ch) => ch.charCodeAt(0)),
        );
      }
    }
    return { path: f.filename, patch: (f.patch ?? '').slice(0, 20_000), content };
  }));
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
  const head = await gh(`${repo}/git/ref/heads/${branch}`, token);
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
  await gh(`${repo}/git/refs`, token, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: commit.sha }),
  });
  const pr = await gh(`${repo}/pulls`, token, {
    method: 'POST',
    body: JSON.stringify({ title, head: branchName, base: branch, body }),
  });
  return { repo, number: pr.number, headSha: commit.sha, url: pr.html_url, branch: branchName };
}
