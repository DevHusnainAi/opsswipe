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

// Open a PR that adds files (e.g. the proof workflow) on top of the branch head. The user reviews
// and merges it themselves; nothing lands in their repo without that.
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
): Promise<string> {
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
  return pr.html_url as string;
}
