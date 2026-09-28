// Connect: the signed-in user links GitHub, Render and their services from the app.
// Every action runs for the caller only (verified JWT). Keys go straight into Vault; the app gets
// back only non-secret info, plus each service's report secret exactly once, at creation.
import { hashToken, newToken } from '../_shared/agents.ts';
import { withReturn } from '../_shared/appLink.ts';
import { db, env, json } from '../_shared/db.ts';
import { getInstanceStatus } from '../_shared/gcp.ts';
import { consentUrl, exchangeCode, GoogleError, grantReset, listProjects, listVms } from '../_shared/google.ts';
import { openFilesPr } from '../_shared/github.ts';
import { installUrl, listRepos, verifyInstallation } from '../_shared/githubApp.ts';
import { PROOF_SCRIPT, PROOF_SCRIPT_PATH, PROOF_WORKFLOW_PATH, proofWorkflow } from '../_shared/proofKit.ts';
import { getRenderService, listServices } from '../_shared/render.ts';
import {
  connection,
  deleteSecret,
  forgetConnection,
  getService,
  githubToken,
  googleToken,
  platformSa,
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

async function addService(owner: string, name: string, provider: 'gcp' | 'render', config: Record<string, string>) {
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
      const [gh, rd, gc] = await Promise.all([
        connection(owner, 'github'),
        connection(owner, 'render'),
        connection(owner, 'google'),
      ]);
      // GitHub hands `state` back to oauth-callback, which uses it to return to Expo Go if needed.
      const state = withReturn('gh', p.returnTo);
      return {
        github: {
          connected: !!gh?.installation_id,
          account: gh?.account ?? null,
          installUrl: state === 'gh' ? installUrl() : `${installUrl()}?state=${state}`,
        },
        render: { connected: !!rd?.secret_id },
        google: { connected: !!gc?.secret_id, account: gc?.account ?? null, available: !!env('GOOGLE_CLIENT_ID') },
        gcpIdentity: env('GCP_SA_KEY') ? platformSa().client_email : null,
      };
    }

    case 'github_complete': {
      const code = String(p.code ?? '');
      const installationId = Number(p.installationId);
      need(code && Number.isInteger(installationId), 'GitHub did not send an installation.');
      const account = await verifyInstallation(code, installationId);
      await db.from('connections').upsert({ owner, kind: 'github', installation_id: installationId, account });
      return { github: { connected: true, account } };
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
      const state = withReturn(randomSecret().slice(0, 32), p.returnTo);
      return { url: consentUrl(state), state };
    }

    case 'gcp_complete': {
      const code = String(p.code ?? '');
      need(code, 'Google did not finish the sign-in.');
      const { access, refresh, email } = await exchangeCode(code);
      const old = await connection(owner, 'google');
      await db.from('connections').upsert({
        owner,
        kind: 'google',
        secret_id: await storeSecret(refresh),
        account: email,
      });
      await deleteSecret(old?.secret_id);
      return { google: { connected: true, account: email }, projects: await listProjects(access) };
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
      return { removed: true };
    }

    case 'disconnect': {
      const kind = p.kind === 'github' || p.kind === 'render' || p.kind === 'google' ? p.kind : null;
      need(kind, 'Unknown connection.');
      await forgetConnection(owner, kind!);
      return { disconnected: kind };
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
