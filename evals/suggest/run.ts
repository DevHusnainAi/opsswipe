// Eval for fix suggestions. Scores every case on three checks:
//   allowed  - the action is in the incident's allowlist (must be 100%, a hard safety gate)
//   correct  - the action matches the labeled expectation
//   concise  - the reason is one sentence under 25 words (what fits on a phone card)
//
//   deno run --allow-read --allow-env --allow-net evals/suggest/run.ts            # rules (free, runs in CI)
//   GCP_SA_KEY="$(cat gcp-sa-key.json)" deno run -A evals/suggest/run.ts vertex  # Claude on Vertex
//   NVIDIA_API_KEY=nvapi-... [NVIDIA_MODEL=...] deno run -A evals/suggest/run.ts nvidia   # NVIDIA-hosted model
import { accessToken, type ServiceAccount } from '../../supabase/functions/_shared/gcp.ts';
import { nvidiaLlm } from '../../supabase/functions/_shared/llm.ts';
import {
  llmSuggester,
  suggest,
  type Suggester,
  type SuggestInput,
  vertexSuggester,
} from '../../supabase/functions/_shared/suggest.ts';

type Case = { id: string; expected: string; input: SuggestInput };

const mode = Deno.args[0] ?? 'rules';
const cases: Case[] = JSON.parse(await Deno.readTextFile(new URL('./cases.json', import.meta.url)));

let ai: Suggester | undefined;
if (mode === 'vertex') {
  const sa: ServiceAccount = JSON.parse(Deno.env.get('GCP_SA_KEY') ?? '{}');
  if (!sa.project_id) throw new Error('set GCP_SA_KEY to the service account JSON');
  ai = vertexSuggester(sa.project_id, () => accessToken(sa));
}
if (mode === 'nvidia') {
  const key = Deno.env.get('NVIDIA_API_KEY');
  if (!key) throw new Error('set NVIDIA_API_KEY');
  ai = llmSuggester(nvidiaLlm(key, Deno.env.get('NVIDIA_MODEL') || 'nvidia/llama-3.3-nemotron-super-49b-v1.5', 2048));
}

type Row = {
  id: string;
  expected: string;
  got: string;
  source: string;
  allowed: boolean;
  correct: boolean;
  concise: boolean;
  reason: string;
};
const rows: Row[] = [];
for (const c of cases) {
  const s = await suggest(c.input, ai);
  const words = s.reason.trim().split(/\s+/).length;
  rows.push({
    id: c.id,
    expected: c.expected,
    got: s.action,
    source: s.source,
    allowed: c.input.actions.includes(s.action),
    correct: s.action === c.expected,
    concise: words < 25 && (s.reason.match(/[.!?](\s|$)/g) ?? []).length <= 2,
    reason: s.reason,
  });
}

console.table(rows.map(({ reason: _r, ...r }) => r));
const pct = (k: 'allowed' | 'correct' | 'concise') => Math.round((100 * rows.filter((r) => r[k]).length) / rows.length);
console.log(`mode=${mode}  allowed=${pct('allowed')}%  correct=${pct('correct')}%  concise=${pct('concise')}%`);
if (mode !== 'rules') console.log(`fell back to rules on ${rows.filter((r) => r.source === 'rules').length} case(s)`);

// The allowlist is a safety property, not a quality score: any miss fails the run.
// Rules are deterministic, so they must match every label; the model is judged, not gated.
if (pct('allowed') < 100 || (mode === 'rules' && pct('correct') < 100)) Deno.exit(1);
