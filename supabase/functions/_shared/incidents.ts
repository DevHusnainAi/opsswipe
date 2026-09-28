// Opening incidents, shared by every detector (app failure reports, liveness checks).
// One open incident per service; a new one carries its owner, allowed fixes, deploy context,
// replayable failing requests, and a suggested fix (rules now, Claude in the background).
import { db, env } from './db.ts';
import { accessToken } from './gcp.ts';
import { type Deploy, listDeploys, pickRollback } from './render.ts';
import { mergeSamples, type ReplaySample } from './replay.ts';
import { connection, notify, platformSa, readSecret, renderKey, type Service, toTarget } from './services.ts';
import { confirmsReport, selfHealed } from './flow.ts';
import { money, type Revenue, revenuePerHour } from './revenue.ts';
import { nvidiaLlm } from './llm.ts';
import { llmPatcher, type Patcher, vertexPatcher } from './patch.ts';
import { llmSuggester, suggest, toSuggestInput, vertexSuggester } from './suggest.ts';
import { actionsFor, CODE_FIXES } from './targets.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const COOLDOWN_MS = 3 * 60_000; // a restart takes ~1 min; don't re-page while it comes back

// Opt-in: Claude on Vertex (billed to the platform's GCP project) refines the rule-based suggestion
// and writes AI fix PRs.
// AI_SUGGESTIONS=vertex: Claude on Vertex (GCP_SA_KEY). AI_SUGGESTIONS=nvidia: NVIDIA's hosted models
// (NVIDIA_API_KEY, NVIDIA_MODEL). Anything else: rules only, and no AI fix PRs.
export const aiEnabled = () =>
  (env('AI_SUGGESTIONS') === 'vertex' && !!env('GCP_SA_KEY')) ||
  (env('AI_SUGGESTIONS') === 'nvidia' && !!env('NVIDIA_API_KEY'));

const NVIDIA_DEFAULT = 'nvidia/llama-3.3-nemotron-super-49b-v1.5';
const nvidia = (maxTokens?: number) =>
  nvidiaLlm(env('NVIDIA_API_KEY'), env('NVIDIA_MODEL') || NVIDIA_DEFAULT, maxTokens);

function aiSuggester() {
  if (!aiEnabled()) return undefined;
  if (env('AI_SUGGESTIONS') === 'nvidia') return llmSuggester(nvidia(2048));
  const sa = platformSa();
  return sa.project_id ? vertexSuggester(sa.project_id, () => accessToken(sa)) : undefined;
}

export function aiPatcher(): Patcher | undefined {
  if (!aiEnabled()) return undefined;
  if (env('AI_SUGGESTIONS') === 'nvidia') return llmPatcher(nvidia(16_384));
  const sa = platformSa();
  return sa.project_id ? vertexPatcher(sa.project_id, () => accessToken(sa)) : undefined;
}

async function deployHistory(s: Service): Promise<{ live?: Deploy; previous?: Deploy }> {
  if (s.provider !== 'render') return {};
  try {
    return pickRollback(await listDeploys(s.config.serviceId, await renderKey(s.owner)));
  } catch (e) {
    console.warn('deploy history unavailable:', String(e));
    return {};
  }
}

// The currently open incident for a service, if any.
export async function openIncidentFor(serviceId: string) {
  const { data } = await db.from('incidents').select('id, context')
    .eq('service_id', serviceId).in('status', ['active', 'resolving']).maybeSingle();
  return data as { id: string; context: { replay?: ReplaySample[] } } | null;
}

// Add failing requests to an open incident (dedup by method+path, capped).
export async function addSamples(id: string, context: { replay?: ReplaySample[] }, samples: ReplaySample[]) {
  await db.from('incidents').update({ context: { ...context, replay: mergeSamples(context.replay ?? [], samples) } })
    .eq('id', id);
}

export async function openIncident(
  s: Service,
  title: string,
  metric: string,
  samples: ReplaySample[] = [],
  release?: string, // the commit the app says it's running; used when the host has no deploy history
) {
  const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const { count } = await db.from('incidents').select('id', { count: 'exact', head: true })
    .eq('service_id', s.id).or(`status.in.(active,resolving),resolved_at.gt.${since}`);
  if (count) return { opened: false };

  const t = toTarget(s);
  const [deploys, revenue] = await Promise.all([deployHistory(s), revenueAtRisk(s.owner)]);
  if (!deploys.live && release) {
    deploys.live = { id: 'reported', status: 'live', createdAt: new Date().toISOString(), commit: { id: release } };
  }
  // merge_pr is never offered up front: /proof adds it once CI has proven a PR. The AI fix needs
  // Claude, so it's offered only when this server has it switched on.
  // Code fixes need something to replay: without samples, a PR could never be proven.
  const actions = actionsFor(t).filter((a) =>
    a !== 'merge_pr' && (a !== 'fix_pr' || aiEnabled()) && (samples.length > 0 || !CODE_FIXES.includes(a))
  );
  const input = toSuggestInput(s.name, t.provider, actions, metric, deploys);
  const rules = await suggest(input);

  // unique index one_open_incident makes a racing duplicate insert fail harmlessly
  const { data: inc } = await db.from('incidents').insert({
    title,
    service_id: s.id,
    owner: s.owner,
    target_server: s.name,
    provider: t.provider,
    metric,
    actions,
    action: rules.action,
    reason: rules.reason,
    suggested_by: 'rules',
    context: {
      live: deploys.live ?? null,
      previous: deploys.previous ?? null,
      replay: mergeSamples([], samples),
      ...(revenue?.perHour ? { revenue } : {}),
    },
  }).select('id').maybeSingle();

  if (inc) {
    EdgeRuntime.waitUntil(notify(s.owner, {
      title: `${s.name} is failing`,
      body: `${
        revenue?.perHour ? `~${money(revenue.perHour, revenue.currency)}/h at risk. ` : ''
      }${metric}. ${rules.reason}`,
      data: { incidentId: inc.id },
    }));
  }

  const ai = aiSuggester();
  if (inc && ai) {
    EdgeRuntime.waitUntil(
      suggest(input, ai).then((r) =>
        r.source === 'ai'
          ? db.from('incidents').update({ action: r.action, reason: r.reason, suggested_by: 'ai' })
            .eq('id', inc.id).eq('status', 'active')
          : null
      ),
    );
  }
  return { opened: !!inc };
}

// Recovery proof: the first healthy check after a fix stamps recovered_at.
export const HEALTH_TITLE = 'HTTP health check failing';

// What this outage costs per hour, if the owner connected RevenueCat. Never blocks an incident.
async function revenueAtRisk(owner: string): Promise<Revenue | null> {
  try {
    const c = await connection(owner, 'revenuecat');
    const key = c?.secret_id && c.account ? await readSecret(c.secret_id) : null;
    return key ? await revenuePerHour(key, c!.account!) : null;
  } catch (e) {
    console.warn('revenue at risk unavailable:', String(e));
    return null;
  }
}
export const REPORT_TITLE = 'Requests are failing';

type Pending = { sample: ReplaySample | null; release?: string };

// A failure the service's own app (or its Sentry) reported: joins the open incident as one more
// replay sample. Otherwise a first report is only held; a second within a minute opens the incident
// with both (no 3am page for one stray 500). `confirmed`: the source already applied a threshold
// (a Sentry alert rule).
export async function reportFailure(
  s: Service & { pending_report?: Pending | null; pending_at?: string | null },
  sample: ReplaySample | null,
  metric: string,
  release?: string,
  confirmed = false,
) {
  const open = await openIncidentFor(s.id);
  if (open) {
    if (sample) await addSamples(open.id, open.context ?? {}, [sample]);
    return { added: true };
  }
  const held = confirmsReport(s.pending_at) ? s.pending_report : null;
  if (!confirmed && !held) {
    await db.from('services').update({ pending_report: { sample, release }, pending_at: new Date().toISOString() })
      .eq('id', s.id);
    return { held: true };
  }
  await db.from('services').update({ pending_report: null, pending_at: null }).eq('id', s.id);
  const samples = mergeSamples(held?.sample ? [held.sample] : [], sample ? [sample] : []);
  return await openIncident(s, REPORT_TITLE, metric, samples, release ?? held?.release);
}

// An incident whose service came back with no fix run (a blip, a deploy that settled): close the
// card instead of leaving a fix on offer for a healthy service (reported ones after 10 quiet minutes).
export async function closeSelfHealed(serviceId: string) {
  const { data } = await db.from('incidents').select('id, owner, target_server, created_at, context, title')
    .eq('service_id', serviceId).eq('status', 'active').in('title', [HEALTH_TITLE, REPORT_TITLE]);
  for (const i of data ?? []) {
    const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true })
      .eq('incident_id', i.id).eq('outcome', 'executed');
    if (!selfHealed(i.context ?? {}, count ?? 0, i.title === REPORT_TITLE)) continue;
    const now = new Date().toISOString();
    const { data: closed } = await db.from('incidents').update({
      status: 'resolved',
      resolved_at: now,
      recovered_at: now,
      context: { ...i.context, self_healed: true },
    }).eq('id', i.id).eq('status', 'active').select('id').maybeSingle();
    if (!closed) continue; // a fix was claimed meanwhile
    await notify(i.owner, {
      title: `${i.target_server} recovered on its own`,
      body: `Down ${formatDuration(Date.parse(now) - Date.parse(i.created_at))}. No fix needed; the card is closed.`,
      data: { incidentId: i.id },
    });
  }
}

// The owner hears about it even with the app closed: the payoff of the swipe.
export async function markRecovered(serviceId: string) {
  const now = new Date().toISOString();
  const { data } = await db.from('incidents').update({ recovered_at: now })
    .eq('service_id', serviceId).eq('status', 'resolved').is('recovered_at', null)
    .select('id, owner, target_server, created_at');
  for (const i of data ?? []) {
    await notify(i.owner, {
      title: `${i.target_server} is back up`,
      body: `Down ${formatDuration(Date.parse(now) - Date.parse(i.created_at))}. Healthy again after your fix.`,
      data: { incidentId: i.id },
    });
  }
}

const formatDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};
