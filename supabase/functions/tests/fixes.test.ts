import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { openRevertPr } from '../_shared/github.ts';
import { type Deploy, pickRollback, rollbackToPrevious } from '../_shared/render.ts';
import { ruleSuggest, suggest, type SuggestInput, toSuggestInput } from '../_shared/suggest.ts';

type Call = { url: string; method: string; body?: unknown };

// Route mocked fetch calls by "METHOD url-substring"; record what was sent.
function mockFetch(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find((k) => {
      const [m, frag] = k.split(' ');
      return m === method && String(url).includes(frag);
    });
    if (!key) return Promise.resolve(new Response(`no route for ${method} ${url}`, { status: 404 }));
    return Promise.resolve(Response.json(routes[key], { status: method === 'POST' ? 201 : 200 }));
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

const d = (id: string, status: string, commit: string): Deploy => ({
  id,
  status,
  createdAt: '2026-09-27T10:00:00Z',
  finishedAt: '2026-09-27T10:02:00Z',
  commit: { id: commit, message: `commit ${commit}` },
});

Deno.test('pickRollback: previous good deploy skips failed builds', () => {
  const deploys = [
    d('dep-4', 'build_failed', 'eee'),
    d('dep-3', 'live', 'ccc'),
    d('dep-2', 'build_failed', 'bbb'),
    d('dep-1', 'deactivated', 'aaa'),
  ];
  const { live, previous } = pickRollback(deploys);
  assertEquals(live?.id, 'dep-3');
  assertEquals(previous?.id, 'dep-1');
  assertEquals(pickRollback([d('dep-1', 'live', 'aaa')]).previous, undefined);
  assertEquals(pickRollback([]).live, undefined);
});

Deno.test('rollbackToPrevious posts the previous deploy id', async () => {
  const f = mockFetch({
    'GET /deploys': [{ deploy: d('dep-3', 'live', 'ccc1234') }, { deploy: d('dep-1', 'deactivated', 'aaa1234') }],
    'POST /rollback': { id: 'dep-5' },
  });
  try {
    assertEquals(await rollbackToPrevious('srv-1', 'k'), 'rolled back ccc1234 -> aaa1234');
  } finally {
    f.restore();
  }
  assertEquals(f.calls[1].url, 'https://api.render.com/v1/services/srv-1/rollback');
  assertEquals(f.calls[1].body, { deployId: 'dep-1' });
});

Deno.test('rollbackToPrevious refuses when there is nothing to roll back to', async () => {
  const f = mockFetch({ 'GET /deploys': [{ deploy: d('dep-1', 'live', 'aaa') }] });
  try {
    await assertRejects(() => rollbackToPrevious('srv-1', 'k'), Error, 'no previous good deploy');
  } finally {
    f.restore();
  }
});

Deno.test('openRevertPr: parent tree + replay file, then commit, branch, PR', async () => {
  const f = mockFetch({
    'GET /git/ref/heads/main': { object: { sha: 'bad0000' } },
    'GET /git/commits/bad0000': { message: 'Break the homepage\n\nlong body', parents: [{ sha: 'good000' }] },
    'GET /git/commits/good000': { tree: { sha: 'tree-good' } },
    'POST /git/trees': { sha: 'tree-with-replay' },
    'POST /git/commits': { sha: 'rev0000' },
    'POST /git/refs': {},
    'POST /pulls': { number: 7, html_url: 'https://github.com/me/app/pull/7' },
  });
  const replay = [{ method: 'GET', path: '/', status: 500, at: '2026-09-27T10:00:00Z' }];
  let pr;
  try {
    pr = await openRevertPr({ repo: 'me/app', branch: 'main', commitSha: 'bad0000', body: 'why', replay }, 't');
  } finally {
    f.restore();
  }
  assertEquals(pr, {
    repo: 'me/app',
    number: 7,
    headSha: 'rev0000',
    url: 'https://github.com/me/app/pull/7',
    branch: 'opsswipe/revert-bad0000',
  });
  const tree = f.calls.find((c) => c.url.endsWith('/git/trees'))!.body as {
    base_tree: string;
    tree: { path: string; content: string }[];
  };
  assertEquals(tree.base_tree, 'tree-good', 'the revert is exactly the parent tree');
  assertEquals(tree.tree[0].path, '.opsswipe/replays/bad0000.json');
  assertEquals(JSON.parse(tree.tree[0].content), { reverts: 'bad0000', samples: replay });
  const commit = f.calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/commits'))!;
  assertEquals((commit.body as { tree: string }).tree, 'tree-with-replay');
  assertEquals((commit.body as { parents: string[] }).parents, ['bad0000']);
  const prCall = f.calls.find((c) => c.url.endsWith('/pulls'))!;
  assertEquals(prCall.body, {
    title: 'Revert "Break the homepage"',
    head: 'opsswipe/revert-bad0000',
    base: 'main',
    body: 'why',
  });
});

Deno.test('openRevertPr refuses when the bad commit is no longer the branch head', async () => {
  const f = mockFetch({ 'GET /git/ref/heads/main': { object: { sha: 'newer00' } } });
  try {
    await assertRejects(
      () => openRevertPr({ repo: 'me/app', branch: 'main', commitSha: 'bad0000', body: '', replay: [] }, 't'),
      Error,
      'no longer the head',
    );
  } finally {
    f.restore();
  }
  assertEquals(f.calls.filter((c) => c.method === 'POST').length, 0, 'nothing written on refusal');
});

const render = (over: Partial<SuggestInput> = {}): SuggestInput => ({
  target: 'web',
  provider: 'render',
  actions: ['restart', 'rollback', 'revert_pr'],
  symptom: 'GET web.onrender.com -> 503 (80ms)',
  ...over,
});

Deno.test('ruleSuggest: recent deploy -> rollback, otherwise restart or reset', () => {
  const recent = render({
    liveDeploy: { commit: 'abc1234def', minutesBeforeFailure: 4 },
    previousDeploy: { commit: 'aaa' },
  });
  assertEquals(ruleSuggest(recent).action, 'rollback');
  assertEquals(
    ruleSuggest(recent).reason,
    'abc1234 deployed 4m before the failure. Roll back to the last good release.',
  );
  assertEquals(
    ruleSuggest(render({ liveDeploy: { minutesBeforeFailure: 300 }, previousDeploy: {} })).action,
    'restart',
  );
  assertEquals(
    ruleSuggest(render({ liveDeploy: { minutesBeforeFailure: 2 } })).action,
    'restart',
    'no previous deploy',
  );
  assertEquals(ruleSuggest({ ...render(), provider: 'gcp', actions: ['reset'] }).action, 'reset');
});

Deno.test('suggest: AI words are used only when valid and in agreement, otherwise rules win', async () => {
  const input = render();
  const rules = ruleSuggest(input).action;
  const other = input.actions.find((a) => a !== rules)!;
  assertEquals((await suggest(input, () => Promise.resolve({ action: rules, reason: 'r' }))).source, 'ai');
  assertEquals(
    (await suggest(input, () => Promise.resolve({ action: other, reason: 'r' }))).source,
    'rules',
    'an allowed but different fix does not overrule the rules',
  );
  assertEquals((await suggest(input, () => Promise.reject(new Error('refusal')))).source, 'rules');
  const outside = await suggest(
    { ...input, actions: ['restart'] },
    () => Promise.resolve({ action: 'rollback', reason: 'r' }),
  );
  assertEquals(
    outside,
    { ...ruleSuggest({ ...input, actions: ['restart'] }) },
    'AI cannot pick a fix outside the allowlist',
  );
  assertEquals((await suggest(input, () => Promise.resolve({ action: 'restart', reason: '  ' }))).source, 'rules');
});

Deno.test('toSuggestInput measures minutes from deploy finish to now', () => {
  const now = Date.parse('2026-09-27T10:07:00Z');
  const i = toSuggestInput('web', 'render', ['restart'], 's', {
    live: d('dep-3', 'live', 'ccc'),
    previous: d('dep-1', 'deactivated', 'aaa'),
  }, now);
  assertEquals(i.liveDeploy?.minutesBeforeFailure, 5);
  assertEquals(i.previousDeploy?.commit, 'aaa');
});
