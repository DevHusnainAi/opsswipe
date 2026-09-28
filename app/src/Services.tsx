// The Services tab: a setup checklist until you're set up, the services OpsSwipe watches, and the
// accounts it's connected to. Adding a service happens in the AddService sheet.
import * as WebBrowser from 'expo-web-browser';
import type { Icon } from 'phosphor-react-native';
import { Bug, CheckCircle, CurrencyDollar, Cloud, GitBranch, GithubLogo, GoogleLogo, HardDrives, Key, Plus, ShieldCheck, Train, Trash } from 'phosphor-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AddService, CopyRow, type StartAt } from './AddService';
import { type ConnectStatus, type Service, connect, supabase } from './api';
import { appBase, appLink } from './env';
import { paramsOf } from './format';
import { RepoPicker } from './RepoPicker';
import { TARGET, c, radius, space, type } from './theme';
import { Button, Chip, Section } from './ui';

export function Services({ active }: { active: boolean }) {
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [services, setServices] = useState<Service[] | null>(null);
  const [sheet, setSheet] = useState<StartAt | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; url?: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // service whose repo is being changed
  const [repoDraft, setRepoDraft] = useState<string | null>(null);
  const [rc, setRc] = useState<{ key: string; projectId: string } | null>(null); // RevenueCat form, when open

  const load = useCallback(async () => {
    const [st, sv] = await Promise.all([
      connect<ConnectStatus>('status', { returnTo: appBase }),
      supabase.from('services').select('id, name, provider, config, sentry_secret_id').order('created_at'),
    ]);
    setStatus(st);
    setServices(sv.data ?? []);
  }, []);

  useEffect(() => {
    // Loads each time the tab opens; state is only set after the awaits inside load().
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active) load().catch((e) => setError(e.message));
  }, [active, load]);

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

  // Tap once to arm, again to confirm: destructive actions never happen on a single tap.
  const armed = (key: string, fn: () => void) => {
    if (confirm !== key) return setConfirm(key);
    setConfirm(null);
    fn();
  };

  const connectGithub = () =>
    run('github', async () => {
      const r = await WebBrowser.openAuthSessionAsync(status!.github.installUrl, appLink('connect'));
      if (r.type !== 'success') return;
      const q = paramsOf(r.url);
      if (!q.code || !q.installation_id) throw new Error('GitHub did not finish the install. Try again.');
      await connect('github_complete', { code: q.code, installationId: Number(q.installation_id) });
      await load();
    });

  const disconnect = (kind: 'github' | 'render' | 'google' | 'railway' | 'revenuecat') =>
    armed(`dc-${kind}`, () =>
      run(`dc-${kind}`, async () => {
        await connect('disconnect', { kind });
        await load();
      }));

  const remove = (s: Service) =>
    armed(`rm-${s.id}`, () =>
      run(`rm-${s.id}`, async () => {
        await connect('remove_service', { serviceId: s.id });
        await load();
      }));

  const saveRepo = (s: Service) =>
    run(`repo-${s.id}`, async () => {
      await connect('link_repo', { serviceId: s.id, repo: repoDraft ?? '' });
      setEditing(null);
      await load();
    });

  // Revenue at risk: a read-only RevenueCat key; the server tests it before storing it in Vault.
  const saveRevenueCat = () =>
    run('rc', async () => {
      const r = await connect<{ perHour: number; currency: string }>('set_revenuecat', rc!);
      setRc(null);
      const hourly = new Intl.NumberFormat('en-US', { style: 'currency', currency: r.currency }).format(r.perHour);
      setNotice({ text: `Connected. Your app earns about ${hourly} an hour (last 28 days): that's what an outage puts at risk.` });
      await load();
    });

  const installProof = (s: Service) =>
    run(`proof-${s.id}`, async () => {
      const r = await connect<{ prUrl: string }>('install_proof', { serviceId: s.id });
      setNotice({ text: 'Proof workflow PR opened. Check its commands, then merge it.', url: r.prUrl });
      await load();
    });

  // The last setup step does whatever is missing first: GitHub, then a linked repo, then the workflow PR.
  const turnOnProof = () => {
    const linked = services?.find((s) => s.config.repo);
    if (!status?.github.connected) return connectGithub();
    if (!linked) {
      const first = services?.[0];
      if (!first) return setSheet('provider');
      setEditing(first.id);
      setRepoDraft(null);
      return setNotice({ text: `Pick the repo ${first.name} deploys from, then tap Turn on proof again.` });
    }
    installProof(linked);
  };

  const cloud = !!(status?.render.connected || status?.google.connected);
  const steps = [
    { done: cloud, title: 'Connect where your app runs', body: 'Render or Google Cloud.', action: () => setSheet('provider') },
    { done: !!services?.length, title: 'Add your first service', body: 'OpsSwipe starts watching it right away.', action: () => setSheet('provider') },
    {
      done: !!status?.github.connected,
      title: 'Connect GitHub',
      body: 'Revert bad releases and merge fixes once CI proves them.',
      action: connectGithub,
    },
    {
      done: !!services?.some((s) => s.config.proofPr),
      title: 'Turn on proof',
      body: 'One PR adds a workflow that replays production failures, so code fixes merge only once proven.',
      action: turnOnProof,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const existing = new Set(
    (services ?? []).map((s) => (s.provider === 'gcp' ? `${s.config.project}/${s.config.zone}/${s.config.instance}` : s.config.serviceId!)),
  );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.titleRow}>
          <Text style={type.display} accessibilityRole="header">Services</Text>
          {!!services?.length && <Button label="Add" icon={Plus} onPress={() => setSheet('provider')} style={styles.small} />}
        </View>

        {error && <Text style={[type.label, styles.error]} accessibilityLiveRegion="polite">{error}</Text>}
        {notice && (
          <Pressable onPress={() => notice.url && Linking.openURL(notice.url)} style={styles.notice} accessibilityRole="link">
            <Text style={[type.label, { color: c.green }]}>{notice.text}{notice.url ? '  Open PR' : ''}</Text>
          </Pressable>
        )}

        {!status || !services ? (
          <View style={styles.loading}>
            <ActivityIndicator color={c.green} />
          </View>
        ) : (
          <>
            {doneCount < steps.length && (
              <View style={styles.setup}>
                <View style={{ gap: 4 }}>
                  <Text style={type.title}>Set up OpsSwipe</Text>
                  <Text style={type.caption}>{doneCount} of {steps.length} done</Text>
                  <View style={styles.progress}>
                    <View style={[styles.progressFill, { flex: doneCount }]} />
                    <View style={{ flex: steps.length - doneCount }} />
                  </View>
                </View>
                {steps.map((s, i) => (
                  <Pressable
                    key={s.title}
                    disabled={s.done}
                    onPress={s.action}
                    accessibilityRole="button"
                    accessibilityState={{ checked: s.done }}
                    style={styles.step}
                  >
                    {s.done
                      ? <CheckCircle size={24} color={c.green} weight="fill" />
                      : <View style={styles.ring} />}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[type.body, s.done && { color: c.muted, textDecorationLine: 'line-through' }]}>
                        {i + 1}. {s.title}
                      </Text>
                      {!s.done && <Text style={type.caption}>{s.body}</Text>}
                    </View>
                    {!s.done && ((busy === 'github' && i === 2) || (i === 3 && busy?.startsWith('proof-')) ? <ActivityIndicator color={c.green} /> : <Text style={[type.label, { color: c.green }]}>Start</Text>)}
                  </Pressable>
                ))}
              </View>
            )}

            <Section title={`Watching ${services.length}`}>
              {services.length === 0 ? (
                <View style={styles.empty}>
                  <ShieldCheck size={32} color={c.muted} />
                  <Text style={[type.body, { textAlign: 'center' }]}>No services yet</Text>
                  <Text style={[type.caption, { textAlign: 'center' }]}>
                    Add a Render service or a Google Cloud VM. OpsSwipe checks it every minute and pages you when it breaks.
                  </Text>
                  <Button label="Add a service" icon={Plus} onPress={() => setSheet('provider')} />
                </View>
              ) : (
                services.map((s) => (
                  <View key={s.id} style={styles.card}>
                    <View style={styles.row}>
                      <View style={styles.cardIcon}>
                        {s.provider === 'gcp' ? <HardDrives size={22} color={c.text} /> : <Cloud size={22} color={c.text} />}
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={type.monoStrong}>{s.name}</Text>
                        <Text style={type.caption} numberOfLines={1}>{s.config.url}</Text>
                      </View>
                      <Chip label={s.provider === 'gcp' ? 'Google Cloud' : s.provider === 'railway' ? 'Railway' : 'Render'} />
                    </View>
                    <View style={styles.repoRow}>
                      <GitBranch size={16} color={s.config.repo ? c.text : c.muted} />
                      <Text style={[type.monoCaption, { flex: 1, color: s.config.repo ? c.text : c.muted }]} numberOfLines={1}>
                        {s.config.repo ? `${s.config.repo} · ${s.config.branch ?? 'main'}` : 'No repo linked'}
                      </Text>
                      <Pressable
                        onPress={() => {
                          setEditing(editing === s.id ? null : s.id);
                          setRepoDraft(s.config.repo ?? null);
                        }}
                        hitSlop={8}
                        accessibilityRole="button"
                      >
                        <Text style={[type.label, { color: c.green }]}>
                          {editing === s.id ? 'Cancel' : s.config.repo ? 'Change' : 'Link repo'}
                        </Text>
                      </Pressable>
                    </View>
                    {editing === s.id && (
                      <View style={{ gap: space.sm }}>
                        <RepoPicker value={repoDraft} onChange={setRepoDraft} githubConnected={status.github.connected} />
                        {status.github.connected && (
                          <Button
                            label={busy === `repo-${s.id}` ? 'Saving…' : 'Save'}
                            onPress={() => saveRepo(s)}
                          />
                        )}
                      </View>
                    )}
                    <SentryLink service={s} onSaved={load} />
                    <View style={styles.actions}>
                      {s.config.repo && status.github.connected && (
                        <Button
                          label={busy === `proof-${s.id}` ? 'Opening PR…' : s.config.proofPr ? 'Proof PR' : 'Add proof to repo'}
                          kind="secondary"
                          onPress={() => (s.config.proofPr ? Linking.openURL(s.config.proofPr) : installProof(s))}
                          style={{ flex: 1 }}
                        />
                      )}
                      <Button
                        label={busy === `rm-${s.id}` ? 'Removing…' : confirm === `rm-${s.id}` ? 'Tap to remove' : 'Remove'}
                        kind="secondary"
                        icon={Trash}
                        onPress={() => remove(s)}
                        style={{ flex: 1 }}
                      />
                    </View>
                  </View>
                ))
              )}
            </Section>

            <Section title="Connections">
              <View style={styles.group}>
                <Connection
                  icon={GithubLogo}
                  name="GitHub"
                  detail={status.github.connected ? `@${status.github.account}` : 'Revert bad releases, merge proven fixes'}
                  connected={status.github.connected}
                  busy={busy === 'github' || busy === 'dc-github'}
                  confirming={confirm === 'dc-github'}
                  onConnect={connectGithub}
                  onDisconnect={() => disconnect('github')}
                />
                <Connection
                  icon={Key}
                  name="Render"
                  detail={status.render.connected ? 'API key stored encrypted' : 'Restart and roll back services'}
                  connected={status.render.connected}
                  busy={busy === 'dc-render'}
                  confirming={confirm === 'dc-render'}
                  onConnect={() => setSheet('renderKey')}
                  onDisconnect={() => disconnect('render')}
                />
                <Connection
                  icon={Train}
                  name="Railway"
                  detail={status.railway.connected ? 'API token stored encrypted' : 'Restart and roll back services'}
                  connected={status.railway.connected}
                  busy={busy === 'dc-railway'}
                  confirming={confirm === 'dc-railway'}
                  onConnect={() => setSheet('railway')}
                  onDisconnect={() => disconnect('railway')}
                />
                <Connection
                  icon={CurrencyDollar}
                  name="Revenue at risk"
                  detail={status.revenuecat.connected ? `RevenueCat · ${status.revenuecat.project}` : 'Show what each outage costs, from your RevenueCat'}
                  connected={status.revenuecat.connected}
                  busy={busy === 'rc' || busy === 'dc-revenuecat'}
                  confirming={confirm === 'dc-revenuecat'}
                  onConnect={() => setRc(rc ? null : { key: '', projectId: '' })}
                  onDisconnect={() => disconnect('revenuecat')}
                />
                {rc && (
                  <View style={{ gap: space.sm, paddingVertical: space.md }}>
                    <Text style={type.caption}>
                      In RevenueCat: Project settings → API keys → New secret key (v2) with Charts &amp; Metrics read
                      access, and the project id from Project settings. OpsSwipe only reads your revenue total.
                    </Text>
                    <TextInput
                      value={rc.key}
                      onChangeText={(key) => setRc({ ...rc, key })}
                      placeholder="sk_…"
                      placeholderTextColor={c.muted}
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={styles.input}
                      accessibilityLabel="RevenueCat secret key"
                    />
                    <TextInput
                      value={rc.projectId}
                      onChangeText={(projectId) => setRc({ ...rc, projectId })}
                      placeholder="Project id"
                      placeholderTextColor={c.muted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={styles.input}
                      accessibilityLabel="RevenueCat project id"
                    />
                    <Button label={busy === 'rc' ? 'Checking with RevenueCat…' : 'Connect'} onPress={saveRevenueCat} />
                  </View>
                )}
                {status.google.available && (
                  <Connection
                    icon={GoogleLogo}
                    name="Google Cloud"
                    detail={status.google.connected ? (status.google.account ?? 'Connected') : 'Reboot Compute Engine VMs'}
                    connected={status.google.connected}
                    busy={busy === 'dc-google'}
                    confirming={confirm === 'dc-google'}
                    onConnect={() => setSheet('google')}
                    onDisconnect={() => disconnect('google')}
                    extra={status.google.connected ? { label: 'Add a VM', onPress: () => setSheet('google') } : undefined}
                  />
                )}
              </View>
              <Text style={type.caption}>
                Disconnecting stops new fixes through that account. Google access is revoked at Google, and VM roles you
                granted stay until you remove them in Cloud console.
              </Text>
            </Section>
          </>
        )}
      </ScrollView>

      {/* Mounted fresh on each open, so every visit starts clean. */}
      {sheet && (
        <AddService
          key={sheet}
          start={sheet}
          status={status}
        existing={existing}
          onClose={(changed) => {
            setSheet(null);
            if (changed) load().catch((e) => setError(e.message));
          }}
        />
      )}
    </View>
  );
}

// Sentry as an incident source for one service: the user creates an Internal Integration in Sentry
// with this webhook URL and an issue-alert action, then pastes its Client Secret here once.
function SentryLink({ service, onSaved }: { service: Service; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hook = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/sentry?service=${service.id}`;
  const connected = !!service.sentry_secret_id;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await connect('set_sentry_secret', { serviceId: service.id, secret });
      setSecret('');
      setOpen(false);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: space.sm }}>
      <Pressable onPress={() => setOpen(!open)} hitSlop={8} accessibilityRole="button" style={styles.repoRow}>
        <Bug size={16} color={connected ? c.text : c.muted} />
        <Text style={[type.monoCaption, { flex: 1, color: connected ? c.text : c.muted }]}>
          {connected ? 'Sentry alerts open incidents' : 'No Sentry'}
        </Text>
        <Text style={[type.label, { color: c.green }]}>{open ? 'Cancel' : connected ? 'Change' : 'Connect Sentry'}</Text>
      </Pressable>
      {open && (
        <View style={{ gap: space.sm }}>
          <Text style={type.caption}>
            In Sentry: Settings → Developer Settings → New Internal Integration. Paste this webhook URL, turn on Alert
            Rule Action, save, then add it as an action on an issue alert. Copy its Client Secret below.
          </Text>
          <CopyRow label="Webhook URL" value={hook} />
          <TextInput
            value={secret}
            onChangeText={setSecret}
            placeholder="Client Secret"
            placeholderTextColor={c.muted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            accessibilityLabel="Sentry Client Secret"
          />
          {error && <Text style={[type.label, styles.error]}>{error}</Text>}
          <Button label={busy ? 'Saving…' : 'Save'} onPress={save} />
        </View>
      )}
    </View>
  );
}

function Connection(p: {
  icon: Icon;
  name: string;
  detail: string;
  connected: boolean;
  busy: boolean;
  confirming: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  extra?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.connection}>
      <p.icon size={24} color={c.text} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={type.body}>{p.name}</Text>
          {p.connected && <View style={styles.dot} />}
        </View>
        <Text style={type.caption} numberOfLines={1}>{p.detail}</Text>
        {p.extra && (
          <Pressable onPress={p.extra.onPress} hitSlop={8} accessibilityRole="button">
            <Text style={[type.label, { color: c.green, marginTop: 4 }]}>{p.extra.label}</Text>
          </Pressable>
        )}
      </View>
      {p.busy ? (
        <ActivityIndicator color={c.green} />
      ) : p.connected ? (
        <Pressable onPress={p.onDisconnect} hitSlop={8} accessibilityRole="button" style={styles.textButton}>
          <Text style={[type.label, { color: p.confirming ? c.red : c.muted }]}>
            {p.confirming ? 'Tap to disconnect' : 'Disconnect'}
          </Text>
        </Pressable>
      ) : (
        <Button label="Connect" onPress={p.onConnect} style={styles.small} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xxl, gap: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md },
  loading: { paddingVertical: space.xxl, alignItems: 'center' },
  setup: {
    backgroundColor: c.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.lg,
    gap: space.md,
    marginTop: space.sm,
  },
  progress: {
    flexDirection: 'row',
    height: 4,
    borderRadius: 2,
    backgroundColor: c.surface2,
    marginTop: space.sm,
    overflow: 'hidden',
  },
  progressFill: { height: 4, backgroundColor: c.green },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TARGET },
  ring: { width: 22, height: 22, margin: 1, borderRadius: 11, borderWidth: 2, borderColor: c.borderStrong },
  empty: {
    borderWidth: 1,
    borderColor: c.border,
    borderStyle: 'dashed',
    borderRadius: radius.card,
    alignItems: 'center',
    gap: space.sm,
    padding: space.xl,
  },
  card: { backgroundColor: c.surface, borderRadius: radius.card, padding: space.lg, gap: space.md },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.control,
    backgroundColor: c.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  actions: { flexDirection: 'row', gap: space.sm },
  repoRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32 },
  group: { backgroundColor: c.surface, borderRadius: radius.card, paddingHorizontal: space.lg },
  connection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.green },
  small: { paddingHorizontal: space.md },
  textButton: { minHeight: TARGET, justifyContent: 'center' },
  notice: { backgroundColor: c.greenTint, borderRadius: radius.control, padding: space.md, minHeight: TARGET, justifyContent: 'center' },
  error: { color: c.red, backgroundColor: c.redTint, borderRadius: radius.control, padding: space.md },
  input: {
    minHeight: TARGET,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface2,
    color: c.text,
    paddingHorizontal: space.md,
    fontFamily: 'GeistMono',
  },
});
