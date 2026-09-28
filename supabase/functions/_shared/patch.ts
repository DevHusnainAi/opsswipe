// "Fix with AI": Claude (on Vertex, billed to the platform's GCP project) reads the commit that broke
// production and writes the smallest code fix. It may only change files that commit touched, and
// the result is never trusted on its own: it goes out as a PR carrying the failing production
// requests, and OpsSwipe unlocks the merge only after CI replays them and they pass.
import { AnthropicVertex } from 'npm:@anthropic-ai/vertex-sdk@0.19.11';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@0.128/helpers/zod';
import { z } from 'npm:zod@4';
import type { ChangedFile } from './github.ts';
import type { ReplaySample } from './replay.ts';

export type PatchInput = {
  repo: string;
  commit: { sha: string; message: string };
  symptom: string;
  failing: ReplaySample[];
  files: ChangedFile[]; // the commit's diff per file + each file's content now
};
export type Patch = { summary: string; files: { path: string; content: string }[] };
export type Patcher = (i: PatchInput) => Promise<Patch>;

const MAX_FILE = 60_000;

// The model's answer, checked: only files the commit touched and that still exist, real changes
// only, sane sizes. An empty result means the model declined; that's an error the user sees.
export function checkPatch(p: Patch, input: PatchInput): Patch {
  const current = new Map(input.files.filter((f) => f.content !== null).map((f) => [f.path, f.content!]));
  const files = p.files.filter((f) =>
    current.has(f.path) && f.content.trim() && f.content.length <= MAX_FILE && f.content !== current.get(f.path)
  );
  if (!files.length) {
    throw new Error(`AI could not write a confident fix${p.summary ? `: ${p.summary}` : ''}. Try a revert instead.`);
  }
  return { summary: p.summary.trim().slice(0, 300), files };
}

const SYSTEM = `You are the fix writer in OpsSwipe, an on-call app. A commit broke production.
You receive: the commit message, its diff for each file, each file's full current content, the production symptom, and the exact requests that now fail (method, path, status, body).
Write the smallest change that makes those requests succeed again while keeping what the commit meant to do.
Rules:
- Change only files from the list you were given. Return each changed file's complete new content, not a diff.
- Do not add dependencies, tests, comments about the incident, or unrelated cleanups.
- If you cannot fix it with confidence from what you were given, return an empty files list and explain why in the summary.
- summary: one or two plain sentences for the pull request description: what was wrong and what you changed.`;

export function vertexPatcher(projectId: string, accessToken: () => Promise<string>): Patcher {
  return async (i) => {
    const paths = i.files.filter((f) => f.content !== null).map((f) => f.path);
    if (!paths.length) throw new Error('the commit changed no files the AI can read');
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
