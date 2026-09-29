// "Fix with AI": the model reads the commit that broke production and writes the smallest code fix,
// plus one regression test for the failing requests. It may only change files that commit touched
// and add that one test at a path OpsSwipe picks (so it can't rewrite existing tests). The result is
// never trusted on its own: it goes out as a PR carrying the failing production requests, and
// OpsSwipe unlocks the merge only after CI runs the tests (the new one included) and replays them.
import { AnthropicVertex } from 'npm:@anthropic-ai/vertex-sdk@0.19.11';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@0.128/helpers/zod';
import { z } from 'npm:zod@4';
import type { ChangedFile } from './github.ts';
import type { Llm } from './llm.ts';
import type { ReplaySample } from './replay.ts';

export type PatchInput = {
  repo: string;
  commit: { sha: string; message: string };
  symptom: string;
  failing: ReplaySample[];
  files: ChangedFile[]; // the commit's diff per file + each file's content now
  // One of the repo's tests as a style example, and where the new regression test goes.
  test?: { example: { path: string; content: string }; path: string } | null;
};
export type Patch = { summary: string; files: { path: string; content: string }[] };
export type Patcher = (i: PatchInput) => Promise<Patch>;

const MAX_FILE = 60_000;
// CI config and the replay files decide whether a fix is "proven"; the failing requests the model
// reads are attacker-controlled, so it may never touch them, even if the bad commit did.
const PROTECTED = /^\.(github|opsswipe)\//;

// The model's answer, checked: only files the commit touched and that still exist, real changes
// only, sane sizes. An empty result means the model declined; that's an error the user sees.
export function checkPatch(p: Patch, input: PatchInput): Patch {
  const current = new Map(input.files.filter((f) => f.content !== null).map((f) => [f.path, f.content!]));
  const ok = (f: { path: string; content: string }) =>
    (current.has(f.path) || f.path === input.test?.path) && !PROTECTED.test(f.path) && f.content.trim() &&
    f.content.length <= MAX_FILE && f.content !== current.get(f.path);
  const files = p.files.filter(ok);
  // A test on its own fixes nothing.
  if (!files.some((f) => f.path !== input.test?.path)) {
    throw new Error(`AI could not write a confident fix${p.summary ? `: ${p.summary}` : ''}. Try a revert instead.`);
  }
  return { summary: p.summary.trim().slice(0, 300), files };
}

const SYSTEM = `You are the fix writer in OpsSwipe, an on-call app. A commit broke production.
You receive: the commit message, its diff for each file, each file's full current content, the production symptom, and the exact requests that now fail (method, path, status, body).
Write the smallest change that makes those requests succeed again while keeping what the commit meant to do.
Rules:
- Change only files from the list you were given. Return each changed file's complete new content, not a diff.
- If you were given a test path and an example test: also add ONE regression test at exactly that path, written like the example (same runner and style), that sends the failing request(s) and asserts they now succeed. It must pass with your fix.
- Do not add dependencies, other tests, comments about the incident, or unrelated cleanups.
- If you cannot fix it with confidence from what you were given, return an empty files list and explain why in the summary.
- summary: one or two plain sentences for the pull request description: what was wrong and what you changed.`;

// The files the model may return: the commit's readable files, and the regression test's path.
const writable = (i: PatchInput) => [
  ...i.files.filter((f) => f.content !== null).map((f) => f.path),
  ...(i.test ? [i.test.path] : []),
];

// Next to the repo's own tests, with their extension: opsswipe-<sha7>.test.js beside server.test.js.
export function regressionTestPath(example: string, sha: string) {
  const dir = example.includes('/') ? example.slice(0, example.lastIndexOf('/') + 1) : '';
  const ext = example.match(/\.(test|spec)(\.[cm]?[jt]sx?)$/)?.[2] ?? example.match(/\.[cm]?[jt]sx?$/)?.[0] ?? '.js';
  return `${dir}opsswipe-${sha.slice(0, 7)}.test${ext}`;
}

export function vertexPatcher(projectId: string, accessToken: () => Promise<string>): Patcher {
  return async (i) => {
    const paths = writable(i);
    if (!i.files.some((f) => f.content !== null)) throw new Error('the commit changed no files the AI can read');
    const schema = z.object({
      summary: z.string(),
      files: z.array(z.object({ path: z.enum(paths as [string, ...string[]]), content: z.string() })),
    });
    const client = new AnthropicVertex({ projectId, region: 'global', accessToken: await accessToken() });
    const res = await client.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 32000,
      output_config: { effort: 'medium', format: zodOutputFormat(schema) },
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(i) }],
    });
    if (res.stop_reason === 'refusal' || !res.parsed_output) throw new Error(`AI returned no fix (${res.stop_reason})`);
    return res.parsed_output;
  };
}

// Same job on any JSON-returning model (NVIDIA Nemotron). checkPatch() still decides what may ship.
export function llmPatcher(llm: Llm): Patcher {
  return async (i) => {
    const paths = writable(i);
    if (!i.files.some((f) => f.content !== null)) throw new Error('the commit changed no files the AI can read');
    const r = await llm(SYSTEM, JSON.stringify(i), {
      summary: 'string',
      files: [{ path: `one of ${paths.join(', ')}`, content: 'the complete new file content' }],
    }) as { summary?: unknown; files?: unknown } | null;
    if (!r || typeof r.summary !== 'string' || !Array.isArray(r.files)) throw new Error('AI returned no fix');
    const files = r.files.filter((f): f is { path: string; content: string } =>
      typeof f?.path === 'string' && typeof f?.content === 'string'
    );
    return { summary: r.summary, files };
  };
}
