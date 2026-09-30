// "Add a service" as one guided sheet: pick where it runs -> connect that provider if needed ->
// pick the service (Render) or project then VM (Google Cloud) -> confirm -> copy the report secret.
// Keys go straight to the server (Supabase Vault); the app never stores or shows them again.
import * as WebBrowser from 'expo-web-browser';
import {
  ArrowLeft,
  CaretDown,
  CaretRight,
  CheckCircle,
  Cloud,
  GoogleLogo,
  HardDrives,
  Key,
  Train,
  X,
} from 'phosphor-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ReportSetup } from './ReportSetup';
import { SearchList } from './SearchList';
import { Button, Chip, CopyRow } from './ui';
import { claimFrom, type ConnectStatus, type RailwayService, type GcpProject, type NewService, type RenderOption, type VmOption, connect } from './api';
import { appBase, appLink } from './env';
import { paramsOf } from './format';
import { TARGET, c, radius, space, type } from './theme';
import { RepoPicker } from './RepoPicker';

export type StartAt = 'provider' | 'renderKey' | 'google' | 'railway';
type Step = 'provider' | 'renderKey' | 'renderPick' | 'renderConfirm' | 'railway' | 'google' | 'project' | 'vm' | 'done';

type Props = {
  start: StartAt;
  status: ConnectStatus | null;
  existing: Set<string>; // Render service ids and GCP "project/zone/name" already added
  onClose: (changed: boolean) => void;
};

export function AddService({ start, status, existing, onClose }: Props) {
  // A connected Google account skips straight to picking a project: no second sign-in.
  const first: Step = start === 'google' && status?.google.connected ? 'project' : start;
  const [history, setHistory] = useState<Step[]>([first]);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderKey, setRenderKey] = useState('');
  const [renderOptions, setRenderOptions] = useState<RenderOption[] | null>(null);
  const [projects, setProjects] = useState<GcpProject[] | null>(null);
  const [project, setProject] = useState<GcpProject | null>(null);
  const [vms, setVms] = useState<VmOption[] | null>(null);
  const [vm, setVm] = useState<VmOption | null>(null);
  const [vmUrl, setVmUrl] = useState('');
  const [created, setCreated] = useState<(NewService & { vmStatus?: string; onVm?: boolean }) | null>(null);
  const [picked, setPicked] = useState<RenderOption | null>(null);
  const [repo, setRepo] = useState<string | null>(null); // linked GitHub repo, or none
  const [railway, setRailway] = useState({ token: '', link: '', url: '', name: '' });
  // Connect Railway (OAuth): the shared projects' services to pick from, and the one picked.
  const [rwServices, setRwServices] = useState<RailwayService[] | null>(null);
  const [rwPick, setRwPick] = useState<{ s: RailwayService; env: string } | null>(null);
  const [pasteToken, setPasteToken] = useState(false);
  const github = !!status?.github.connected;

  const step = history[history.length - 1];
  const go = (s: Step) => {
    setError(null);
    setHistory((h) => [...h, s]);
  };
  const back = () => {
    setError(null);
    setHistory((h) => h.slice(0, -1));
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const loadRender = () =>
    run('render', async () => {
      setRenderOptions((await connect<{ services: RenderOption[] }>('render_services')).services);
    });
  const loadProjects = () =>
    run('projects', async () => {
      const r = await connect<{ projects: GcpProject[] }>('gcp_projects');
      setProjects([...r.projects].sort((a, b) => a.name.localeCompare(b.name)));
    });

  useEffect(() => {
    // Opened on the project list: fetch it once on mount (a loading state, then the projects).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (first === 'project') loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseRender = () => {
    if (status?.render.connected) {
      go('renderPick');
      loadRender();
    } else go('renderKey');
  };
  const chooseGoogle = () => {
    if (status?.google.connected) {
      go('project');
      loadProjects();
    } else go('google');
  };

  const saveKey = () =>
    run('key', async () => {
      const r = await connect<{ services: RenderOption[] }>('render_key', { apiKey: renderKey.trim() });
      setRenderKey('');
      setRenderOptions(r.services);
      setChanged(true);
      go('renderPick');
    });

  // Render already knows the repo it deploys from; start from that, the user can change it.
  const pickRender = (o: RenderOption) => {
    setPicked(o);
    setRepo(o.repo ?? null);
    go('renderConfirm');
  };

  const addRender = () =>
    run('addrender', async () => {
      const detected = picked!.repo ?? null;
      setCreated(
        await connect<NewService>('add_render', {
          serviceId: picked!.id,
          // Unchanged: keep Render's repo and branch. Changed: the server checks GitHub can see it.
          ...(repo !== detected ? { repo: repo ?? '' } : {}),
        }),
      );
      setChanged(true);
      go('done');
    });

  const connectGoogle = () =>
    run('google', async () => {
      const { url, state } = await connect<{ url: string; state: string }>('gcp_start', { returnTo: appBase });
      const r = await WebBrowser.openAuthSessionAsync(url, appLink('connect'));
      if (r.type === 'success' && paramsOf(r.url).state && paramsOf(r.url).state !== state) {
        throw new Error('That Google sign-in did not match this request. Try again.');
      }
      const claimed = r.type === 'success' ? await claimFrom(r.url) : null;
      let list: GcpProject[];
      if (claimed?.projects) list = claimed.projects;
      else {
        // The link back got lost and the app's link handler claimed it, or it was closed early: look.
        try {
          list = (await connect<{ projects: GcpProject[] }>('gcp_projects')).projects;
        } catch {
          if (r.type !== 'success') return; // closed before finishing: nothing to do
          throw new Error('Google did not finish the sign-in. Try again.');
        }
      }
      setProjects([...list].sort((a, b) => a.name.localeCompare(b.name)));
      setChanged(true);
      go('project');
    });

  const pickProject = (p: GcpProject) =>
    run(`p-${p.id}`, async () => {
      setProject(p);
      setVm(null);
      setVms((await connect<{ vms: VmOption[] }>('gcp_vms', { project: p.id })).vms);
      go('vm');
    });

  const pickVm = (v: VmOption) => {
    setVm(v);
    setVmUrl(v.ip ? `http://${v.ip}/` : '');
  };

  const addVm = () =>
    run('addvm', async () => {
      setCreated(
        await connect<NewService & { vmStatus: string; onVm: boolean }>('gcp_add', {
          project: project!.id,
          zone: vm!.zone,
          instance: vm!.name,
          url: vmUrl.trim(),
          ...(repo ? { repo } : {}),
        }),
      );
      setChanged(true);
      go('done');
    });

  const loadRailway = () =>
    run('rwlist', async () => {
      const list = (await connect<{ services: RailwayService[] }>('railway_services')).services;
      setRwServices(list);
      if (list.length === 1) pickRailway(list[0]);
    });
  // The production environment when there is one, else the first; changeable below when there are several.
  const pickRailway = (s: RailwayService) =>
    setRwPick({ s, env: (s.environments.find((e) => e.name === 'production') ?? s.environments[0])?.id ?? '' });

  // Connect Railway: Railway's consent screen, where the user picks the projects OpsSwipe may use.
  const connectRailway = () =>
    run('rwconnect', async () => {
      const { url } = await connect<{ url: string }>('railway_start', { returnTo: appBase });
      const r = await WebBrowser.openAuthSessionAsync(url, appLink('connect'));
      if (r.type === 'success') await claimFrom(r.url);
      setChanged(true);
      // "Open OpsSwipe" on Railway's last page arrives through the app's link handler, which may still be claiming.
      const services = () => connect<{ services: RailwayService[] }>('railway_services');
      const list = (await services().catch(async (e) => {
        if (r.type === 'success') throw e;
        await new Promise((ok) => setTimeout(ok, 2000));
        return services();
      })).services;
      setRwServices(list);
      if (list.length === 1) pickRailway(list[0]);
    });

  // Railway: a service picked from Connect Railway, or a pasted token and the service's dashboard link (it
  // carries the project, service and environment ids); then the public URL to check.
  const addRailway = () =>
    run('addrailway', async () => {
      setCreated(
        await connect<NewService>('add_railway', {
          ...railway,
          ...(rwPick ? { projectId: rwPick.s.projectId, serviceId: rwPick.s.serviceId, environmentId: rwPick.env } : {}),
          token: railway.token.trim(),
          // Blank: the Railway service's own name, made a valid OpsSwipe name.
          name: railway.name.trim() ||
            (rwPick?.s.service ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40),
          ...(repo ? { repo } : {}),
        }),
      );
      setRailway({ token: '', link: '', url: '', name: '' });
      setChanged(true);
      go('done');
    });

  const titles: Record<Step, string> = {
    railway: 'Add a Railway service',
    provider: 'Add a service',
    renderKey: 'Connect Render',
    renderPick: 'Choose a Render service',
    renderConfirm: picked?.name ?? 'Confirm',
    google: 'Connect Google Cloud',
    project: 'Choose a project',
    vm: project?.name ?? 'Choose a VM',
    done: 'Service added',
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => onClose(changed)}>
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          {history.length > 1 && step !== 'done' ? (
            <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Back" style={styles.icon}>
              <ArrowLeft size={22} color={c.text} weight="bold" />
            </Pressable>
          ) : (
            <View style={styles.icon} />
          )}
          <Text style={[type.title, { flex: 1, textAlign: 'center' }]} numberOfLines={1} accessibilityRole="header">
            {titles[step]}
          </Text>
          <Pressable onPress={() => onClose(changed)} accessibilityRole="button" accessibilityLabel="Close" style={styles.icon}>
            <X size={22} color={c.text} weight="bold" />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {error && <Text style={[type.label, styles.error]} accessibilityLiveRegion="polite">{error}</Text>}

          {step === 'provider' && (
            <>
              <Text style={[type.body, { color: c.muted }]}>Where does it run?</Text>
              <Choice
                icon={Cloud}
                title="Render web service"
                body="Restart it, or roll back to the last good deploy."
                tag={status?.render.connected ? 'Connected' : undefined}
                onPress={chooseRender}
              />
              <Choice
                icon={Train}
                title="Railway service"
                body="Restart it, or roll back to the previous deployment."
                tag={status?.railway.connected ? 'Connected' : undefined}
                onPress={() => {
                  go('railway');
                  if (status?.railway.oauth) loadRailway();
                }}
              />
              <Choice
                icon={HardDrives}
                title="Google Cloud VM"
                body="Reboot a Compute Engine VM. OpsSwipe can reboot only the VMs you add."
                tag={status?.google.connected ? 'Connected' : undefined}
                onPress={chooseGoogle}
              />
            </>
          )}

          {step === 'renderKey' && (
            <>
              <Text style={[type.body, { color: c.muted }]}>
                In Render, open Account settings → API keys → Create API key, then paste it here. It is encrypted on the
                server and never shown again.
              </Text>
              <Field label="Render API key" value={renderKey} onChange={setRenderKey} placeholder="rnd_…" secure />
              <Button label={busy === 'key' ? 'Checking the key…' : 'Connect Render'} icon={Key} onPress={saveKey} />
            </>
          )}

          {step === 'renderPick' && (
            <>
              {busy === 'render' && <Loading text="Loading your Render services…" />}
              {renderOptions?.length === 0 && <Empty text="No web services on this Render account yet." />}
              {!!renderOptions?.length && (
                <SearchList
                  items={renderOptions}
                  text={(o) => `${o.name} ${o.repo ?? ''} ${o.url}`}
                  placeholder="Search services"
                  height={420}
                  render={(o) => {
                    const done = existing.has(o.id);
                    return (
                      <Pressable
                        key={o.id}
                        disabled={done || !!busy}
                        onPress={() => pickRender(o)}
                        accessibilityRole="button"
                        style={({ pressed }) => [styles.option, styles.inList, pressed && styles.pressed, done && { opacity: 0.6 }]}
                      >
                        <Cloud size={22} color={c.text} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={type.monoStrong}>{o.name}</Text>
                          <Text style={type.caption} numberOfLines={1}>{o.repo ?? o.url}</Text>
                        </View>
                        {done
                          ? <Chip label="Added" color={c.green} tint={c.greenTint} />
                          : <CaretRight size={18} color={c.muted} weight="bold" />}
                      </Pressable>
                    );
                  }}
                />
              )}
            </>
          )}

          {step === 'renderConfirm' && picked && (
            <View style={styles.confirm}>
              <Text style={type.caption} numberOfLines={1}>{picked.url}</Text>
              <RepoPicker value={repo} onChange={setRepo} githubConnected={github} />
              <Text style={type.caption}>
                OpsSwipe checks it every minute and can restart it or roll it back
                {repo ? `, and open revert or AI fix PRs on ${repo}` : ''}.
              </Text>
              <Button label={busy === 'addrender' ? 'Adding…' : `Add ${picked.name}`} onPress={addRender} />
            </View>
          )}

          {step === 'railway' && (
            <View style={styles.confirm}>
              {/* Connect Railway (OAuth) when the server offers it; a pasted token stays as the fallback. */}
              {!rwServices && !pasteToken && status?.railway.available && !status.railway.connected && (
                <>
                  <Button label={busy === 'rwconnect' ? 'Waiting for Railway…' : 'Connect Railway'} icon={Train} onPress={connectRailway} />
                  <Text style={type.caption}>
                    On Railway&apos;s page you choose which projects OpsSwipe may use. Nothing else in your account is shared.
                  </Text>
                  <Pressable onPress={() => setPasteToken(true)} hitSlop={8} accessibilityRole="button">
                    <Text style={[type.label, { color: c.muted }]}>Or paste an API token</Text>
                  </Pressable>
                </>
              )}
              {busy === 'rwlist' && <Loading text="Loading your Railway services…" />}
              {rwServices?.length === 0 && (
                <Empty text="No services in the projects you shared. Connect again and pick the project on Railway's page." />
              )}
              {!!rwServices?.length && (
                <SearchList
                  items={rwServices}
                  text={(s) => `${s.project} ${s.service}`}
                  placeholder="Search services"
                  render={(s) => {
                    const on = rwPick?.s.serviceId === s.serviceId;
                    return (
                      <Pressable
                        key={s.serviceId}
                        onPress={() => pickRailway(s)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        style={[styles.option, styles.inList, on && styles.optionOn]}
                      >
                        <Train size={22} color={on ? c.green : c.text} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={type.monoStrong}>{s.service}</Text>
                          <Text style={type.caption}>{s.project}</Text>
                        </View>
                      </Pressable>
                    );
                  }}
                />
              )}
              {rwPick && rwPick.s.environments.length > 1 && (
                <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
                  {rwPick.s.environments.map((e) => (
                    <Pressable key={e.id} onPress={() => setRwPick({ ...rwPick, env: e.id })} accessibilityRole="radio"
                      accessibilityState={{ selected: rwPick.env === e.id }}>
                      <Chip label={e.name} color={rwPick.env === e.id ? c.green : c.muted} tint={rwPick.env === e.id ? c.greenTint : c.surface2} />
                    </Pressable>
                  ))}
                </View>
              )}
              {/* The pasted-token way: when chosen, when connected with a token, or when OAuth isn't set up. */}
              {!rwServices && (pasteToken || !status?.railway.available || (status.railway.connected && !status.railway.oauth)) && (
                <>
                  {!status?.railway.connected && (
                    <Field
                      label="Railway API token"
                      value={railway.token}
                      onChange={(v) => setRailway((r) => ({ ...r, token: v }))}
                      placeholder="Account settings → Tokens"
                      secure
                    />
                  )}
                  <Field
                    label="Service link"
                    value={railway.link}
                    onChange={(v) => setRailway((r) => ({ ...r, link: v }))}
                    placeholder="railway.com/project/…/service/…?environmentId=…"
                  />
                  <Text style={type.caption}>Open the service in the Railway dashboard and copy the address bar.</Text>
                </>
              )}
              {(rwPick || (!rwServices && (pasteToken || !status?.railway.available || (status?.railway.connected && !status.railway.oauth)))) && (
                <>
                  <Field
                    label="Public URL to check"
                    value={railway.url}
                    onChange={(v) => setRailway((r) => ({ ...r, url: v }))}
                    placeholder="https://api.up.railway.app/health"
                  />
                  <Field label="Name" value={railway.name} onChange={(v) => setRailway((r) => ({ ...r, name: v }))} placeholder={rwPick?.s.service ?? 'api'} />
                  <RepoPicker value={repo} onChange={setRepo} githubConnected={github} />
                  <Text style={type.caption}>
                    OpsSwipe checks it every minute and can restart it or roll it back
                    {repo ? `, and open revert or AI fix PRs on ${repo}` : ''}. Railway access is encrypted on the server.
                  </Text>
                  <Button label={busy === 'addrailway' ? 'Checking with Railway…' : 'Add service'} icon={Train} onPress={addRailway} />
                </>
              )}
            </View>
          )}

          {step === 'google' && <GoogleConnect busy={busy === 'google'} onConnect={connectGoogle} identity={status?.gcpIdentity ?? null} />}

          {step === 'project' && (
            <>
              {status?.google.account && <Text style={type.caption}>Google Cloud · {status.google.account}</Text>}
              {busy === 'projects' && <Loading text="Loading your projects…" />}
              {projects?.length === 0 && <Empty text="No active projects on this Google account." />}
              {!!projects?.length && (
                <SearchList
                  items={projects}
                  text={(p) => `${p.name} ${p.id}`}
                  placeholder="Search projects"
                  height={420}
                  render={(p) => (
                    <Pressable
                      key={p.id}
                      disabled={!!busy}
                      onPress={() => pickProject(p)}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.option, styles.inList, pressed && styles.pressed]}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={type.body}>{p.name}</Text>
                        <Text style={type.monoCaption}>{p.id}</Text>
                      </View>
                      {busy === `p-${p.id}` ? <ActivityIndicator color={c.green} /> : <CaretRight size={18} color={c.muted} weight="bold" />}
                    </Pressable>
                  )}
                />
              )}
            </>
          )}

          {step === 'vm' && (
            <>
              {vms?.length === 0 && <Empty text="No VMs in this project. Pick another project." />}
              {!!vms?.length && (
                <SearchList
                  items={vms}
                  text={(v) => `${v.name} ${v.zone} ${v.ip ?? ''}`}
                  placeholder="Search VMs"
                  render={(v) => {
                    const done = existing.has(`${project?.id}/${v.zone}/${v.name}`);
                    const on = vm?.name === v.name && vm.zone === v.zone;
                    return (
                      <Pressable
                        key={`${v.zone}/${v.name}`}
                        disabled={done}
                        onPress={() => pickVm(v)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on, disabled: done }}
                        style={[styles.option, styles.inList, on && styles.optionOn, done && { opacity: 0.6 }]}
                      >
                        <HardDrives size={22} color={on ? c.green : c.text} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={type.monoStrong}>{v.name}</Text>
                          <Text style={type.caption}>{v.zone} · {v.ip ?? 'no public IP'}</Text>
                        </View>
                        {done
                          ? <Chip label="Added" color={c.green} tint={c.greenTint} />
                          : <Chip label={v.status} color={v.status === 'RUNNING' ? c.green : c.muted} tint={v.status === 'RUNNING' ? c.greenTint : c.surface2} />}
                      </Pressable>
                    );
                  }}
                />
              )}
              {vm && (
                <View style={styles.confirm}>
                  <Field label="URL to health-check" value={vmUrl} onChange={setVmUrl} placeholder="http://34.1.2.3/" />
                  <RepoPicker value={repo} onChange={setRepo} githubConnected={github} />
                  <Text style={type.caption}>
                    OpsSwipe gets one custom role on {vm.name}: see its status and reboot it. Nothing else in the project.
                    {repo ? ` With ${repo} linked, it can also open revert and AI fix PRs.` : ''}
                  </Text>
                  <Button label={busy === 'addvm' ? 'Granting access…' : `Add ${vm.name}`} onPress={addVm} />
                </View>
              )}
            </>
          )}

          {step === 'done' && created && (
            <>
              <View style={styles.success}>
                <CheckCircle size={40} color={c.green} weight="fill" />
                <Text style={type.title}>{created.service.name} is being watched</Text>
                <Text style={[type.body, { color: c.muted, textAlign: 'center' }]}>
                  A health check already runs every minute, so you&apos;re covered. Failure reports from your app are optional
                  for alerts, and needed for Revert and Fix with AI (CI replays those requests).
                </Text>
              </View>
              <ReportSetup report={created.report} service={created.service} onVm={created.onVm} />
              {created.vmStatus === 'pending' && (
                <Text style={type.caption}>Google is still applying access; reboots work within a minute.</Text>
              )}
              <Button label="Done" onPress={() => onClose(true)} />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function GoogleConnect({ busy, onConnect, identity }: { busy: boolean; onConnect: () => void; identity: string | null }) {
  const [manual, setManual] = useState(false);
  return (
    <>
      <Text style={[type.body, { color: c.muted }]}>
        Sign in with Google once. You can then add VMs from any of your projects. For each VM you add, OpsSwipe gives its
        own identity one custom role on that VM (see its status, reboot it), nothing else. Disconnect anytime in Services.
      </Text>
      <Button label={busy ? 'Opening Google…' : 'Continue with Google'} icon={GoogleLogo} onPress={onConnect} />
      <Pressable
        onPress={() => setManual(!manual)}
        accessibilityRole="button"
        accessibilityState={{ expanded: manual }}
        style={styles.disclosure}
      >
        {manual ? <CaretDown size={16} color={c.muted} weight="bold" /> : <CaretRight size={16} color={c.muted} weight="bold" />}
        <Text style={[type.label, { color: c.muted }]}>Prefer not to sign in? Grant access with gcloud</Text>
      </Pressable>
      {manual && (
        identity
          ? (
            <CopyRow
              label="Run in Google Cloud Shell (replace the VM, zone and project)"
              value={`gcloud iam roles create opsswipeReset --project PROJECT --title "OpsSwipe reset" --permissions compute.instances.reset,compute.instances.get\n\ngcloud compute instances add-iam-policy-binding VM --zone ZONE --member serviceAccount:${identity} --role projects/PROJECT/roles/opsswipeReset`}
            />
          )
          : <Text style={type.caption}>Google Cloud is not set up on this OpsSwipe server yet.</Text>
      )}
    </>
  );
}

function Choice(p: { icon: typeof Cloud; title: string; body: string; tag?: string; onPress: () => void }) {
  return (
    <Pressable onPress={p.onPress} accessibilityRole="button" style={({ pressed }) => [styles.choice, pressed && styles.pressed]}>
      <View style={styles.choiceIcon}>
        <p.icon size={26} color={c.green} weight="duotone" />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={[type.body, { fontWeight: '600' }]}>{p.title}</Text>
          {p.tag && <Chip label={p.tag} color={c.green} tint={c.greenTint} />}
        </View>
        <Text style={type.caption}>{p.body}</Text>
      </View>
      <CaretRight size={18} color={c.muted} weight="bold" />
    </Pressable>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={c.green} />
      <Text style={type.caption}>{text}</Text>
    </View>
  );
}

const Empty = ({ text }: { text: string }) => <Text style={[type.body, { color: c.muted, paddingVertical: space.lg }]}>{text}</Text>;



function Field(f: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; secure?: boolean }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={type.label}>{f.label}</Text>
      <TextInput
        value={f.value}
        onChangeText={f.onChange}
        placeholder={f.placeholder}
        placeholderTextColor={c.muted}
        secureTextEntry={f.secure}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        accessibilityLabel={f.label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg, paddingHorizontal: space.lg },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  icon: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  body: { gap: space.md, paddingTop: space.sm, paddingBottom: space.xxl },
  pressed: { opacity: 0.8 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
  },
  choiceIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.control,
    backgroundColor: c.greenTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 64,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.card,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
  },
  optionOn: { borderColor: c.green, backgroundColor: c.greenTint },
  // Inside a SearchList the list has the border; rows are separated by a line.
  inList: { borderRadius: 0, borderWidth: 0, borderBottomWidth: 1 },
  confirm: { gap: space.md, padding: space.lg, borderRadius: radius.card, backgroundColor: c.surface, marginTop: space.sm },
  success: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  loading: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.lg },
  input: {
    minHeight: 52,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    paddingHorizontal: space.lg,
    color: c.text,
    fontFamily: 'GeistMono',
    fontSize: 14,
  },
  error: { color: c.red, backgroundColor: c.redTint, borderRadius: radius.control, padding: space.md },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: TARGET },
});
