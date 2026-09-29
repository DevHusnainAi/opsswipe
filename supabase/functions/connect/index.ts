// Connect: the signed-in user links GitHub, Render and their services from the app.
// Every action runs for the caller only (verified JWT). Keys go straight into Vault; the app gets
// back only non-secret info, plus each service's report secret exactly once, at creation.
import { hashToken, newToken } from '../_shared/agents.ts';
import { alertKind, chatAuthorizeUrl } from '../_shared/alerts.ts';
import { withReturn } from '../_shared/appLink.ts';
import { isTeam } from '../_shared/codeFix.ts';
import { db, env, json } from '../_shared/db.ts';
import { getInstanceStatus } from '../_shared/gcp.ts';
import { freshSignIn, registerFixKey, validKey } from '../_shared/fixKeys.ts';
import { consentUrl, GoogleError, grantReset, listProjects, listVms, revokeReset } from '../_shared/google.ts';
import { commitFiles, fileText, openFilesPr, prFiles } from '../_shared/github.ts';
import { aiLlm } from '../_shared/incidents.ts';
import { writePostmortem } from '../_shared/postmortem.ts';
import type { PrRef } from '../_shared/proof.ts';
import { authorizeUrl, installUrl, listRepos } from '../_shared/githubApp.ts';
import { claim, ClaimError, newState, saveAlerts } from '../_shared/oauthState.ts';
import { PROOF_SCRIPT, PROOF_SCRIPT_PATH, PROOF_WORKFLOW_PATH, proofWorkflow } from '../_shared/proofKit.ts';
import { idsFromLink, listDeployments } from '../_shared/railway.ts';
import { keyProject, RevenueError, revenuePerHour } from '../_shared/revenue.ts';
import { getRenderService, listServices } from '../_shared/render.ts';
import {
  connection,
  type ConnectionKind,
  deleteSecret,
  forgetConnection,
  getService,
  githubToken,
  googleToken,
  ownersFor,
  platformSa,
  railwayToken,
  renderKey,
  type Service,
  storeSecret,
  toTarget,
} from '../_shared/services.ts';
import { validateTarget } from '../_shared/targets.ts';

const inboxUrl = (key: string) => `${env('SUPABASE_URL')}/functions/v1/alerts?k=${key}`;

// The page is static HTML (status-page/index.html) hosted where HTML is allowed; it reads /status.
const statusPageUrl = (slug: string) =>
  `${env('STATUS_PAGE_URL') || 'https://devhusnainai.github.io/opsswipe-status/'}?s=${slug}`;

const functionUrl = (name: string) => `${env('SUPABASE_URL')}/functions/v1/${name}`;
const randomSecret = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

class UserError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const need = (ok: unknown, message: string) => {
  if (!ok) throw new UserError(message);
};

// Takes OpsSwipe's reset right on these VMs away at Google (not just in our database), before the
// Google connection that can do it is gone. A VM another service still watches keeps its binding.
// Returns the VMs Google refused, so the user can remove the binding by hand.
async function releaseVms(owner: string, vms: Service[]) {
  const failed: string[] = [];
  const token = vms.length ? await googleToken(owner).catch(() => null) : null;
  for (const s of vms) {
    const vm = { project: s.config.project, zone: s.config.zone, instance: s.config.instance };
    const others = (field: string, value: string) =>
      db.from('services').select('id', { count: 'exact', head: true }).eq('provider', 'gcp')
        .eq(`config->>${field}`, value).neq('id', s.id);
    try {
      const { count: sameVm } = await others('instance', vm.instance).eq('config->>project', vm.project)
        .eq('config->>zone', vm.zone);
      if (sameVm) continue;
      if (!token) throw new Error('no Google access');
      const { count: inProject } = await others('project', vm.project);
      await revokeReset(token, vm, platformSa().client_email, !inProject);
    } catch (e) {
      console.error('revoke failed:', vm.instance, String(e));
      failed.push(`${vm.project}/${vm.instance}`);
    }
  }
  return failed;
}

async function addService(
  owner: string,
  name: string,
  provider: 'gcp' | 'render' | 'railway',
  config: Record<string, string>,
) {
  need(NAME.test(name), 'Names use lowercase letters, numbers and dashes.');
  let target;
  try {
    target = validateTarget(provider, config);
  } catch (e) {
    throw new UserError(`Check the details: ${(e as Error).message}.`);
  }
  const secret = randomSecret();
  const secretId = await storeSecret(secret);
  const { data, error } = await db.from('services').insert({
    owner,
    name,
    provider,
    config: target,
    report_secret_id: secretId,
  }).select('id, name, provider, config').single();
  if (error) {
    await deleteSecret(secretId);
    throw new UserError(error.code === '23505' ? `You already have a service named ${name}.` : error.message);
  }
  // The secret is shown once so the user can set it on their host; OpsSwipe keeps it only in Vault.
  return { service: data, report: { url: `${functionUrl('report')}?service=${data.id}`, secret } };
}

// The repo the user picked for a service: undefined = keep what was detected, {} = no repo.
// A repo is accepted only if the user's GitHub App installation can reach it.
async function chosenRepo(
  owner: string,
  p: Record<string, unknown>,
): Promise<{ repo?: string; branch?: string } | undefined> {
  if (p.repo === undefined) return undefined;
  if (p.repo === null || p.repo === '') return {};
  const c = await connection(owner, 'github');
  need(c?.installation_id, 'Connect GitHub first to link a repo.');
  const found = (await listRepos(c!.installation_id!)).find((r) => r.name === String(p.repo));
  need(found, 'OpsSwipe cannot see that repo. Add it to the OpsSwipe GitHub App installation.');
  return { repo: found!.name, branch: typeof p.branch === 'string' && p.branch ? p.branch : found!.branch };
}

async function handle(owner: string, action: string, p: Record<string, unknown>) {
  switch (action) {
    case 'status': {
      const [gh, rd, gc, rw, al, rc] = await Promise.all([
        connection(owner, 'github'),
        connection(owner, 'render'),
        connection(owner, 'google'),
        connection(owner, 'railway'),
        connection(owner, 'alerts'),
        connection(owner, 'revenuecat'),
      ]);
      const { data: page } = await db.from('status_pages').select('slug').eq('owner', owner).maybeSingle();
      const { data: inbox } = await db.from('alert_inboxes').select('key').eq('owner', owner).maybeSingle();
      // The install link with a one-time state comes from github_start; this is the plain one.
      return {
        github: {
          connected: !!gh?.installation_id,
          account: gh?.account ?? null,
          installUrl: installUrl(),
        },
        statusPage: page ? statusPageUrl(page.slug) : null,
        alertInbox: inbox ? inboxUrl(inbox.key) : null,
        render: { connected: !!rd?.secret_id },
        railway: { connected: !!rw?.secret_id },
        alerts: {
          connected: !!al?.secret_id,
          kind: al?.account?.split(' ')[0] ?? null,
          channel: al?.account?.split(' ').slice(1).join(' ') || null,
        },
        revenuecat: { connected: !!rc?.secret_id, project: rc?.account ?? null },
        google: { connected: !!gc?.secret_id, account: gc?.account ?? null, available: !!env('GOOGLE_CLIENT_ID') },
        gcpIdentity: env('GCP_SA_KEY') ? platformSa().client_email : null,
      };
    }

    // Connect GitHub with a one-time state: authorize first (always returns a code, even when the app
    // is already installed); oauth-callback finds the installation or sends the user on to install it,
    // and hands the app back to Expo Go if that's where it started.
    case 'github_start': {
      const state = withReturn(await newState(owner, 'github'), p.returnTo);
      return { url: authorizeUrl(state) };
    }

    // Finishes a GitHub, Google, Slack or Discord connection on the phone the provider redirected back to.
    case 'oauth_claim': {
      const r = await claim(owner, String(p.claim ?? '')).catch((e) => {
        throw e instanceof ClaimError ? new UserError(e.message) : e;
      });
      return r.kind === 'google' ? { ...r, projects: await listProjects(await googleToken(owner)) } : r;
    }

    case 'github_repos': {
      const c = await connection(owner, 'github');
      need(c?.installation_id, 'Connect GitHub first.');
      return { repos: await listRepos(c!.installation_id!) };
    }

    case 'render_key': {
      const apiKey = String(p.apiKey ?? '').trim();
      need(/^rnd_[A-Za-z0-9]{10,}$/.test(apiKey), "That doesn't look like a Render API key (it starts with rnd_).");
      const services = await listServices(apiKey).catch(() => {
        throw new UserError('Render rejected that key.');
      });
      const old = await connection(owner, 'render');
      const secretId = await storeSecret(apiKey);
      await db.from('connections').upsert({ owner, kind: 'render', secret_id: secretId });
      await deleteSecret(old?.secret_id);
      return { render: { connected: true }, services };
    }

    // Discord or Slack as a second alert channel, in one click: the provider asks which channel and
    // oauth-callback stores the webhook it returns. set_alerts with an empty url stops posting (a pasted
    // webhook URL still works, for self-hosted setups).
    case 'alerts_start': {
      const kind = p.kind === 'slack' ? 'slack' : 'discord';
      need(
        env(kind === 'slack' ? 'SLACK_CLIENT_ID' : 'DISCORD_CLIENT_ID'),
        `Add to ${kind === 'slack' ? 'Slack' : 'Discord'} is not set up on this OpsSwipe server.`,
      );
      return { url: chatAuthorizeUrl(kind, withReturn(await newState(owner, kind), p.returnTo)) };
    }

    case 'set_alerts': {
      const url = String(p.url ?? '').trim();
      if (!url) {
        await forgetConnection(owner, 'alerts');
        return { alerts: { connected: false } };
      }
      need(alertKind(url), 'Paste a Discord or Slack incoming webhook URL.');
      const r = await saveAlerts(owner, url, 'your channel').catch(() => {
        throw new UserError('That webhook URL was rejected.');
      });
      return { alerts: { connected: true, ...r } };
    }

    // Revenue at risk: the user's own RevenueCat v2 secret key (Charts & Metrics read) and project id.
    // One test read proves both before anything is stored.
    case 'set_revenuecat': {
      const key = String(p.key ?? '').trim();
      need(/^sk_\w{10,}$/.test(key), "That doesn't look like a RevenueCat secret key (it starts with sk_).");
      // The id is optional: a key that can read its project says which one it is.
      const projectId = String(p.projectId ?? '').trim() || (await keyProject(key)) || '';
      need(
        /^[\w-]{3,64}$/.test(projectId),
        'Give the key "Project configuration: Read" too, or paste the project id (Project settings).',
      );
      const r = await revenuePerHour(key, projectId).catch((e) => {
        throw new UserError(e instanceof RevenueError ? e.message : 'RevenueCat did not answer. Try again.');
      });
      const old = await connection(owner, 'revenuecat');
      const secretId = await storeSecret(key);
      await db.from('connections').upsert({ owner, kind: 'revenuecat', secret_id: secretId, account: projectId });
      await deleteSecret(old?.secret_id);
      return { revenuecat: { connected: true, project: projectId }, perHour: r.perHour, currency: r.currency };
    }

    // Railway: a token (account or workspace) once, then services by their dashboard link.
    case 'add_railway': {
      const token = String(p.token ?? '').trim();
      const ids = idsFromLink(String(p.link ?? ''));
      need(ids, 'Paste the service link from the Railway dashboard (railway.com/project/…/service/…?environmentId=…).');
      const url = String(p.url ?? '').trim();
      need(/^https?:\/\/[^\s]+$/.test(url), 'Enter the public URL OpsSwipe should check.');
      const useToken = token || (await railwayToken(owner).catch(() => ''));
      need(useToken, 'Paste a Railway API token (Account settings → Tokens).');
      await listDeployments(useToken, ids!).catch(() => {
        throw new UserError('Railway rejected that token or link. Check the token can see this project.');
      });
      if (token) {
        const old = await connection(owner, 'railway');
        const secretId = await storeSecret(token);
        await db.from('connections').upsert({ owner, kind: 'railway', secret_id: secretId });
        await deleteSecret(old?.secret_id);
      }
      const config: Record<string, string> = { ...ids!, url };
      const picked = await chosenRepo(owner, p);
      if (picked) Object.assign(config, picked);
      return await addService(owner, String(p.name ?? '').toLowerCase(), 'railway', config);
    }

    // The Client Secret of the user's Sentry Internal Integration, which signs its alert webhooks.
    case 'set_sentry_secret': {
      const s = await getService(String(p.serviceId ?? ''));
      need(s && s.owner === owner, 'Service not found.');
      const secret = String(p.secret ?? '').trim();
      need(/^[0-9a-f]{64}$/.test(secret), "That doesn't look like a Sentry Client Secret (64 hex characters).");
      const secretId = await storeSecret(secret);
      await db.from('services').update({ sentry_secret_id: secretId }).eq('id', s!.id);
      await deleteSecret(s!.sentry_secret_id);
      return { sentry: { webhookUrl: `${functionUrl('sentry')}?service=${s!.id}` } };
    }

    case 'render_services':
      return { services: await listServices(await renderKey(owner)) };

    case 'add_render': {
      const serviceId = String(p.serviceId ?? '');
      need(/^srv-[a-z0-9]+$/.test(serviceId), 'Pick a Render service.');
      const r = await getRenderService(serviceId, await renderKey(owner));
      need(r.url, 'That service has no public URL to check.');
      const config: Record<string, string> = { serviceId, url: r.url };
      // Render reports the repo it deploys from; the user can confirm, change or remove it.
      const picked = await chosenRepo(owner, p);
      if (picked) Object.assign(config, picked);
      else if (r.repo) Object.assign(config, { repo: r.repo, branch: r.branch ?? 'main' });
      return await addService(owner, String(p.name ?? r.name).toLowerCase(), 'render', config);
    }

    // Connect Google Cloud once; then pick projects and VMs any time. Each VM added grants OpsSwipe reset on it.
    case 'gcp_start': {
      need(env('GOOGLE_CLIENT_ID') && env('GCP_SA_KEY'), 'Google Cloud sign-in is not set up on this OpsSwipe server.');
      // The app checks it comes back unchanged; it also carries the Expo Go return address, if any.
      const state = withReturn(await newState(owner, 'google'), p.returnTo);
      return { url: consentUrl(state), state };
    }

    case 'gcp_projects':
      return { projects: await listProjects(await googleToken(owner)) };

    case 'gcp_vms': {
      const project = String(p.project ?? '');
      need(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project), 'Pick a project.');
      return { vms: await listVms(await googleToken(owner), project) };
    }

    case 'gcp_add': {
      const vm = { project: String(p.project ?? ''), zone: String(p.zone ?? ''), instance: String(p.instance ?? '') };
      const config = { ...vm, url: String(p.url ?? ''), ...(await chosenRepo(owner, p)) };
      try {
        validateTarget('gcp', config);
      } catch (e) {
        throw new UserError(`Check the details: ${(e as Error).message}.`);
      }
      const sa = platformSa();
      await grantReset(await googleToken(owner), vm, sa.client_email);
      // IAM changes take a few seconds to apply; the service is added either way.
      let vmStatus = 'pending';
      for (let i = 0; i < 3 && vmStatus === 'pending'; i++) {
        if (i) await sleep(3000);
        vmStatus = await getInstanceStatus(vm, sa).catch(() => 'pending');
      }
      const added = await addService(owner, String(p.name ?? vm.instance).toLowerCase(), 'gcp', config);
      return { ...added, vmStatus };
    }

    case 'register_push': {
      const token = String(p.token ?? '');
      need(/^Expo(nent)?PushToken\[[\w-]+\]$/.test(token), 'Not a push token.');
      await db.from('push_tokens').upsert({ token, owner });
      return { registered: true };
    }

    // Approval API tokens: shown once at creation; only a hash is kept.
    case 'agent_tokens': {
      const { data } = await db.from('agent_tokens').select('id, name, created_at, last_used_at')
        .eq('owner', owner).order('created_at');
      return { tokens: data ?? [], url: functionUrl('agent') };
    }

    case 'agent_token_create': {
      const name = String(p.name ?? '').trim();
      need(/^[\w .-]{1,40}$/.test(name), 'Name the agent (letters, numbers, spaces; up to 40).');
      const token = newToken();
      const { data, error } = await db.from('agent_tokens')
        .insert({ owner, name, token_hash: await hashToken(token) }).select('id, name').single();
      if (error) throw error;
      return { ...data, token, url: functionUrl('agent') };
    }

    case 'agent_token_revoke': {
      await db.from('agent_tokens').delete().eq('id', String(p.id ?? '')).eq('owner', owner);
      return { revoked: true };
    }

    // The human says no to an agent's proposal; the agent sees "declined".
    case 'decline': {
      const { data } = await db.from('incidents').select('id, context')
        .eq('id', String(p.incidentId ?? '')).in('owner', await ownersFor(owner)).eq('status', 'active')
        .maybeSingle();
      need(data, 'That proposal is no longer open.');
      await db.from('incidents').update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        context: { ...data!.context, declined: true },
      }).eq('id', data!.id);
      return { declined: true };
    }

    // A false alarm: close the card without running anything. Logged, so Activity shows who closed it.
    case 'dismiss': {
      const now = new Date().toISOString(); // recovered_at too: no "back up" push for a false alarm
      const { data } = await db.from('incidents').update({ status: 'resolved', resolved_at: now, recovered_at: now })
        .eq('id', String(p.incidentId ?? '')).in('owner', await ownersFor(owner)).eq('status', 'active')
        .select('id, target_server, context').maybeSingle();
      if (data) await db.from('incidents').update({ context: { ...data.context, dismissed: true } }).eq('id', data.id);
      need(data, 'That incident is no longer open.');
      await db.from('audit_log').insert({
        incident_id: data!.id,
        actor: owner,
        action: 'dismiss',
        target: data!.target_server,
        outcome: 'dismissed',
        detail: 'dismissed as a false alarm',
      });
      return { dismissed: true };
    }

    // The incident's PR diff, to read on the phone before swiping Merge.
    case 'pr_diff': {
      const { data } = await db.from('incidents').select('owner, context').eq('id', String(p.incidentId ?? ''))
        .in('owner', await ownersFor(owner)).maybeSingle();
      const pr = (data?.context as { pr?: PrRef } | undefined)?.pr;
      need(pr, 'This incident has no pull request.');
      return { files: await prFiles(pr!, await githubToken(data!.owner)) }; // the repo owner's GitHub
    }

    // Why it happened and how to prevent it, written once after the incident resolves, then kept.
    case 'postmortem': {
      const { data: inc } = await db.from('incidents').select().eq('id', String(p.incidentId ?? ''))
        .in('owner', await ownersFor(owner)).maybeSingle();
      need(inc, 'No such incident.');
      const ctx = inc!.context ?? {};
      if (ctx.postmortem) return { postmortem: ctx.postmortem };
      // Not outages: a false alarm, a declined agent proposal, an agent's own command.
      need(inc!.service_id && !ctx.dismissed && !ctx.declined, 'No postmortem: this was not an outage.');
      need(inc!.status === 'resolved', 'The postmortem is written once the incident is resolved.');
      const llm = aiLlm();
      need(llm, 'AI is switched off on this server, so there is no postmortem.');
      const service = inc!.service_id ? await getService(inc!.service_id) : null;
      const repo = service?.config.repo;
      const sha: string | undefined = ctx.live?.commit?.id;
      const token = repo ? await githubToken(inc!.owner).catch(() => null) : null;
      const diff = repo && sha && token
        ? (await commitFiles(repo, sha, service!.config.branch ?? 'main', token).catch(() => []))
          .map((f) => `--- ${f.path}\n${f.patch}`).join('\n').slice(0, 12_000)
        : undefined;
      const test = ctx.pr && token
        ? (await prFiles(ctx.pr, token).catch(() => [])).find((f) => /opsswipe-[0-9a-f]{7}\.test\./.test(f.file))
        : undefined;
      const { data: audit } = await db.from('audit_log').select('action, outcome, detail').eq('incident_id', inc!.id)
        .order('created_at');
      const end = inc!.recovered_at ?? inc!.resolved_at;
      const secs = end ? Math.round((Date.parse(end) - Date.parse(inc!.created_at)) / 1000) : null;
      const postmortem = await writePostmortem(llm!, {
        title: inc!.title,
        service: inc!.target_server,
        symptom: inc!.metric,
        downFor: secs === null ? null : `${Math.floor(secs / 60)}m ${secs % 60}s`,
        failing: (ctx.replay ?? []).map((r: { method: string; path: string; status: number }) => ({
          method: r.method,
          path: r.path,
          status: r.status,
        })),
        badCommit: sha ? { sha, message: ctx.live?.commit?.message, diff } : null,
        fixes: audit ?? [],
        regressionTest: test?.file ?? null,
      });
      await db.from('incidents').update({ context: { ...ctx, postmortem } }).eq('id', inc!.id);
      return { postmortem };
    }

    // Sign-out: this phone stops receiving this account's alerts.
    case 'unregister_push': {
      await db.from('push_tokens').delete().eq('token', String(p.token ?? '')).eq('owner', owner);
      return { unregistered: true };
    }

    // Manual fallback: the user ran the two gcloud commands themselves.
    case 'install_proof': {
      const s = await getService(String(p.serviceId ?? ''));
      need(s && s.owner === owner, 'Service not found.');
      const t = toTarget(s!);
      need(t.repo, 'Link a GitHub repo to this service first.');
      const token = await githubToken(owner);
      const base = t.branch ?? 'main';
      // Already there and current: the proof PR was merged (or the repo was re-linked after it); just
      // remember it and tick the checklist off. There but older: a PR brings it up to date.
      const [script, workflow] = await Promise.all([
        fileText(t.repo!, PROOF_SCRIPT_PATH, base, token),
        fileText(t.repo!, PROOF_WORKFLOW_PATH, base, token),
      ]);
      const on = `https://github.com/${t.repo}/actions/workflows/${PROOF_WORKFLOW_PATH.split('/').pop()}`;
      if (script === PROOF_SCRIPT && workflow?.includes(`${PROOF_SCRIPT_PATH} report`)) {
        await db.from('services').update({ config: { ...s!.config, proofPr: on } }).eq('id', s!.id);
        return { prUrl: on, installed: true };
      }
      const update = workflow !== null;
      const { url } = await openFilesPr({
        repo: t.repo!,
        branch: base,
        branchName: update ? 'opsswipe/update-proof' : 'opsswipe/add-proof',
        title: update
          ? 'Update OpsSwipe proof: locked-down containers, per-request results'
          : 'Add OpsSwipe proof: replay production failures on every PR',
        body: [
          'Adds a workflow that, on every pull request, runs your tests and replays the production requests',
          'that OpsSwipe saw fail (`.opsswipe/replays/`). OpsSwipe only lets you merge its fixes when every one',
          'of them now answers 2xx and the tests pass.',
          '',
          "Your PR's code runs only in containers: as a normal user, without the runner's environment or OIDC",
          'token; tests get no network, and the app runs on a network with no way out.',
          '',
          "No secrets needed: the run proves itself with GitHub's OIDC token. Check the install, test and start",
          `commands in \`${PROOF_WORKFLOW_PATH}\` before merging${
            update ? ' (this update resets them to the defaults)' : ''
          }.`,
        ].join('\n'),
        files: [
          { path: PROOF_SCRIPT_PATH, content: PROOF_SCRIPT },
          { path: PROOF_WORKFLOW_PATH, content: proofWorkflow(functionUrl('proof')) },
        ],
      }, token);
      // Remembered so the app's setup checklist can tick "proof" off.
      await db.from('services').update({ config: { ...s!.config, proofPr: url } }).eq('id', s!.id);
      return { prUrl: url };
    }

    // Link, change or unlink the repo of an existing service.
    case 'link_repo': {
      const s = await getService(String(p.serviceId ?? ''));
      need(s && s.owner === owner, 'Service not found.');
      const picked = (await chosenRepo(owner, { ...p, repo: p.repo ?? '' }))!;
      const { repo: _r, branch: _b, proofPr: _p, ...rest } = s!.config as Record<string, unknown>; // a new repo needs its own proof
      const config = { ...rest, ...picked };
      try {
        validateTarget(s!.provider, config);
      } catch (e) {
        throw new UserError(`Check the details: ${(e as Error).message}.`);
      }
      await db.from('services').update({ config }).eq('id', s!.id);
      return { config };
    }

    // Team (Pro): the owner shares a one-time code; whoever enters it can see and fix the owner's incidents
    // and is paged when one sits unanswered for 5 minutes. They never see services, keys or connections.
    case 'team': {
      const [{ data: mine }, { data: joined }] = await Promise.all([
        db.from('team_members').select('member').eq('owner', owner),
        db.from('team_members').select('owner').eq('member', owner),
      ]);
      const email = async (id: string) => (await db.auth.admin.getUserById(id)).data.user?.email ?? 'a teammate';
      return {
        members: await Promise.all((mine ?? []).map(async (m) => ({ id: m.member, email: await email(m.member) }))),
        teams: await Promise.all((joined ?? []).map(async (t) => ({ id: t.owner, email: await email(t.owner) }))),
      };
    }

    case 'team_invite': {
      need(await isTeam(owner), 'Teammates come with the Team plan. Upgrade in Settings → Plan.');
      await db.from('team_invites').delete().eq('owner', owner);
      const code = Array.from(
        crypto.getRandomValues(new Uint8Array(8)),
        (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32],
      )
        .join('');
      await db.from('team_invites').insert({ code, owner });
      return { code };
    }

    case 'team_join': {
      const code = String(p.code ?? '').trim().toUpperCase();
      const { data: invite } = await db.from('team_invites').delete().eq('code', code)
        .gt('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString()).select('owner').maybeSingle();
      need(invite, 'That code is not valid any more. Ask for a new one.');
      need(invite!.owner !== owner, 'That is your own invite code.');
      const { count } = await db.from('team_members').select('member', { count: 'exact', head: true })
        .eq('owner', invite!.owner);
      need((count ?? 0) < 10, 'That team is full (10 people). Ask the owner to make room.');
      await db.from('team_members').upsert({ owner: invite!.owner, member: owner });
      return { joined: true };
    }

    // The owner removes a teammate, or a teammate leaves.
    case 'team_remove': {
      const other = String(p.id ?? '');
      need(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(other), 'No such teammate.'); // goes into a filter
      await db.from('team_members').delete().or(
        `and(owner.eq.${owner},member.eq.${other}),and(owner.eq.${other},member.eq.${owner})`,
      );
      return { removed: true };
    }

    // The alert inbox: one private URL for the tools a team already runs. `rotate` replaces a leaked one.
    case 'alert_inbox': {
      if (!p.on) {
        await db.from('alert_inboxes').delete().eq('owner', owner);
        return { alertInbox: null };
      }
      const { data: had } = await db.from('alert_inboxes').select('key').eq('owner', owner).maybeSingle();
      const key = had && !p.rotate
        ? had.key
        : Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32])
          .join('');
      if (!had || p.rotate) await db.from('alert_inboxes').upsert({ owner, key });
      return { alertInbox: inboxUrl(key) };
    }

    // Public status page: an unguessable link that shows service names, up/down and uptime only.
    case 'status_page': {
      if (!p.on) {
        await db.from('status_pages').delete().eq('owner', owner);
        return { statusPage: null };
      }
      const { data: had } = await db.from('status_pages').select('slug').eq('owner', owner).maybeSingle();
      const slug = had?.slug ??
        Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32])
          .join('');
      if (!had) await db.from('status_pages').insert({ owner, slug });
      return { statusPage: statusPageUrl(slug) };
    }

    // Pro: when an incident opens, write the AI fix and let CI prove it before the engineer looks.
    case 'set_autofix': {
      const s = await getService(String(p.serviceId ?? ''));
      need(s && s.owner === owner, 'Service not found.');
      need(!p.on || s!.config.repo, 'Link the repo first: the fix is a pull request on it.');
      const { autofix: _a, ...rest } = s!.config;
      const config = p.on ? { ...rest, autofix: 'on' } : rest;
      await db.from('services').update({ config }).eq('id', s!.id);
      return { config };
    }

    case 'remove_service': {
      const s = await getService(String(p.serviceId ?? ''));
      need(s && s.owner === owner, 'Service not found.');
      const cleanup = s!.provider === 'gcp' ? await releaseVms(owner, [s!]) : [];
      await db.from('services').delete().eq('id', s!.id);
      await deleteSecret(s!.report_secret_id);
      await deleteSecret(s!.sentry_secret_id);
      return { removed: true, cleanup };
    }

    case 'disconnect': {
      const kind = ['github', 'render', 'google', 'railway', 'alerts', 'revenuecat'].includes(String(p.kind))
        ? p.kind as ConnectionKind
        : null;
      need(kind, 'Unknown connection.');
      // Without Google, OpsSwipe can't check you still control a VM, so its VMs go too (the app says so).
      let cleanup: string[] = [];
      if (kind === 'google') {
        const { data: vms } = await db.from('services').select('*').eq('owner', owner).eq('provider', 'gcp');
        cleanup = await releaseVms(owner, (vms ?? []) as Service[]);
        for (const v of (vms ?? []) as Service[]) {
          await db.from('services').delete().eq('id', v.id);
          await deleteSecret(v.report_secret_id);
          await deleteSecret(v.sentry_secret_id);
        }
      }
      await forgetConnection(owner, kind!);
      return { disconnected: kind, cleanup };
    }

    // Delete the account and everything it holds (Play policy: deletion inside the app). Google access
    // is revoked at Google; the GitHub App install is the user's to remove on GitHub.
    case 'delete_account': {
      const { data: vms } = await db.from('services').select('*').eq('owner', owner).eq('provider', 'gcp');
      await releaseVms(owner, (vms ?? []) as Service[]);
      for (const kind of ['google', 'github', 'render', 'railway', 'alerts', 'revenuecat'] as const) {
        await forgetConnection(owner, kind);
      }
      const { data: services } = await db.from('services').select('report_secret_id, sentry_secret_id')
        .eq('owner', owner);
      for (const s of services ?? []) {
        await deleteSecret(s.report_secret_id);
        await deleteSecret(s.sentry_secret_id);
      }
      // audit_log and usage key on the user id without a foreign key; audit rows would also block the
      // incidents' cascade. Everything else cascades from auth.users.
      await db.from('audit_log').delete().eq('actor', owner);
      await db.from('usage').delete().eq('actor', owner);
      const { error } = await db.auth.admin.deleteUser(owner);
      if (error) throw error;
      return { deleted: true };
    }

    default:
      throw new UserError('Unknown action.');
  }
}

Deno.serve(async (req) => {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return json(401, { error: 'unauthorized' });
  const { action, ...params } = await req.json().catch(() => ({}));
  try {
    // The phone's fix key (see _shared/fixKeys.ts). Enrolling one needs a sign-in from the last 15
    // minutes, so a lifted refresh token can't add its own key; the app asks to sign in again then.
    if (action === 'register_fix_key') {
      if (!validKey(params.key)) return json(400, { error: 'Not a fix key.' });
      if (!freshSignIn(token)) return json(403, { error: 'sign_in_again' });
      await registerFixKey(user.id, params.key);
      return json(200, { registered: true });
    }
    return json(200, await handle(user.id, String(action ?? ''), params));
  } catch (e) {
    if (e instanceof UserError || e instanceof GoogleError) return json(400, { error: e.message });
    console.error('connect', action, e);
    return json(502, { error: 'Something went wrong talking to the provider. Try again.' });
  }
});
