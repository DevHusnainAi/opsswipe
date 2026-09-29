// Opening incidents, shared by every detector (app failure reports, liveness checks).
// One open incident per service; a new one carries its owner, allowed fixes, deploy context,
// replayable failing requests, and a suggested fix (rules now, Claude in the background).
import { db, env } from './db.ts';
import { accessToken } from './gcp.ts';
import { type Deploy, listDeploys, pickRollback } from './render.ts';
import { mergeSamples, type ReplaySample } from './replay.ts';
import {
  connection,
  githubToken,
  notify,
  platformSa,
  readSecret,
  renderKey,
  type Service,
  toTarget,
} from './services.ts';
import { aiFixPr, badCommit, type Incident, isPro } from './codeFix.ts';
import { afterFix, confirmsReport, ESCALATE_AFTER_MS, needsEscalation, selfHealed, staleClaim } from './flow.ts';
import { money, type Revenue, revenuePerHour } from './revenue.ts';
import { nvidiaLlm, openaiLlm, withFallback } from './llm.ts';
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

const NVIDIA_DEFAULT = 'nvidia/nemotron-3-super-120b-a12b';
// Optional backup provider for when NVIDIA is overloaded: any OpenAI-compatible API, e.g. Groq
// (AI_FALLBACK_BASE_URL=https://api.groq.com/openai/v1, AI_FALLBACK_API_KEY, AI_FALLBACK_MODEL).
const nvidia = (maxTokens?: number) =>
  withFallback(
    nvidiaLlm(env('NVIDIA_API_KEY'), env('NVIDIA_MODEL') || NVIDIA_DEFAULT, maxTokens),
    env('AI_FALLBACK_BASE_URL') && env('AI_FALLBACK_API_KEY') && env('AI_FALLBACK_MODEL')
      ? openaiLlm(env('AI_FALLBACK_BASE_URL'), env('AI_FALLBACK_API_KEY'), env('AI_FALLBACK_MODEL'), maxTokens)
      : undefined,
  );

function aiSuggester() {
  if (!aiEnabled()) return undefined;
  if (env('AI_SUGGESTIONS') === 'nvidia') return llmSuggester(nvidia(2048));
  const sa = platformSa();
  return sa.project_id ? vertexSuggester(sa.project_id, () => accessToken(sa)) : undefined;
}

// Plain JSON answers (postmortems). ponytail: NVIDIA mode only; Vertex would need its own adapter.
export const aiLlm = () => (aiEnabled() && env('AI_SUGGESTIONS') === 'nvidia' ? nvidia(2048) : undefined);

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
  await db.from('incidents').update({ context: { replay: mergeSamples(context.replay ?? [], samples) } })
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

  // Opt-in (Pro): the AI fix is written, opened as a PR and proven by CI before anyone looks, so the
  // page can say "a fix is ready". Nothing reaches production: merging still needs a swipe.
  // Only when a release is known to have broken it: a stopped VM or a network blip isn't a code bug.
  if (inc && actions.includes('fix_pr') && s.config.autofix && deploys.live?.commit?.id) {
    EdgeRuntime.waitUntil(prepareFix(s, inc.id));
  }

  const ai = aiSuggester();
  if (inc && ai) {
    EdgeRuntime.waitUntil(
      // The model's second opinion is recorded either way; its words replace the rules' only if it agreed.
      suggest(input, ai).then(async (r) => {
        await db.from('incidents').update({
          ...(r.source === 'ai' ? { action: r.action, reason: r.reason, suggested_by: 'ai' } : {}),
          context: { ai: { ...r.second, at: new Date().toISOString() } },
        }).eq('id', inc.id).eq('status', 'active');
      }),
    );
  }
  return { opened: !!inc };
}

// ponytail: if the engineer swipes a code fix while this runs, both PRs open; the second one waits unused.
async function prepareFix(s: Service, id: string) {
  try {
    const patcher = aiPatcher();
    if (!patcher || !(await isPro(s.owner))) return;
    const { data: inc } = await db.from('incidents').select().eq('id', id).maybeSingle<Incident>();
    if (!inc) return;
    const token = await githubToken(s.owner);
    const t = toTarget(s);
    const { pr, detail } = await aiFixPr(t, await badCommit(s, t, inc, token), inc, token, patcher, true);
    const { data: now } = await db.from('incidents').select().eq('id', id).maybeSingle<Incident>();
    if (!now || now.status !== 'active' || now.context.pr) return; // the engineer got there first
    const next = afterFix('fix_pr', now, { pr });
    await db.from('incidents').update({
      ...next.update,
      reason: 'AI fix prepared automatically; CI is proving it against the failing requests.',
      context: { ...(next.update.context as object), prepared: true },
    }).eq('id', id).eq('status', 'active');
    await db.from('audit_log').insert({
      incident_id: id,
      actor: s.owner,
      action: 'fix_pr',
      target: s.name,
      outcome: 'executed',
      detail: `${detail} (prepared automatically)`,
    });
  } catch (e) {
    console.warn('automatic fix failed:', String(e)); // the card still offers every fix by hand
  }
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
      context: { self_healed: true },
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

// Nobody answered in 5 minutes: page everyone on the owner's team (their phones and their Slack/Discord).
export async function escalate(now = Date.now()) {
  const { data: open } = await db.from('incidents').select('id, owner, target_server, created_at, status, context')
    .eq('status', 'active').lt('created_at', new Date(now - ESCALATE_AFTER_MS).toISOString())
    .is('context->>escalated_at', null);
  for (const inc of open ?? []) {
    const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('incident_id', inc.id);
    if (!needsEscalation(inc, count ?? 0, now)) continue;
    // Marked first, and only if nobody else marked it meanwhile (an overlapping run), so the team is
    // paged once.
    const { data: marked } = await db.from('incidents').update({
      context: { escalated_at: new Date(now).toISOString() },
    })
      .eq('id', inc.id).is('context->>escalated_at', null).select('id').maybeSingle();
    if (!marked) continue;
    const { data: team } = await db.from('team_members').select('member').eq('owner', inc.owner);
    const mins = Math.round((now - Date.parse(inc.created_at)) / 60_000);
    for (const t of team ?? []) {
      await notify(t.member, {
        title: `Escalated: ${inc.target_server} is down`,
        body: `No one has answered for ${mins} minutes. You're on the team, so it's yours.`,
        data: { incidentId: inc.id },
      });
    }
  }
}

// A fix whose function died mid-run (timeout, crash) leaves the card 'resolving', which would block
// every new incident for that service. Hand it back: the card returns, and a free outage that bought
// nothing is refunded (refund_free_run checks no fix executed).
export async function sweepStaleClaims(now = Date.now()) {
  const { data } = await db.from('incidents').select('id, owner, action, target_server, claimed_at')
    .eq('status', 'resolving');
  for (const inc of (data ?? []).filter((i) => staleClaim(i.claimed_at, now))) {
    const { data: back } = await db.from('incidents').update({ status: 'active' }).eq('id', inc.id)
      .eq('status', 'resolving').select('id').maybeSingle();
    if (!back) continue;
    await db.rpc('refund_free_run', { uid: inc.owner, incident: inc.id });
    await db.from('audit_log').insert({
      incident_id: inc.id,
      actor: inc.owner,
      action: inc.action,
      target: inc.target_server,
      outcome: 'failed',
      detail: 'the fix did not finish in time; the card is back so you can try again',
    });
  }
}
