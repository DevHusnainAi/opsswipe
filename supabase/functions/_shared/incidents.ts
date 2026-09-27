// Opening incidents, shared by every detector (app failure reports, liveness checks).
// One open incident per target; a new one carries its allowed fixes, deploy context,
// replayable failing requests, and a suggested fix (rules now, Claude in the background).
import { db, env } from './db.ts';
import { accessToken, type ServiceAccount } from './gcp.ts';
import { type Deploy, listDeploys, pickRollback } from './render.ts';
import { mergeSamples, type ReplaySample } from './replay.ts';
import { suggest, toSuggestInput, vertexSuggester } from './suggest.ts';
import { actionsFor, type Target } from './targets.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const COOLDOWN_MS = 3 * 60_000; // a restart takes ~1 min; don't re-page while it comes back
const SA: ServiceAccount | undefined = env('GCP_SA_KEY') ? JSON.parse(env('GCP_SA_KEY')) : undefined;
// Opt-in: Claude on Vertex refines the rule-based suggestion in the background.
const AI = env('AI_SUGGESTIONS') === 'vertex' && SA?.project_id
  ? vertexSuggester(SA.project_id, () => accessToken(SA))
  : undefined;

async function deployHistory(t: Target): Promise<{ live?: Deploy; previous?: Deploy }> {
  if (t.provider !== 'render') return {};
  try {
    return pickRollback(await listDeploys(t.serviceId, env('RENDER_API_KEY')));
  } catch (e) {
    console.warn('deploy history unavailable:', String(e));
    return {};
  }
}

// The currently open incident for a target, if any.
export async function openIncidentFor(name: string) {
  const { data } = await db.from('incidents').select('id, context')
    .eq('target_server', name).in('status', ['active', 'resolving']).maybeSingle();
  return data as { id: string; context: { replay?: ReplaySample[] } } | null;
}

// Add failing requests to an open incident (dedup by method+path, capped).
export async function addSamples(id: string, context: { replay?: ReplaySample[] }, samples: ReplaySample[]) {
  await db.from('incidents').update({ context: { ...context, replay: mergeSamples(context.replay ?? [], samples) } })
    .eq('id', id);
}

export async function openIncident(
  name: string,
  t: Target,
  title: string,
  metric: string,
  samples: ReplaySample[] = [],
) {
  const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const { count } = await db.from('incidents').select('id', { count: 'exact', head: true })
    .eq('target_server', name).or(`status.in.(active,resolving),resolved_at.gt.${since}`);
  if (count) return { opened: false };

  const deploys = await deployHistory(t);
  // merge_pr is never offered up front: /proof adds it once CI has proven a PR.
  const actions = actionsFor(t).filter((a) => a !== 'merge_pr');
  const input = toSuggestInput(name, t.provider, actions, metric, deploys);
  const rules = await suggest(input);

  // unique index one_open_incident makes a racing duplicate insert fail harmlessly
  const { data: inc } = await db.from('incidents').insert({
    title,
    target_server: name,
    provider: t.provider,
    metric,
    actions,
    action: rules.action,
    reason: rules.reason,
    suggested_by: 'rules',
    context: { live: deploys.live ?? null, previous: deploys.previous ?? null, replay: mergeSamples([], samples) },
  }).select('id').maybeSingle();

  if (inc && AI) {
    EdgeRuntime.waitUntil(
      suggest(input, AI).then((s) =>
        s.source === 'ai'
          ? db.from('incidents').update({ action: s.action, reason: s.reason, suggested_by: 'ai' })
            .eq('id', inc.id).eq('status', 'active')
          : null
      ),
    );
  }
  return { opened: !!inc };
}

// Recovery proof: the first healthy check after a fix stamps recovered_at.
export async function markRecovered(name: string) {
  await db.from('incidents').update({ recovered_at: new Date().toISOString() })
    .eq('target_server', name).eq('status', 'resolved').is('recovered_at', null);
}
