import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Font from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { ArrowClockwise, CheckCircle, Crown, Hand, Plug, ShieldCheck, WarningCircle } from 'phosphor-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import Purchases from 'react-native-purchases';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  AuditEntry,
  connect,
  currentUserId,
  execute,
  Incident,
  registerPush,
  sessionFromRedirect,
  signOut as endSession,
  supabase,
} from './src/api';
import { Activity } from './src/Activity';
import { Auth, type AuthMode, NewPassword } from './src/Auth';
import { inExpoGo, Notifications } from './src/env';
import { fixFor } from './src/fixes';
import { recoveryLine } from './src/format';
import { AlertsPrimer, Logo, Welcome } from './src/Onboarding';
import { Services } from './src/Services';
import { Settings } from './src/Settings';
import { PROVIDER, SwipeCard } from './src/SwipeCard';
import { type Tab, TabBar } from './src/TabBar';
import { c, radius, space, type } from './src/theme';
import { Banner, type BannerState, Button, Skeleton, useNow } from './src/ui';

const WELCOMED = 'opsswipe.welcomed'; // the value tour is shown once per phone
const ALERTS_ASKED = 'opsswipe.alerts-asked'; // so is the notification primer

// A practice card: the real swipe and fingerprint, with a simulated recovery. It lives only in this
// screen's state, never reaches the server, and never uses the free fix.
const SAMPLE_ID = 'sample';
const sampleIncident = (): Incident => {
  const replay = [
    { method: 'POST', path: '/checkout', status: 500 },
    { method: 'POST', path: '/checkout', status: 500 },
    { method: 'GET', path: '/cart', status: 500 },
  ];
  return {
    id: SAMPLE_ID,
    title: 'Sample: requests are failing',
    target_server: 'sample-api',
    environment: 'production',
    severity: 'CRITICAL',
    metric: 'POST /checkout → 500 (3 failing requests)',
    action: 'rollback',
    provider: 'render',
    status: 'active',
    created_at: new Date(Date.now() - 94_000).toISOString(),
    resolved_at: null,
    recovered_at: null,
    actions: ['rollback', 'restart'],
    reason: 'a1b2c3d deployed 4m before the failure. Roll back to the last good release.',
    suggested_by: 'rules',
    context: {
      replay,
      pr: { number: 42, url: 'https://github.com/DevHusnainAi/opsswipe#the-verified-fix-loop', headSha: 'sample' },
      proof: { ok: true, passed: 3, total: 3, tests: true, headSha: 'sample' },
    },
  };
};

type Phase = 'loading' | 'welcome' | 'auth' | 'recovery' | 'primer' | 'ready' | 'error';

Notifications?.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [authMode, setAuthMode] = useState<AuthMode>('signup');
  const [error, setError] = useState('');
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [fixed, setFixed] = useState<Incident[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [pro, setPro] = useState(false);
  const [free, setFree] = useState<{ used: number; incident: string | null }>({ used: 0, incident: null });
  const [banner, setBanner] = useState<BannerState>(null);
  const [cardHeight, setCardHeight] = useState(420);
  const [serviceCount, setServiceCount] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('incidents');
  const [sample, setSample] = useState<Incident | null>(null);
  const [recovered, setRecovered] = useState<Incident | null>(null);
  const seenRecovered = useRef<Set<string>>(null); // null until the first load, so old recoveries don't pop up
  const channel = useRef<ReturnType<typeof supabase.channel>>(undefined);
  const purchasesReady = useRef(false);
  const now = useNow();

  const refresh = useCallback(async () => {
    const [i, r, a, u, sv] = await Promise.all([
      supabase.from('incidents').select().in('status', ['active', 'resolving']).order('created_at'),
      supabase.from('incidents').select().eq('status', 'resolved').order('resolved_at', { ascending: false }).limit(10),
      supabase.from('audit_log').select().order('created_at', { ascending: false }).limit(50),
      supabase.from('usage').select('free_used, free_incident').maybeSingle(),
      supabase.from('services').select('id', { count: 'exact', head: true }),
    ]);
    const failed = i.error ?? r.error ?? a.error ?? u.error;
    if (failed) throw failed;
    setIncidents(i.data ?? []);
    setFixed(r.data ?? []);
    // A service that came back since the last look gets its moment (the push covers a closed app).
    const back = (r.data ?? []).filter((x: Incident) => x.recovered_at);
    const fresh = seenRecovered.current && back.find((x: Incident) => !seenRecovered.current!.has(x.id));
    if (fresh) {
      setRecovered(fresh);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    seenRecovered.current = new Set(back.map((x: Incident) => x.id));
    setAudit(a.data ?? []);
    setFree({ used: u.data?.free_used ?? 0, incident: u.data?.free_incident ?? null });
    setServiceCount(sv.count ?? 0);
  }, []);

  // Signed in: the plan follows the account (RevenueCat appUserID = Supabase user id), data loads,
  // and this phone starts receiving the account's alerts.
  const enter = useCallback(async (uid: string) => {
    if (!purchasesReady.current) {
      Purchases.configure({ apiKey: process.env.EXPO_PUBLIC_RC_KEY!, appUserID: uid });
      Purchases.addCustomerInfoUpdateListener((info) => setPro(!!info.entitlements.active.pro));
      purchasesReady.current = true;
    } else {
      await Purchases.logIn(uid).catch(() => {});
    }
    try {
      setPro(!!(await Purchases.getCustomerInfo()).entitlements.active.pro);
    } catch {
      // offline: the server still enforces the plan on every fix
    }
    await refresh();
    // Alerts come as server push (they reach a closed app); realtime only keeps the open app fresh.
    registerPush().catch(() => {});
    channel.current ??= supabase
      .channel('ops')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => refresh().catch(() => {}))
      .subscribe();
    const asked = await AsyncStorage.getItem(ALERTS_ASKED);
    setPhase(asked || !Notifications ? 'ready' : 'primer');
  }, [refresh]);

  const boot = useCallback(async () => {
    try {
      // Our builds embed Geist natively (app.json); Expo Go can only load fonts at runtime.
      if (inExpoGo) {
        await Font.loadAsync({
          Geist: require('@expo-google-fonts/geist/400Regular/Geist_400Regular.ttf'),
          GeistMono: require('@expo-google-fonts/geist-mono/400Regular/GeistMono_400Regular.ttf'),
        }).catch(() => {});
      }
      // Creating a channel doesn't prompt on Android 13+; the permission is asked in the primer.
      await Notifications?.setNotificationChannelAsync('incidents', {
        name: 'Incidents',
        description: 'A health check failed and a fix is waiting for you.',
        importance: Notifications.AndroidImportance.MAX,
      });
      const uid = await currentUserId();
      if (uid) return await enter(uid);
      const welcomed = await AsyncStorage.getItem(WELCOMED);
      setAuthMode(welcomed ? 'signin' : 'signup');
      setPhase(welcomed ? 'auth' : 'welcome');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, [enter]);

  useEffect(() => {
    // Fetch on mount: boot() only sets state after its awaits, which the rule can't see across the call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    boot();
    return () => {
      if (channel.current) supabase.removeChannel(channel.current);
    };
  }, [boot]);

  // Email links (confirm the account, reset the password) open the app signed in. OAuth redirects
  // are handled by the sign-in call itself; they carry no `type`, so they are skipped here.
  useEffect(() => {
    const open = async (url: string | null) => {
      if (!url || !/[#&?]type=/.test(url)) return;
      try {
        const s = await sessionFromRedirect(url);
        if (s?.recovery) setPhase('recovery');
        else if (s) await enter(s.uid);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      }
    };
    Linking.getInitialURL().then(open);
    const sub = Linking.addEventListener('url', (e) => open(e.url));
    return () => sub.remove();
  }, [enter]);

  const startAuth = async (mode: AuthMode) => {
    await AsyncStorage.setItem(WELCOMED, '1');
    setAuthMode(mode);
    setPhase('auth');
  };

  const decideAlerts = async (enable: boolean) => {
    await AsyncStorage.setItem(ALERTS_ASKED, '1');
    if (enable && Notifications && (await Notifications.requestPermissionsAsync()).granted) {
      await registerPush().catch(() => {});
    }
    setPhase('ready');
    if (serviceCount === 0) setTab('services'); // first run: straight to the setup checklist
  };

  // Android shows the permission dialog only while it's allowed to ask; after a "Don't allow" the
  // only way back is the system settings page, so go there instead of silently doing nothing.
  const enableAlerts = async () => {
    if (!Notifications) return;
    const now = await Notifications.getPermissionsAsync();
    const res = now.granted || !now.canAskAgain ? now : await Notifications.requestPermissionsAsync();
    if (res.granted) await registerPush();
    else await Linking.openSettings();
  };

  const signOut = async () => {
    await endSession();
    await Purchases.logOut().catch(() => {});
    if (channel.current) supabase.removeChannel(channel.current);
    channel.current = undefined;
    setIncidents([]);
    setFixed([]);
    setSample(null);
    setRecovered(null);
    seenRecovered.current = null;
    setAudit([]);
    setServiceCount(null);
    setPro(false);
    setBanner(null);
    setTab('incidents');
    setAuthMode('signin');
    setPhase('auth');
  };

  // Expo Go runs RevenueCat in Preview API mode, which cannot draw the paywall or Customer Center.
  const PREVIEW_ONLY = 'The paywall and purchases need the OpsSwipe app. Expo Go can only preview RevenueCat.';

  const paywall = async () => {
    if (inExpoGo) throw new Error(PREVIEW_ONLY);
    const res = await RevenueCatUI.presentPaywall();
    const bought = res === PAYWALL_RESULT.PURCHASED || res === PAYWALL_RESULT.RESTORED;
    if (bought) setPro(true);
    return bought;
  };

  const upgrade = async () => {
    await paywall();
  };

  const manage = async () => {
    if (inExpoGo) throw new Error(PREVIEW_ONLY);
    await RevenueCatUI.presentCustomerCenter();
  };

  const restore = async () => {
    const active = !!(await Purchases.restorePurchases()).entitlements.active.pro;
    setPro(active);
    return active;
  };

  const run = async (inc: Incident, action: string) => {
    const fix = fixFor(action);
    setBanner({ kind: 'busy', text: `${fix.doing} ${inc.target_server}` });
    const res = await execute(inc.id, action);
    if (res.result === 'error') setBanner({ kind: 'error', text: 'The fix failed. Details are in the activity log.' });
    if (res.result === 'ok') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBanner(
        (action === 'revert_pr' || action === 'fix_pr') && res.detail?.startsWith('https://')
          ? {
            kind: 'ok',
            text: `${action === 'fix_pr' ? 'Claude opened a fix PR' : 'Revert PR opened'}. CI is proving it against the failing requests.`,
            link: { label: 'Open PR', url: res.detail },
          }
          : { kind: 'ok', text: `${fix.verb} sent. Waiting for ${inc.target_server} to come back.` },
      );
    }
    return res.result;
  };

  // FR-12 → FR-14: the card snaps back first, then the paywall slides up, saying what's at stake.
  const upsell = async (inc: Incident, action: string) => {
    setBanner({ kind: 'warn', text: `${inc.target_server} is down and your free outage is used. Pro fixes it now.` });
    try {
      if (await paywall()) await run(inc, action); // already authorized
    } catch (e) {
      setBanner({ kind: 'warn', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const onFix = async (inc: Incident, action: string) => {
    const fix = fixFor(action);
    setBanner({ kind: 'busy', text: 'Confirm with your fingerprint' });
    const auth = await LocalAuthentication.authenticateAsync({
      promptMessage: `${fix.verb} ${inc.target_server}?`,
      promptSubtitle: `${PROVIDER[inc.provider ?? ''] ?? 'Server'} · ${fix.label}`,
      promptDescription: fix.confirm,
      cancelLabel: 'Cancel',
    });
    if (!auth.success) {
      const noLock = ['not_enrolled', 'not_available', 'passcode_not_set'].includes(auth.error);
      setBanner({
        kind: 'warn',
        text: noLock
          ? 'Set up a screen lock or fingerprint on this phone to approve fixes.'
          : 'Cancelled. Nothing was changed.',
      });
      return 'failed' as const;
    }
    if (inc.id === SAMPLE_ID) {
      setBanner({ kind: 'busy', text: `${fix.doing} ${inc.target_server}` });
      const fixedAt = Date.now();
      await new Promise((r) => setTimeout(r, 2500));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSample(null);
      setBanner(null);
      setRecovered({ ...inc, resolved_at: new Date(fixedAt).toISOString(), recovered_at: new Date().toISOString() });
      return 'done' as const;
    }
    const result = await run(inc, action);
    if (result === 'paywall') setTimeout(() => upsell(inc, action), 350);
    if (result !== 'ok') return 'failed' as const;
    return action === 'revert_pr' || action === 'fix_pr' ? ('stay' as const) : ('done' as const);
  };

  // Closing a card without a fix: an agent's proposal is declined (the agent sees "declined"); anything
  // else is dismissed as a false alarm, logged in Activity. The practice card just goes away.
  const decline = async (inc: Incident) => {
    if (inc.id === SAMPLE_ID) return setSample(null);
    const agent = inc.suggested_by === 'agent';
    try {
      await connect(agent ? 'decline' : 'dismiss', { incidentId: inc.id });
      setBanner({
        kind: 'ok',
        text: agent
          ? `Declined. ${inc.context?.agent?.name ?? 'The agent'} will be told.`
          : `Dismissed. ${inc.target_server} stays watched; it's logged in Activity.`,
      });
      await refresh();
    } catch (e) {
      setBanner({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const down = incidents.length;
  const cards = sample ? [sample, ...incidents] : incidents;
  const trySample = () => {
    setRecovered(null);
    setSample(sampleIncident());
  };
  // The free tier is one whole outage: every fix of that incident is on us.
  const freeNow = !!free.incident && incidents.some((i) => i.id === free.incident);
  const planChip = pro ? 'Pro' : free.used === 0 ? 'Free · 1 outage' : freeNow ? 'Free · this outage' : 'Free';
  const planBody = pro
    ? 'Unlimited fixes on every outage.'
    : free.used === 0
    ? 'Your first outage is on us: every fix until it is over. Pro covers every outage after.'
    : freeNow
    ? 'This outage is on us, start to finish. Pro covers every outage after.'
    : 'Your free outage is used. Pro fixes every outage after, for $4.99 a month.';

  // Deletes the account on the server, then clears this phone the same way sign-out does.
  const deleteAccount = async () => {
    await connect('delete_account');
    await signOut().catch(() => {});
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.root}>
          <StatusBar style="light" />

          {phase === 'welcome' && <Welcome onStart={() => startAuth('signup')} onSignIn={() => startAuth('signin')} />}
          {phase === 'auth' && (
            <Auth
              key={authMode}
              mode={authMode}
              onBack={() => setPhase('welcome')}
              onSignedIn={(uid) => {
                setPhase('loading');
                enter(uid).catch((e) => {
                  setError(e instanceof Error ? e.message : String(e));
                  setPhase('error');
                });
              }}
            />
          )}
          {phase === 'recovery' && (
            <NewPassword
              onDone={() => currentUserId().then((uid) => (uid ? enter(uid) : setPhase('auth')))}
            />
          )}
          {phase === 'primer' && <AlertsPrimer onDecide={decideAlerts} />}

          {(phase === 'loading' || phase === 'ready' || phase === 'error') && (
            <>
              <View style={styles.header}>
                <View style={styles.brand}>
                  <Logo size={22} />
                  <Text style={[type.monoStrong, { fontWeight: '600' }]}>opsswipe</Text>
                </View>
                <Pressable
                  onPress={() => setTab('settings')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`${planChip} plan. ${planBody} Opens your plan.`}
                  style={({ pressed }) => [styles.plan, pro && styles.planPro, pressed && { opacity: 0.8 }]}
                >
                  {pro && <Crown size={14} color={c.green} weight="fill" />}
                  <Text style={[type.label, { color: pro ? c.green : c.text }]}>
                    {planChip}
                  </Text>
                </Pressable>
              </View>

              {phase === 'loading' && (
                <View style={{ gap: space.lg, marginTop: space.lg }}>
                  <Skeleton height={32} style={{ width: '60%' }} />
                  <Skeleton height={300} />
                  <Skeleton height={120} />
                </View>
              )}

              {phase === 'error' && (
                <View style={styles.center}>
                  <WarningCircle size={32} color={c.red} weight="bold" />
                  <Text style={type.title}>Can&apos;t reach OpsSwipe</Text>
                  <Text style={[type.body, { color: c.muted, textAlign: 'center' }]}>{error}</Text>
                  <Button
                    label="Try again"
                    icon={ArrowClockwise}
                    kind="secondary"
                    onPress={() => {
                      setPhase('loading');
                      boot();
                    }}
                  />
                </View>
              )}

              {phase === 'ready' && (
                <>
                <View style={[styles.screen, tab !== 'incidents' && styles.hidden]}>
                <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                  <View style={styles.hero}>
                    <View style={styles.statusRow}>
                      <View style={[styles.dot, { backgroundColor: cards.length ? c.red : serviceCount ? c.green : c.muted }]} />
                      <Text style={[type.label, { color: cards.length ? c.red : serviceCount ? c.green : c.muted }]}>
                        {sample && !down
                          ? 'Practice run: nothing real is touched'
                          : down
                          ? `${down} service${down > 1 ? 's' : ''} down`
                          : serviceCount
                          ? `Watching ${serviceCount} service${serviceCount > 1 ? 's' : ''}`
                          : 'Not watching anything yet'}
                      </Text>
                    </View>
                    <Text style={type.display} accessibilityRole="header">
                      {cards.length ? 'A fix is waiting for you' : serviceCount ? 'Nothing to fix' : 'Watch your first service'}
                    </Text>
                  </View>

                  <View style={[styles.stack, { height: cards.length ? cardHeight + 24 : 300 }]}>
                    {recovered && cards.length === 0 ? (
                      <View style={[styles.empty, styles.recovered]} accessibilityLiveRegion="polite">
                        <CheckCircle size={48} color={c.green} weight="fill" />
                        <Text style={type.title}>{recovered.target_server} is back up</Text>
                        <Text style={[type.mono, { textAlign: 'center' }]}>{recoveryLine(recovered)}</Text>
                        <Text style={[type.caption, { textAlign: 'center' }]}>
                          {recovered.id === SAMPLE_ID
                            ? 'That was a practice run. With a real service, OpsSwipe runs the fix and the health check confirms it came back.'
                            : 'The health check confirmed it. The fix is in your activity log.'}
                        </Text>
                        <Button label="Done" kind="secondary" onPress={() => setRecovered(null)} />
                      </View>
                    ) : cards.length === 0 && serviceCount === 0 ? (
                      <View style={styles.empty}>
                        <Plug size={32} color={c.green} weight="bold" />
                        <Text style={type.body}>Connect your first service</Text>
                        <Text style={[type.caption, { textAlign: 'center' }]}>
                          Add a Render service or a GCP VM. OpsSwipe watches it and pages you when it breaks.
                        </Text>
                        <Button label="Connect a service" icon={Plug} onPress={() => setTab('services')} />
                        <Button label="Try a sample incident" icon={Hand} kind="secondary" onPress={trySample} />
                      </View>
                    ) : cards.length === 0 ? (
                      <View style={styles.empty}>
                        <ShieldCheck size={32} color={c.green} weight="bold" />
                        <Text style={[type.body, { textAlign: 'center' }]}>Your apps report failures the moment they happen.</Text>
                        <Text style={[type.caption, { textAlign: 'center' }]}>
                          A health check also runs every minute. You&apos;ll get an alert when something breaks.
                        </Text>
                        <Button label="Try a sample incident" icon={Hand} kind="secondary" onPress={trySample} />
                      </View>
                    ) : (
                      cards
                        .map((inc, i) => (
                          <SwipeCard
                            key={inc.id}
                            incident={inc}
                            depth={i}
                            now={now}
                            onFix={onFix}
                            onDecline={decline}
                            onMeasure={setCardHeight}
                          />
                        ))
                        .reverse()
                    )}
                  </View>

                  <Banner state={banner} />
                </ScrollView>
                </View>

                {/* Every tab stays mounted, so a half-finished Connect keeps its state while you look around. */}
                <View style={[styles.screen, tab !== 'services' && styles.hidden]}>
                  <Services active={tab === 'services'} />
                </View>
                <View style={[styles.screen, tab !== 'activity' && styles.hidden]}>
                  <Activity audit={audit} fixed={fixed} now={now} />
                </View>
                <View style={[styles.screen, tab !== 'settings' && styles.hidden]}>
                  <Settings
                    active={tab === 'settings'}
                    pro={pro}
                    planBody={planBody}
                    onDeleteAccount={deleteAccount}
                    onSignOut={signOut}
                    onUpgrade={upgrade}
                    onManage={manage}
                    onRestore={restore}
                    onEnableAlerts={enableAlerts}
                  />
                </View>

                <TabBar
                  tab={tab}
                  alerts={down}
                  onChange={(t) => {
                    Haptics.selectionAsync();
                    setTab(t);
                    refresh().catch(() => {});
                  }}
                />
                </>
              )}
            </>
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg, paddingHorizontal: space.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 56 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  screen: { flex: 1 },
  hidden: { display: 'none' },
  plan: {
    minHeight: 32,
    paddingHorizontal: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  planPro: { borderColor: c.green, backgroundColor: c.greenTint },
  scroll: { paddingBottom: space.xxl },
  hero: { gap: space.sm, marginTop: space.md, marginBottom: space.xl },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  stack: { marginBottom: space.md },
  empty: {
    flex: 1,
    borderWidth: 1,
    borderColor: c.border,
    borderStyle: 'dashed',
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    padding: space.xl,
  },
  recovered: { borderStyle: 'solid', borderColor: c.green, backgroundColor: c.greenTint },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingHorizontal: space.xl },
});

