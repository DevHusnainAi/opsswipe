// First-run screens, in the standard order: a short value tour (Welcome), then an account (Auth.tsx),
// then the notification permission asked in context (AlertsPrimer), as Android recommends for
// POST_NOTIFICATIONS: once the user knows why. Setup continues in the Services tab's checklist.
import { Bell, Fingerprint, Sparkle } from 'phosphor-react-native';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Incident } from './api';
import { SwipeCard } from './SwipeCard';
import { c, space, type } from './theme';
import { Button } from './ui';

const SLIDES = [
  {
    art: 'card' as const,
    title: 'Production breaks.\nYour phone knows first.',
    body: 'Failing requests become one card: what broke, the likely cause, and a fix that is already waiting.',
  },
  {
    art: Sparkle,
    title: 'AI writes the fix.\nCI proves it.',
    body: 'A patch and a regression test, opened as a pull request. CI replays the exact requests that failed before you can merge.',
  },
  {
    art: Fingerprint,
    title: 'Swipe. Fingerprint.\nBack up.',
    body: 'Nothing touches production until you approve it. Then a postmortem says why it broke and how to stop it happening again.',
  },
];

// The real card, drawn by the app (crisp at any size, always the current design), not a picture of one.
const HERO: Incident = {
  id: 'welcome',
  title: 'Requests are failing',
  target_server: 'checkout-api',
  environment: 'production',
  severity: 'CRITICAL',
  metric: 'GET /api/price → 500',
  action: 'merge_pr',
  provider: 'gcp',
  status: 'active',
  created_at: new Date().toISOString(),
  resolved_at: null,
  recovered_at: null,
  actions: ['merge_pr', 'revert_pr'],
  reason: 'Fix ready: AI patched the release that broke pricing and added a regression test.',
  suggested_by: 'ai',
  context: {
    revenue: { perHour: 38, currency: 'USD' },
    replay: [{ method: 'GET', path: '/api/price', status: 500 }],
    pr: { number: 7, url: 'https://github.com', headSha: 'hero' },
    proof: { ok: true, passed: 3, total: 3, tests: true, headSha: 'hero' },
  },
};
const HERO_NOW = Date.parse(HERO.created_at); // "just now"
const noop = async () => 'stay' as const;

export function Logo({ size = 28 }: { size?: number }) {
  return <Image source={require('../assets/logo-mark.png')} style={{ width: size, height: size }} accessibilityIgnoresInvertColors />;
}

export function Welcome({ onStart, onSignIn }: { onStart: () => void; onSignIn: () => void }) {
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const last = page === SLIDES.length - 1;

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <View style={styles.brand}>
          <Logo />
          <Text style={[type.title, { fontSize: 18 }]}>OpsSwipe</Text>
        </View>
        {!last && (
          <Pressable onPress={onStart} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip the tour">
            <Text style={[type.label, { color: c.muted }]}>Skip</Text>
          </Pressable>
        )}
      </View>

      <View style={{ flex: 1 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
          >
            {SLIDES.map((s) => (
              <View key={s.title} style={[styles.slide, { width }]}>
                <View style={styles.art}>
                  {s.art === 'card' ? (
                    <View pointerEvents="none" style={styles.hero} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                      <SwipeCard incident={HERO} depth={0} now={HERO_NOW} onFix={noop} />
                    </View>
                  ) : (
                    <View style={styles.badge}>
                      <s.art size={56} color={c.green} weight="duotone" />
                    </View>
                  )}
                </View>
                <Text style={[type.display, styles.title]} accessibilityRole="header">{s.title}</Text>
                <Text style={[type.body, { color: c.muted }]}>{s.body}</Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      <View style={styles.dots} accessibilityLabel={`Page ${page + 1} of ${SLIDES.length}`}>
        {SLIDES.map((s, i) => (
          <View key={s.title} style={[styles.dot, i === page && styles.dotOn]} />
        ))}
      </View>
      <View style={styles.actions}>
        <Button label="Get started" onPress={onStart} />
        <Button label="I already have an account" kind="secondary" onPress={onSignIn} />
      </View>
    </View>
  );
}

// Asked once, right after the account exists, with the reason spelled out first.
export function AlertsPrimer({ onDecide }: { onDecide: (enable: boolean) => void }) {
  return (
    <View style={[styles.root, { justifyContent: 'center' }]}>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
        <View style={styles.badge}>
          <Bell size={56} color={c.green} weight="duotone" />
        </View>
        <Text style={type.display} accessibilityRole="header">Get paged when something breaks</Text>
        <Text style={[type.body, { color: c.muted }]}>
          OpsSwipe alerts you the moment a service fails, and again when CI proves a fix is safe to merge. Alerts reach
          you even when the app is closed.
        </Text>
      </View>
      <View style={styles.actions}>
        <Button label="Turn on alerts" icon={Bell} onPress={() => onDecide(true)} />
        <Button label="Not now" kind="secondary" onPress={() => onDecide(false)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingVertical: space.lg, gap: space.lg },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 48 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  slide: { justifyContent: 'flex-end', gap: space.md, paddingBottom: space.md },
  art: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { width: '100%', transform: [{ rotate: '-2deg' }] },
  badge: {
    width: 112,
    height: 112,
    borderRadius: 32,
    backgroundColor: c.greenTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 30, lineHeight: 36 },
  dots: { flexDirection: 'row', gap: space.sm, justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.borderStrong },
  dotOn: { width: 20, backgroundColor: c.green },
  actions: { gap: space.sm },
});
