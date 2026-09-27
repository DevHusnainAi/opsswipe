import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { ArrowClockwise, ArrowSquareOut, Crown, ShieldCheck, WarningCircle } from 'phosphor-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import Purchases from 'react-native-purchases';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuditEntry, Incident, ensureUser, execute, supabase } from './src/api';
import { fixFor } from './src/fixes';
import { recoveryLine, timeAgo } from './src/format';
import { Onboarding } from './src/Onboarding';
import { PROVIDER, SwipeCard } from './src/SwipeCard';
import { c, radius, space, type } from './src/theme';
import { Banner, type BannerState, Button, Chip, Section, Skeleton, useNow } from './src/ui';

const FREE_RUNS = 1; // mirrors the server; display only
const ONBOARDED = 'opsswipe.onboarded';
const OUTCOME = {
  executed: { label: 'Executed', color: c.green, tint: c.greenTint },
  paywalled: { label: 'Paywalled', color: c.amber, tint: c.amberTint },
  failed: { label: 'Failed', color: c.red, tint: c.redTint },
} as const;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

export default function App() {
  const [phase, setPhase] = useState<'loading' | 'onboarding' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [fixed, setFixed] = useState<Incident[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [pro, setPro] = useState(false);
  const [freeUsed, setFreeUsed] = useState(0);
  const [banner, setBanner] = useState<BannerState>(null);
  const [cardHeight, setCardHeight] = useState(420);
  const channel = useRef<ReturnType<typeof supabase.channel>>(undefined);
  const purchasesReady = useRef(false);
  const now = useNow();

  const refresh = useCallback(async () => {
    const [i, r, a, u] = await Promise.all([
      supabase.from('incidents').select().in('status', ['active', 'resolving']).order('created_at'),
      supabase.from('incidents').select().eq('status', 'resolved').order('resolved_at', { ascending: false }).limit(3),
      supabase.from('audit_log').select().order('created_at', { ascending: false }).limit(5),
      supabase.from('usage').select('free_used').maybeSingle(),
    ]);
    const failed = i.error ?? r.error ?? a.error ?? u.error;
    if (failed) throw failed;
    setIncidents(i.data ?? []);
    setFixed(r.data ?? []);
    setAudit(a.data ?? []);
    setFreeUsed(u.data?.free_used ?? 0);
  }, []);

  const boot = useCallback(async () => {
    try {
      const uid = await ensureUser();
      if (!purchasesReady.current) {
        Purchases.configure({ apiKey: process.env.EXPO_PUBLIC_RC_KEY!, appUserID: uid });
        Purchases.addCustomerInfoUpdateListener((info) => setPro(!!info.entitlements.active.pro));
        purchasesReady.current = true;
      }
      // The listener only fires on changes; read the current plan once at startup.
      try {
        setPro(!!(await Purchases.getCustomerInfo()).entitlements.active.pro);
      } catch {
        // offline or not configured: the server still enforces the plan on every fix
      }
      // Creating a channel doesn't prompt on Android 13+; the permission is asked in onboarding.
      await Notifications.setNotificationChannelAsync('incidents', {
        name: 'Incidents',
        description: 'A health check failed and a fix is waiting for you.',
        importance: Notifications.AndroidImportance.MAX,
      });
      await refresh();
      channel.current ??= supabase
        .channel('ops')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incidents' }, ({ new: inc }) => {
          Notifications.scheduleNotificationAsync({
            content: { title: `${inc.severity}: ${inc.title}`, body: `${inc.target_server} · ${inc.metric}` },
            trigger: { channelId: 'incidents' },
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public' }, () => refresh().catch(() => {}))
        .subscribe();
      setPhase((await AsyncStorage.getItem(ONBOARDED)) ? 'ready' : 'onboarding');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, [refresh]);

  useEffect(() => {
    // Fetch on mount: boot() only sets state after its awaits, which the rule can't see across the call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    boot();
    return () => {
      if (channel.current) supabase.removeChannel(channel.current);
    };
  }, [boot]);

  const finishOnboarding = async (askForAlerts: boolean) => {
    if (askForAlerts) await Notifications.requestPermissionsAsync();
    await AsyncStorage.setItem(ONBOARDED, '1');
    setPhase('ready');
  };

  const run = async (inc: Incident, action: string) => {
    const fix = fixFor(action);
    setBanner({ kind: 'busy', text: `${fix.doing} ${inc.target_server}` });
    const res = await execute(inc.id, action);
    if (res.result === 'error') setBanner({ kind: 'error', text: 'The fix failed. Details are in the activity log.' });
    if (res.result === 'ok') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBanner(
        action === 'revert_pr' && res.detail?.startsWith('https://')
          ? { kind: 'ok', text: 'Revert PR opened. Roll back to restore service now.', link: { label: 'Open PR', url: res.detail } }
          : { kind: 'ok', text: `${fix.verb} sent. Waiting for ${inc.target_server} to come back.` },
      );
    }
    return res.result;
  };

  // FR-12 → FR-14: the card snaps back first, then the paywall slides up.
  const upsell = async (inc: Incident, action: string) => {
    setBanner({ kind: 'warn', text: 'Your free fix is used. Upgrade to keep fixing.' });
    const res = await RevenueCatUI.presentPaywall();
    if (res === PAYWALL_RESULT.PURCHASED || res === PAYWALL_RESULT.RESTORED) await run(inc, action); // already authorized
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
    const result = await run(inc, action);
    if (result === 'paywall') setTimeout(() => upsell(inc, action), 350);
    if (result !== 'ok') return 'failed' as const;
    return action === 'revert_pr' ? ('stay' as const) : ('done' as const);
  };

  const down = incidents.length;
  const fixesLeft = Math.max(0, FREE_RUNS - freeUsed);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.root}>
          <StatusBar style="light" />

          {phase === 'onboarding' && (
            <Onboarding onEnableAlerts={() => finishOnboarding(true)} onSkip={() => finishOnboarding(false)} />
          )}

          {phase !== 'onboarding' && (
            <>
              <View style={styles.header}>
                <View style={styles.brand}>
                  <View style={styles.mark} />
                  <Text style={[type.monoStrong, { fontWeight: '600' }]}>opsswipe</Text>
                </View>
                <Pressable
                  onPress={() => !pro && RevenueCatUI.presentPaywall()}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={pro ? 'Pro plan, unlimited fixes' : `Free plan, ${fixesLeft} fix left. Opens upgrade options.`}
                  style={({ pressed }) => [styles.plan, pro && styles.planPro, pressed && { opacity: 0.8 }]}
                >
                  {pro && <Crown size={14} color={c.green} weight="fill" />}
                  <Text style={[type.label, { color: pro ? c.green : c.text }]}>
                    {pro ? 'Pro' : `Free · ${fixesLeft} fix left`}
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
                <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                  <View style={styles.hero}>
                    <View style={styles.statusRow}>
                      <View style={[styles.dot, { backgroundColor: down ? c.red : c.green }]} />
                      <Text style={[type.label, { color: down ? c.red : c.green }]}>
                        {down ? `${down} service${down > 1 ? 's' : ''} down` : 'All systems operational'}
                      </Text>
                    </View>
                    <Text style={type.display} accessibilityRole="header">
                      {down ? 'A fix is waiting for you' : 'Nothing to fix'}
                    </Text>
                  </View>

                  <View style={[styles.stack, { height: down ? cardHeight + 24 : 300 }]}>
                    {down === 0 ? (
                      <View style={styles.empty}>
                        <ShieldCheck size={32} color={c.green} weight="bold" />
                        <Text style={type.body}>Health checks run every 15 seconds.</Text>
                        <Text style={[type.caption, { textAlign: 'center' }]}>
                          You&apos;ll get an alert the moment one fails.
                        </Text>
                      </View>
                    ) : (
                      incidents
                        .map((inc, i) => (
                          <SwipeCard
                            key={inc.id}
                            incident={inc}
                            depth={i}
                            now={now}
                            onFix={onFix}
                            onMeasure={setCardHeight}
                          />
                        ))
                        .reverse()
                    )}
                  </View>

                  <Banner state={banner} />

                  {fixed.length > 0 && (
                    <Section title="Recent fixes">
                      <View style={styles.group}>
                        {fixed.map((f) => (
                          <View key={f.id} style={styles.row}>
                            <View style={[styles.dot, { backgroundColor: f.recovered_at ? c.green : c.amber }]} />
                            <View style={{ flex: 1, gap: 2 }}>
                              <Text style={type.mono}>{f.target_server}</Text>
                              <Text style={type.caption}>{recoveryLine(f)}</Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    </Section>
                  )}

                  <Section title="Activity">
                    {audit.length === 0 ? (
                      <Text style={type.caption}>Every fix you approve, block or retry shows up here.</Text>
                    ) : (
                      <View style={styles.group}>
                        {audit.map((a) => {
                          const o = OUTCOME[a.outcome as keyof typeof OUTCOME] ?? OUTCOME.failed;
                          const link = a.detail?.match(/https:\/\/\S+/)?.[0];
                          return (
                            <Pressable
                              key={a.id}
                              disabled={!link}
                              onPress={() => link && Linking.openURL(link)}
                              accessibilityRole={link ? 'link' : undefined}
                              style={styles.row}
                            >
                              <Chip label={o.label} color={o.color} tint={o.tint} />
                              <Text style={[type.mono, { flex: 1 }]} numberOfLines={1}>
                                {fixFor(a.action).label} {a.target}
                              </Text>
                              {link ? (
                                <ArrowSquareOut size={16} color={c.muted} weight="bold" />
                              ) : (
                                <Text style={type.monoCaption}>{timeAgo(a.created_at, now)}</Text>
                              )}
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </Section>
                </ScrollView>
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
  mark: { width: 12, height: 12, borderRadius: 3, backgroundColor: c.green },
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
  group: { backgroundColor: c.surface, borderRadius: radius.card, padding: space.lg, gap: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingHorizontal: space.xl },
});

