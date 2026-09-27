// Connect: link GitHub and Render, add the services OpsSwipe watches and fixes.
// Keys go straight to the server (Supabase Vault); the app never stores or shows them again.
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { Check, Cloud, Copy, GithubLogo, HardDrives, Key, Plus, Trash, X } from 'phosphor-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type ConnectStatus, type NewService, type RenderOption, type Service, connect, supabase } from './api';
import { TARGET, c, radius, space, type } from './theme';
import { Button, Chip, Section } from './ui';

// "opsswipe://connect?code=..&installation_id=.." -> params (RN's URL has no searchParams).
const queryOf = (url: string) =>
  Object.fromEntries((url.split('?')[1] ?? '').split('&').filter(Boolean).map((kv) => kv.split('=').map(decodeURIComponent)));

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

export function Services({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [renderOptions, setRenderOptions] = useState<RenderOption[] | null>(null);
  const [renderKey, setRenderKey] = useState('');
  const [tab, setTab] = useState<'render' | 'gcp'>('render');
  const [gcp, setGcp] = useState({ project: '', zone: 'us-central1-a', instance: '', url: '' });
  const [created, setCreated] = useState<NewService | null>(null);
  const [notice, setNotice] = useState<{ text: string; url?: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [st, sv] = await Promise.all([
      connect<ConnectStatus>('status'),
      supabase.from('services').select('id, name, provider, config').order('created_at'),
    ]);
    setStatus(st);
    setServices(sv.data ?? []);
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
      const q = queryOf(r.url);
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
                <Text style={type.body}>
                  OpsSwipe never asks for a GCP key. You grant its identity one custom role on one VM: it can see the
                  VM&apos;s status and reset it, nothing else. Delete the binding to revoke.
                </Text>
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
                <Button label={busy === 'gcp' ? 'Verifying…' : 'Verify access and add'} onPress={addGcp} />
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
});
