// Connect: your account, GitHub, Render and Google Cloud, and the services OpsSwipe watches and fixes.
// Keys go straight to the server (Supabase Vault); the app never stores or shows them again.
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { CaretDown, CaretRight, Check, Cloud, Copy, GithubLogo, GoogleLogo, HardDrives, Key, Plus, Trash, UserCircle, X } from 'phosphor-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  type ConnectStatus,
  type GcpProject,
  type NewService,
  type RenderOption,
  type Service,
  type VmOption,
  connect,
  supabase,
} from './api';
import { paramsOf } from './format';
import { TARGET, c, radius, space, type } from './theme';
import { Button, Chip, Section } from './ui';

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <View style={styles.copy}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.caption}>{label}</Text>
        <Text style={type.mono} selectable numberOfLines={3}>{value}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Copy ${label}`}
        onPress={async () => {
          await Clipboard.setStringAsync(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        style={styles.iconButton}
      >
        {copied ? <Check size={18} color={c.green} weight="bold" /> : <Copy size={18} color={c.text} weight="bold" />}
      </Pressable>
    </View>
  );
}

function Field(
  { label, value, onChange, placeholder, secure, hint }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    secure?: boolean;
    hint?: string;
  },
) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={type.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        accessibilityLabel={label}
      />
      {hint && <Text style={type.caption}>{hint}</Text>}
    </View>
  );
}

type Props = { visible: boolean; onClose: () => void; onSignIn: () => Promise<unknown> };
type Account = { guest: boolean; login: string | null };

export function Services({ visible, onClose, onSignIn }: Props) {
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [renderOptions, setRenderOptions] = useState<RenderOption[] | null>(null);
  const [renderKey, setRenderKey] = useState('');
  const [tab, setTab] = useState<'render' | 'gcp'>('render');
  const [gcp, setGcp] = useState({ project: '', zone: 'us-central1-a', instance: '', url: '' });
  const [account, setAccount] = useState<Account | null>(null);
  const [projects, setProjects] = useState<GcpProject[] | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [vms, setVms] = useState<VmOption[] | null>(null);
  const [vm, setVm] = useState<VmOption | null>(null);
  const [vmUrl, setVmUrl] = useState('');
  const [manual, setManual] = useState(false);
  const [created, setCreated] = useState<NewService | null>(null);
  const [notice, setNotice] = useState<{ text: string; url?: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [st, sv, me] = await Promise.all([
      connect<ConnectStatus>('status'),
      supabase.from('services').select('id, name, provider, config').order('created_at'),
      supabase.auth.getUser(),
    ]);
    setStatus(st);
    setServices(sv.data ?? []);
    const user = me.data.user;
    setAccount({ guest: !user || !!user.is_anonymous, login: user?.user_metadata?.user_name ?? null });
    if (st.google.connected) {
      connect<{ projects: GcpProject[] }>('gcp_projects').then((r) => setProjects(r.projects)).catch(() => {});
    }
    if (st.render.connected) {
      connect<{ services: RenderOption[] }>('render_services').then((r) => setRenderOptions(r.services)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    // Loads when the sheet opens; state is only set after the awaits inside load().
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (visible) load().catch((e) => setError(e.message));
  }, [visible, load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const connectGithub = () =>
    run('github', async () => {
      const r = await WebBrowser.openAuthSessionAsync(status!.github.installUrl, 'opsswipe://connect');
      if (r.type !== 'success') return;
      const q = paramsOf(r.url);
      if (!q.code || !q.installation_id) throw new Error('GitHub did not finish the install. Try again.');
      await connect('github_complete', { code: q.code, installationId: Number(q.installation_id) });
      await load();
    });

  const saveRenderKey = () =>
    run('render', async () => {
      const r = await connect<{ services: RenderOption[] }>('render_key', { apiKey: renderKey });
      setRenderKey('');
      setRenderOptions(r.services);
      await load();
    });

  const addRender = (o: RenderOption) =>
    run(o.id, async () => {
      setCreated(await connect<NewService>('add_render', { serviceId: o.id }));
      await load();
    });

  const addGcp = () =>
    run('gcp', async () => {
      setCreated(await connect<NewService>('add_gcp', gcp));
      await load();
    });

  const signIn = () =>
    run('signin', async () => {
      await onSignIn();
      await load();
    });

  const pickProject = (id: string) =>
    run('vms', async () => {
      setProject(id);
      setVm(null);
      setVms(null);
      setVms((await connect<{ vms: VmOption[] }>('gcp_vms', { project: id })).vms);
    });

  // Like installing a GitHub App: sign in with Google, pick a VM; the server grants itself reset on
  // that VM with your token, then deletes the token.
  const connectGoogle = () =>
    run('google', async () => {
      const { url, state } = await connect<{ url: string; state: string }>('gcp_start');
      const r = await WebBrowser.openAuthSessionAsync(url, 'opsswipe://connect');
      if (r.type !== 'success') return;
      const q = paramsOf(r.url);
      if (q.state !== state) throw new Error('That Google sign-in did not match this request. Try again.');
      if (!q.code) throw new Error(q.error === 'access_denied' ? 'Google access was not allowed.' : 'Google did not finish the sign-in.');
      const res = await connect<{ projects: GcpProject[] }>('gcp_complete', { code: q.code });
      setProjects(res.projects);
      setTab('gcp');
      await load();
      if (res.projects.length === 1) await pickProject(res.projects[0].id);
    });

  const chooseVm = (v: VmOption) => {
    setVm(v);
    setVmUrl(v.ip ? `http://${v.ip}/` : '');
  };

  const addVm = () =>
    run('addvm', async () => {
      const res = await connect<NewService & { vmStatus: string }>('gcp_add', {
        project,
        zone: vm!.zone,
        instance: vm!.name,
        url: vmUrl,
      });
      setCreated(res);
      if (res.vmStatus === 'pending') setNotice({ text: 'Access is being applied by Google; resets work within a minute.' });
      setProjects(null);
      setProject(null);
      setVms(null);
      setVm(null);
      await load();
    });

  const installProof = (s: Service) =>
    run(`proof-${s.id}`, async () => {
      const r = await connect<{ prUrl: string }>('install_proof', { serviceId: s.id });
      setNotice({ text: 'Proof workflow PR opened. Check its commands, then merge it.', url: r.prUrl });
    });

  const remove = (s: Service) => {
    if (confirmRemove !== s.id) return setConfirmRemove(s.id);
    setConfirmRemove(null);
    run(`rm-${s.id}`, async () => {
      await connect('remove_service', { serviceId: s.id });
      await load();
    });
  };

  const added = new Set(services.map((s) => s.config.serviceId));
  const p = gcp.project || '<project>';
  const commands = status?.gcpIdentity
    ? `gcloud iam roles create opsswipeReset --project ${p} --title "OpsSwipe reset" --permissions compute.instances.reset,compute.instances.get\n\ngcloud compute instances add-iam-policy-binding ${
      gcp.instance || '<vm-name>'
    } --zone ${gcp.zone || '<zone>'} --member serviceAccount:${status.gcpIdentity} --role projects/${p}/roles/opsswipeReset`
    : null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Text style={type.title} accessibilityRole="header">Services</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.iconButton}>
            <X size={20} color={c.text} weight="bold" />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: space.xxl, gap: space.sm }} keyboardShouldPersistTaps="handled">
          {error && <Text style={[type.label, styles.error]} accessibilityLiveRegion="polite">{error}</Text>}
          {notice && (
            <Pressable onPress={() => notice.url && Linking.openURL(notice.url)} style={styles.notice} accessibilityRole="link">
              <Text style={[type.label, { color: c.green }]}>{notice.text}{notice.url ? '  Open PR' : ''}</Text>
            </Pressable>
          )}

          {created && (
            <View style={styles.created}>
              <Text style={type.body}>
                <Text style={{ fontWeight: '600' }}>{created.service.name}</Text> is connected. Set these on its host so failures
                reach OpsSwipe the moment they happen. The secret is shown only once.
              </Text>
              <CopyRow label="OPSSWIPE_REPORT_URL" value={created.report.url} />
              <CopyRow label="REPORT_SECRET" value={created.report.secret} />
              <Button label="Done" kind="secondary" onPress={() => setCreated(null)} />
            </View>
          )}

          <Section title="Account">
            <View style={styles.group}>
              <View style={styles.row}>
                <UserCircle size={22} color={c.text} weight="bold" />
                <View style={{ flex: 1 }}>
                  <Text style={type.body}>{account?.guest ? 'Guest' : `Signed in${account?.login ? ` as @${account.login}` : ''}`}</Text>
                  <Text style={type.caption}>
                    {account?.guest
                      ? 'Sign in to keep your services and plan when you switch phones.'
                      : 'Your services and plan follow you to any phone.'}
                  </Text>
                </View>
                {account?.guest && (
                  <Button label={busy === 'signin' ? 'Opening…' : 'Sign in'} icon={GithubLogo} onPress={signIn} style={styles.small} />
                )}
              </View>
            </View>
          </Section>

          <Section title="Connections">
            <View style={styles.group}>
              <View style={styles.row}>
                <GithubLogo size={22} color={c.text} weight="bold" />
                <View style={{ flex: 1 }}>
                  <Text style={type.body}>GitHub</Text>
                  <Text style={type.caption}>
                    {status?.github.connected
                      ? `Connected as @${status.github.account}. Revert and merge PRs on repos you picked.`
                      : 'Installs the OpsSwipe app on the repos you choose.'}
                  </Text>
                </View>
                {!status?.github.connected && (
                  <Button label={busy === 'github' ? 'Opening…' : 'Connect'} onPress={connectGithub} style={styles.small} />
                )}
              </View>

              <View style={styles.row}>
                <Key size={22} color={c.text} weight="bold" />
                <View style={{ flex: 1 }}>
                  <Text style={type.body}>Render</Text>
                  <Text style={type.caption}>
                    {status?.render.connected
                      ? 'Connected. The key is encrypted on the server and never shown again.'
                      : 'Paste an API key from Render → Account settings → API keys.'}
                  </Text>
                </View>
              </View>
              {!status?.render.connected && (
                <View style={{ gap: space.sm }}>
                  <Field label="Render API key" value={renderKey} onChange={setRenderKey} placeholder="rnd_..." secure />
                  <Button label={busy === 'render' ? 'Checking…' : 'Save key'} onPress={saveRenderKey} />
                </View>
              )}

              <View style={styles.row}>
                <GoogleLogo size={22} color={c.text} weight="bold" />
                <View style={{ flex: 1 }}>
                  <Text style={type.body}>Google Cloud</Text>
                  <Text style={type.caption}>
                    {status?.google.connected
                      ? `Signed in as ${status.google.account ?? 'you'}. Pick a VM below; the sign-in is deleted after.`
                      : 'Sign in and pick a VM. OpsSwipe keeps only permission to reset that one VM.'}
                  </Text>
                </View>
                {status?.google.available && !status.google.connected && (
                  <Button label={busy === 'google' ? 'Opening…' : 'Connect'} onPress={connectGoogle} style={styles.small} />
                )}
              </View>
            </View>
          </Section>

          <Section title="Your services">
            {services.length === 0
              ? <Text style={type.caption}>Nothing connected yet. Add a Render service or a GCP VM below.</Text>
              : (
                <View style={styles.group}>
                  {services.map((s) => (
                    <View key={s.id} style={{ gap: space.sm }}>
                      <View style={styles.row}>
                        {s.provider === 'gcp'
                          ? <HardDrives size={20} color={c.text} weight="bold" />
                          : <Cloud size={20} color={c.text} weight="bold" />}
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={type.monoStrong}>{s.name}</Text>
                          <Text style={type.caption} numberOfLines={1}>{s.config.url}</Text>
                          {s.config.repo && <Text style={type.monoCaption}>{s.config.repo}</Text>}
                        </View>
                        <Chip label={s.provider === 'gcp' ? 'GCP' : 'Render'} />
                      </View>
                      <View style={styles.actions}>
                        {s.config.repo && status?.github.connected && (
                          <Button
                            label={busy === `proof-${s.id}` ? 'Opening PR…' : 'Add proof to repo'}
                            kind="secondary"
                            onPress={() => installProof(s)}
                            style={{ flex: 1 }}
                          />
                        )}
                        <Button
                          label={confirmRemove === s.id ? 'Tap to confirm' : 'Remove'}
                          kind="secondary"
                          icon={Trash}
                          onPress={() => remove(s)}
                          style={{ flex: 1 }}
                        />
                      </View>
                    </View>
                  ))}
                </View>
              )}
          </Section>

          <Section title="Add a service">
            <View style={styles.tabs} accessibilityRole="tablist">
              {(['render', 'gcp'] as const).map((k) => (
                <Pressable
                  key={k}
                  onPress={() => setTab(k)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === k }}
                  style={[styles.tab, tab === k && styles.tabOn]}
                >
                  <Text style={[type.label, { color: tab === k ? c.green : c.text }]}>{k === 'render' ? 'Render' : 'GCP VM'}</Text>
                </Pressable>
              ))}
            </View>

            {tab === 'render' && (
              !status?.render.connected
                ? <Text style={type.caption}>Save a Render API key above to list your services.</Text>
                : (
                  <View style={styles.group}>
                    {(renderOptions ?? []).length === 0 && <Text style={type.caption}>No web services found on this Render account.</Text>}
                    {(renderOptions ?? []).map((o) => (
                      <View key={o.id} style={styles.row}>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={type.monoStrong}>{o.name}</Text>
                          <Text style={type.caption} numberOfLines={1}>{o.repo ?? 'no GitHub repo'}</Text>
                        </View>
                        {added.has(o.id)
                          ? <Chip label="Added" color={c.green} tint={c.greenTint} />
                          : (
                            <Button
                              label={busy === o.id ? 'Adding…' : 'Add'}
                              icon={Plus}
                              onPress={() => addRender(o)}
                              style={styles.small}
                            />
                          )}
                      </View>
                    ))}
                  </View>
                )
            )}

            {tab === 'gcp' && (
              <View style={styles.group}>
                {!projects
                  ? (
                    <View style={{ gap: space.md }}>
                      <Text style={type.body}>
                        Sign in with Google and pick a VM. OpsSwipe grants its own identity one custom role on that VM (see its
                        status, reset it), then deletes your Google sign-in. Remove the role in Cloud console to revoke.
                      </Text>
                      {status?.google.available && (
                        <Button label={busy === 'google' ? 'Opening…' : 'Connect Google Cloud'} icon={GoogleLogo} onPress={connectGoogle} />
                      )}
                    </View>
                  )
                  : (
                    <View style={{ gap: space.md }}>
                      <Text style={type.label}>Project</Text>
                      {projects.length === 0 && <Text style={type.caption}>No projects on this Google account.</Text>}
                      <View style={styles.chips}>
                        {projects.map((pr) => (
                          <Pressable
                            key={pr.id}
                            onPress={() => pickProject(pr.id)}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: project === pr.id }}
                            style={[styles.tab, styles.chipButton, project === pr.id && styles.tabOn]}
                          >
                            <Text style={[type.monoCaption, { color: project === pr.id ? c.green : c.text }]}>{pr.id}</Text>
                          </Pressable>
                        ))}
                      </View>
                      {busy === 'vms' && <Text style={type.caption}>Loading VMs…</Text>}
                      {vms?.length === 0 && <Text style={type.caption}>No VMs in this project.</Text>}
                      {vms?.map((v) => (
                        <Pressable
                          key={`${v.zone}/${v.name}`}
                          onPress={() => chooseVm(v)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: vm?.name === v.name && vm.zone === v.zone }}
                          style={[styles.vm, vm?.name === v.name && vm.zone === v.zone && styles.tabOn]}
                        >
                          <HardDrives size={20} color={c.text} weight="bold" />
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={type.monoStrong}>{v.name}</Text>
                            <Text style={type.caption}>{v.zone} · {v.status} · {v.ip ?? 'no public IP'}</Text>
                          </View>
                        </Pressable>
                      ))}
                      {vm && (
                        <View style={{ gap: space.md }}>
                          <Field
                            label="URL to health-check"
                            value={vmUrl}
                            onChange={setVmUrl}
                            placeholder="http://34.1.2.3/"
                          />
                          <Text style={type.caption}>
                            OpsSwipe will be able to reset and read {vm.name}. Nothing else. Your Google sign-in is deleted
                            after adding.
                          </Text>
                          <Button label={busy === 'addvm' ? 'Granting access…' : `Add ${vm.name}`} icon={Plus} onPress={addVm} />
                        </View>
                      )}
                    </View>
                  )}

                <Pressable
                  onPress={() => setManual(!manual)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: manual }}
                  style={styles.disclosure}
                >
                  {manual ? <CaretDown size={16} color={c.muted} weight="bold" /> : <CaretRight size={16} color={c.muted} weight="bold" />}
                  <Text style={[type.label, { color: c.muted }]}>Prefer commands? Grant access with gcloud</Text>
                </Pressable>
                {manual && (
                  <View style={{ gap: space.md }}>
                    <Field label="Project ID" value={gcp.project} onChange={(v) => setGcp({ ...gcp, project: v })} placeholder="my-project" />
                    <Field label="Zone" value={gcp.zone} onChange={(v) => setGcp({ ...gcp, zone: v })} />
                    <Field label="VM name" value={gcp.instance} onChange={(v) => setGcp({ ...gcp, instance: v })} placeholder="web-1" />
                    <Field
                      label="URL to health-check"
                      value={gcp.url}
                      onChange={(v) => setGcp({ ...gcp, url: v })}
                      placeholder="http://34.1.2.3/"
                    />
                    {commands
                      ? <CopyRow label="Run in Google Cloud Shell" value={commands} />
                      : <Text style={type.caption}>GCP isn&apos;t set up on this OpsSwipe server yet.</Text>}
                    <Button label={busy === 'gcp' ? 'Verifying…' : 'Verify access and add'} kind="secondary" onPress={addGcp} />
                  </View>
                )}
              </View>
            )}
          </Section>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg, paddingHorizontal: space.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 },
  iconButton: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  group: { backgroundColor: c.surface, borderRadius: radius.card, padding: space.lg, gap: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  actions: { flexDirection: 'row', gap: space.sm },
  small: { paddingHorizontal: space.md },
  input: {
    minHeight: TARGET,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: c.borderStrong,
    backgroundColor: c.surface2,
    paddingHorizontal: space.md,
    color: c.text,
    fontFamily: 'GeistMono',
    fontSize: 14,
  },
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: c.surface2,
    borderRadius: radius.control,
    padding: space.md,
  },
  created: { backgroundColor: c.greenTint, borderRadius: radius.card, padding: space.lg, gap: space.md, marginTop: space.md },
  notice: { backgroundColor: c.greenTint, borderRadius: radius.control, padding: space.md, minHeight: TARGET, justifyContent: 'center' },
  error: { color: c.red, backgroundColor: c.redTint, borderRadius: radius.control, padding: space.md, marginTop: space.md },
  tabs: { flexDirection: 'row', gap: space.sm },
  tab: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabOn: { borderColor: c.green, backgroundColor: c.greenTint },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chipButton: { flex: 0, paddingHorizontal: space.md },
  vm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: TARGET,
    padding: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: c.border,
  },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: TARGET },
});
