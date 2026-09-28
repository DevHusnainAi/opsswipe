// Connect: the signed-in user links GitHub, Render and their services from the app.
// Every action runs for the caller only (verified JWT). Keys go straight into Vault; the app gets
// back only non-secret info, plus each service's report secret exactly once, at creation.
import { hashToken, newToken } from '../_shared/agents.ts';
import { alertKind, postAlert } from '../_shared/alerts.ts';
import { withReturn } from '../_shared/appLink.ts';
import { db, env, json } from '../_shared/db.ts';
import { getInstanceStatus } from '../_shared/gcp.ts';
import { consentUrl, GoogleError, grantReset, listProjects, listVms } from '../_shared/google.ts';
import { openFilesPr } from '../_shared/github.ts';
import { authorizeUrl, installUrl, listRepos } from '../_shared/githubApp.ts';
import { completeGithub, completeGoogle, newState } from '../_shared/oauthState.ts';
import { PROOF_SCRIPT, PROOF_SCRIPT_PATH, PROOF_WORKFLOW_PATH, proofWorkflow } from '../_shared/proofKit.ts';
import { idsFromLink, listDeployments } from '../_shared/railway.ts';
import { RevenueError, revenuePerHour } from '../_shared/revenue.ts';
import { getRenderService, listServices } from '../_shared/render.ts';
import {
  connection,
  type ConnectionKind,
  deleteSecret,
  forgetConnection,
  getService,
  githubToken,
  googleToken,
  platformSa,
  railwayToken,
  renderKey,
  storeSecret,
  toTarget,
} from '../_shared/services.ts';
import { validateTarget } from '../_shared/targets.ts';

const functionUrl = (name: string) => `${env('SUPABASE_URL')}/functions/v1/${name}`;
const randomSecret = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

class UserError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const need = (ok: unknown, message: string) => {
  if (!ok) throw new UserError(message);
};

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
      // The install link with a one-time state comes from github_start; this is the plain one.
      return {
        github: {
          connected: !!gh?.installation_id,
          account: gh?.account ?? null,
          installUrl: installUrl(),
        },
        render: { connected: !!rd?.secret_id },
        railway: { connected: !!rw?.secret_id },
        alerts: { connected: !!al?.secret_id, kind: al?.account ?? null },
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

    case 'github_complete': {
      const code = String(p.code ?? '');
      const installationId = Number(p.installationId);
      need(code && Number.isInteger(installationId), 'GitHub did not send an installation.');
      return { github: { connected: true, account: (await completeGithub(owner, code, installationId)).account } };
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

    // Discord or Slack as a second alert channel. A test message proves the URL works before it's kept.
    case 'set_alerts': {
      const url = String(p.url ?? '').trim();
      const old = await connection(owner, 'alerts');
      if (!url) {
        await forgetConnection(owner, 'alerts');
        return { alerts: { connected: false } };
      }
      const kind = alertKind(url);
      need(
        kind,
        'Paste a Discord or Slack incoming webhook URL (https://discord.com/api/webhooks/… or https://hooks.slack.com/services/…).',
      );
      await postAlert(url, {
        title: 'OpsSwipe alerts are on',
        body: 'Incidents, recoveries and proven fixes will post here.',
      })
        .catch(() => {
          throw new UserError(`${kind === 'discord' ? 'Discord' : 'Slack'} rejected that webhook URL.`);
        });
      const secretId = await storeSecret(url);
      await db.from('connections').upsert({ owner, kind: 'alerts', secret_id: secretId, account: kind });
      await deleteSecret(old?.secret_id);
      return { alerts: { connected: true, kind } };
    }

    // Revenue at risk: the user's own RevenueCat v2 secret key (Charts & Metrics read) and project id.
    // One test read proves both before anything is stored.
    case 'set_revenuecat': {
      const key = String(p.key ?? '').trim();
      const projectId = String(p.projectId ?? '').trim();
      need(/^sk_\w{10,}$/.test(key), "That doesn't look like a RevenueCat secret key (it starts with sk_).");
      need(/^[\w-]{3,64}$/.test(projectId), 'Paste the project id from RevenueCat → Project settings.');
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

    case 'gcp_complete': {
      const code = String(p.code ?? '');
      need(code, 'Google did not finish the sign-in.');
      const g = await completeGoogle(owner, code);
      return { google: { connected: true, account: g.email }, projects: await g.projects() };
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
        .eq('id', String(p.incidentId ?? '')).eq('owner', owner).eq('status', 'active').maybeSingle();
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
        .eq('id', String(p.incidentId ?? '')).eq('owner', owner).eq('status', 'active')
        .select('id, target_server').maybeSingle();
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

    // Sign-out: this phone stops receiving this account's alerts.
    case 'unregister_push': {
      await db.from('push_tokens').delete().eq('token', String(p.token ?? '')).eq('owner', owner);
      return { unregistered: true };
    }

    // Manual fallback: the user ran the two gcloud commands themselves.
    case 'add_gcp': {
      const config = {
        project: String(p.project ?? ''),
        zone: String(p.zone ?? ''),
        instance: String(p.instance ?? ''),
        url: String(p.url ?? ''),
      };
      try {
        validateTarget('gcp', config);
      } catch (e) {
        throw new UserError(`Check the details: ${(e as Error).message}.`);
      }
      // Proves the two commands were run: OpsSwipe can now see (and only reset) this VM.
      const status = await getInstanceStatus(config, platformSa()).catch((e) => {
        throw new UserError((e as Error).message);
      });
      return { ...(await addService(owner, String(p.name ?? config.instance), 'gcp', config)), vmStatus: status };
    }

    case 'install_proof': {
      const s = await getService(String(p.serviceId ?? ''));
      need(s && s.owner === owner, 'Service not found.');
      const t = toTarget(s!);
      need(t.repo, 'Link a GitHub repo to this service first.');
      const { url } = await openFilesPr({
        repo: t.repo!,
        branch: t.branch ?? 'main',
        branchName: 'opsswipe/add-proof',
        title: 'Add OpsSwipe proof: replay production failures on every PR',
        body: [
          'Adds a workflow that, on every pull request, runs your tests and replays the production requests',
          'that OpsSwipe saw fail (`.opsswipe/replays/`). OpsSwipe only lets you merge its fixes when they pass.',
          '',
          "No secrets needed: the run proves itself with GitHub's OIDC token. Check the install, test and start",
          `commands in \`${PROOF_WORKFLOW_PATH}\` before merging.`,
        ].join('\n'),
        files: [
          { path: PROOF_SCRIPT_PATH, content: PROOF_SCRIPT },
          { path: PROOF_WORKFLOW_PATH, content: proofWorkflow(functionUrl('proof')) },
        ],
      }, await githubToken(owner));
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

    case 'remove_service': {
      const s = await getService(String(p.serviceId ?? ''));
      need(s && s.owner === owner, 'Service not found.');
      await db.from('services').delete().eq('id', s!.id);
      await deleteSecret(s!.report_secret_id);
      await deleteSecret(s!.sentry_secret_id);
      return { removed: true };
    }

    case 'disconnect': {
      const kind = ['github', 'render', 'google', 'railway', 'alerts', 'revenuecat'].includes(String(p.kind))
        ? p.kind as ConnectionKind
        : null;
      need(kind, 'Unknown connection.');
      await forgetConnection(owner, kind!);
      return { disconnected: kind };
    }

    // Delete the account and everything it holds (Play policy: deletion inside the app). Google access
    // is revoked at Google; the GitHub App install is the user's to remove on GitHub.
    case 'delete_account': {
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
    return json(200, await handle(user.id, String(action ?? ''), params));
  } catch (e) {
    if (e instanceof UserError || e instanceof GoogleError) return json(400, { error: e.message });
    console.error('connect', action, e);
    return json(502, { error: 'Something went wrong talking to the provider. Try again.' });
  }
});
