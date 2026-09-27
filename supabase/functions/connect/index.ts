// Connect: the signed-in user links GitHub, Render and their services from the app.
// Every action runs for the caller only (verified JWT). Keys go straight into Vault; the app gets
// back only non-secret info, plus each service's report secret exactly once, at creation.
import { db, env, json } from '../_shared/db.ts';
import { getInstanceStatus } from '../_shared/gcp.ts';
import { openFilesPr } from '../_shared/github.ts';
import { installUrl, listRepos, verifyInstallation } from '../_shared/githubApp.ts';
import { PROOF_SCRIPT, PROOF_SCRIPT_PATH, PROOF_WORKFLOW_PATH, proofWorkflow } from '../_shared/proofKit.ts';
import { getRenderService, listServices } from '../_shared/render.ts';
import {
  connection,
  deleteSecret,
  getService,
  githubToken,
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

async function handle(owner: string, action: string, p: Record<string, unknown>) {
  switch (action) {
    case 'status': {
      const [gh, rd] = await Promise.all([connection(owner, 'github'), connection(owner, 'render')]);
      return {
        github: { connected: !!gh?.installation_id, account: gh?.account ?? null, installUrl: installUrl() },
        render: { connected: !!rd?.secret_id },
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
      if (r.repo) Object.assign(config, { repo: r.repo, branch: r.branch ?? 'main' });
      return await addService(owner, String(p.name ?? r.name).toLowerCase(), 'render', config);
    }

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
      need(t.provider === 'render' && t.repo, 'This service has no GitHub repo.');
      const repo = (t as { repo: string }).repo;
      const url = await openFilesPr({
        repo,
        branch: (t as { branch?: string }).branch ?? 'main',
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
      return { prUrl: url };
    }

    case 'remove_service': {
      const s = await getService(String(p.serviceId ?? ''));
      need(s && s.owner === owner, 'Service not found.');
      await db.from('services').delete().eq('id', s!.id);
      await deleteSecret(s!.report_secret_id);
      return { removed: true };
    }

    case 'disconnect': {
      const kind = p.kind === 'github' || p.kind === 'render' ? p.kind : null;
      need(kind, 'Unknown connection.');
      const c = await connection(owner, kind!);
      await db.from('connections').delete().eq('owner', owner).eq('kind', kind!);
      await deleteSecret(c?.secret_id);
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
    if (e instanceof UserError) return json(400, { error: e.message });
    console.error('connect', action, e);
    return json(502, { error: 'Something went wrong talking to the provider. Try again.' });
  }
});
