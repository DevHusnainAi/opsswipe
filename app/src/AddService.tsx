// "Add a service" as one guided sheet: pick where it runs -> connect that provider if needed ->
// pick the service (Render) or project then VM (Google Cloud) -> confirm -> copy the report secret.
// Keys go straight to the server (Supabase Vault); the app never stores or shows them again.
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import {
  ArrowLeft,
  CaretDown,
  CaretRight,
  Check,
  CheckCircle,
  Cloud,
  Copy,
  GoogleLogo,
  HardDrives,
  Key,
  X,
} from 'phosphor-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type ConnectStatus, type GcpProject, type NewService, type RenderOption, type VmOption, connect } from './api';
import { appBase, appLink } from './env';
import { paramsOf } from './format';
import { TARGET, c, radius, space, type } from './theme';
import { RepoPicker } from './RepoPicker';
import { Button, Chip } from './ui';

export type StartAt = 'provider' | 'renderKey' | 'google';
type Step = 'provider' | 'renderKey' | 'renderPick' | 'renderConfirm' | 'google' | 'project' | 'vm' | 'done';

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
  const [created, setCreated] = useState<(NewService & { vmStatus?: string }) | null>(null);
  const [picked, setPicked] = useState<RenderOption | null>(null);
  const [repo, setRepo] = useState<string | null>(null); // linked GitHub repo, or none
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
      if (r.type !== 'success') return;
      const q = paramsOf(r.url);
      if (q.state !== state) throw new Error('That Google sign-in did not match this request. Try again.');
      if (!q.code) throw new Error(q.error === 'access_denied' ? 'Google access was not allowed.' : 'Google did not finish the sign-in.');
      const res = await connect<{ projects: GcpProject[] }>('gcp_complete', { code: q.code });
      setProjects([...res.projects].sort((a, b) => a.name.localeCompare(b.name)));
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
        await connect<NewService & { vmStatus: string }>('gcp_add', {
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

  const titles: Record<Step, string> = {
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
                icon={HardDrives}
                title="Google Cloud VM"
                body="Reset a Compute Engine VM. OpsSwipe can reset only the VMs you add."
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
              {renderOptions?.map((o) => {
                const done = existing.has(o.id);
                return (
                  <Pressable
                    key={o.id}
                    disabled={done || !!busy}
                    onPress={() => pickRender(o)}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.option, pressed && styles.pressed, done && { opacity: 0.6 }]}
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
              })}
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

          {step === 'google' && <GoogleConnect busy={busy === 'google'} onConnect={connectGoogle} identity={status?.gcpIdentity ?? null} />}

          {step === 'project' && (
            <>
              {status?.google.account && <Text style={type.caption}>Google Cloud · {status.google.account}</Text>}
              {busy === 'projects' && <Loading text="Loading your projects…" />}
              {projects?.length === 0 && <Empty text="No active projects on this Google account." />}
              {projects?.map((p) => (
                <Pressable
                  key={p.id}
                  disabled={!!busy}
                  onPress={() => pickProject(p)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={type.body}>{p.name}</Text>
                    <Text style={type.monoCaption}>{p.id}</Text>
                  </View>
                  {busy === `p-${p.id}` ? <ActivityIndicator color={c.green} /> : <CaretRight size={18} color={c.muted} weight="bold" />}
                </Pressable>
              ))}
            </>
          )}

          {step === 'vm' && (
            <>
              {vms?.length === 0 && <Empty text="No VMs in this project. Pick another project." />}
              {vms?.map((v) => {
                const done = existing.has(`${project?.id}/${v.zone}/${v.name}`);
                const on = vm?.name === v.name && vm.zone === v.zone;
                return (
                  <Pressable
                    key={`${v.zone}/${v.name}`}
                    disabled={done}
                    onPress={() => pickVm(v)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on, disabled: done }}
                    style={[styles.option, on && styles.optionOn, done && { opacity: 0.6 }]}
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
              })}
              {vm && (
                <View style={styles.confirm}>
                  <Field label="URL to health-check" value={vmUrl} onChange={setVmUrl} placeholder="http://34.1.2.3/" />
                  <RepoPicker value={repo} onChange={setRepo} githubConnected={github} />
                  <Text style={type.caption}>
                    OpsSwipe gets one custom role on {vm.name}: see its status and reset it. Nothing else in the project.
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
                  A health check already runs every minute, so you&apos;re covered. Optional, for alerts within seconds: set
                  these two values on your app and add the snippet. The secret is shown only once.
                </Text>
              </View>
              <CopyRow label="OPSSWIPE_REPORT_URL" value={created.report.url} />
              <CopyRow label="REPORT_SECRET" value={created.report.secret} />
              <CopyRow label="Snippet (Express)" value={REPORT_SNIPPET} lines={14} />
              <Text style={type.caption}>
                Set GIT_SHA to the deployed commit so a revert or AI fix targets exactly the release that broke. Other
                stacks: sign the JSON body with HMAC-SHA256 the same way (see Failure reports in the README).
              </Text>
              {created.vmStatus === 'pending' && (
                <Text style={type.caption}>Google is still applying access; resets work within a minute.</Text>
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
        own identity one custom role on that VM (see its status, reset it), nothing else. Disconnect anytime in Services.
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

const REPORT_SNIPPET = `// Express, Node 18+: report every 5xx to OpsSwipe (method, path, status only)
const { createHmac } = require('node:crypto');
app.use((req, res, next) => {
  res.on('finish', () => {
    const { OPSSWIPE_REPORT_URL: url, REPORT_SECRET: key, GIT_SHA } = process.env;
    if (res.statusCode < 500 || !url || !key) return;
    const body = JSON.stringify({ method: req.method, path: req.originalUrl, status: res.statusCode, release: GIT_SHA });
    const sig = 'sha256=' + createHmac('sha256', key).update(body).digest('hex');
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-opsswipe-signature': sig }, body }).catch(() => {});
  });
  next();
});`;

export function CopyRow({ label, value, lines = 4 }: { label: string; value: string; lines?: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <View style={styles.copy}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.caption}>{label}</Text>
        <Text style={[type.mono, lines > 4 && { fontSize: 11, lineHeight: 15 }]} selectable numberOfLines={lines}>{value}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Copy ${label}`}
        onPress={async () => {
          await Clipboard.setStringAsync(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        style={styles.icon}
      >
        {copied ? <Check size={18} color={c.green} weight="bold" /> : <Copy size={18} color={c.text} weight="bold" />}
      </Pressable>
    </View>
  );
}

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
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: c.surface,
    borderRadius: radius.control,
    padding: space.md,
  },
  error: { color: c.red, backgroundColor: c.redTint, borderRadius: radius.control, padding: space.md },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: TARGET },
});
