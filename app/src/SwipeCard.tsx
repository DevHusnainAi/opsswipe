import * as Haptics from 'expo-haptics';
import { ArrowRight, ArrowSquareOut, Fingerprint, Flask, ListChecks, SealCheck, SealWarning, Sparkle } from 'phosphor-react-native';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { Incident } from './api';
import { fixFor } from './fixes';
import { timeAgo } from './format';
import { TARGET, c, radius, space, type } from './theme';
import { Chip } from './ui';

const THRESHOLD = 0.75; // FR-07: fraction of screen width that authorizes the action
// Springs jump straight to the end when the system "reduce motion" setting is on.
const SPRING = { damping: 15, stiffness: 120, reduceMotion: ReduceMotion.System };
export const PROVIDER: Record<string, string> = { gcp: 'GCP Compute', render: 'Render' };

// Progressive haptics (Android haptics principles): subtle ticks at 1/3 and 2/3, a distinct one at the threshold.
const tick = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
const arm = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

type Props = {
  incident: Incident;
  depth: number; // 0 = top of the stack
  now: number;
  // done: card leaves · stay: fix ran but the incident stays open (revert PR) · failed: snap back + error haptic
  onFix: (incident: Incident, action: string) => Promise<'done' | 'stay' | 'failed'>;
};

export function SwipeCard({ incident, depth, now, onFix }: Props) {
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const limit = width * THRESHOLD;
  const x = useSharedValue(0);
  const stage = useSharedValue(0);
  const top = depth === 0;
  const live = top && incident.status === 'active';
  // The suggested fix is preselected; the engineer can pick another allowlisted one.
  const [picked, setPicked] = useState<string | null>(null);
  const choice = picked ?? incident.action;
  const fix = fixFor(choice);
  const options = incident.actions?.length ? incident.actions : [incident.action];

  const commit = async (action: string = choice) => {
    const outcome = await onFix(incident, action);
    if (outcome === 'failed') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    if (outcome !== 'done') x.value = withSpring(0, SPRING);
  };

  // Tap alternative to the swipe (WCAG 2.2, 2.5.7). The fingerprint prompt confirms either way.
  const tapFix = (action: string = choice) => {
    if (!live) return;
    x.value = withSpring(width * 1.3, SPRING);
    commit(action);
  };

  const pan = Gesture.Pan()
    .enabled(live)
    .activeOffsetX([-10, 10])
    .failOffsetY([-12, 12]) // vertical drags scroll the page instead
    .onUpdate((e) => {
      const next = Math.max(0, e.translationX);
      const p = next / limit;
      const s = p >= 1 ? 3 : p >= 0.66 ? 2 : p >= 0.33 ? 1 : 0;
      if (s > stage.value) scheduleOnRN(s === 3 ? arm : tick);
      stage.value = s;
      x.value = next;
    })
    .onEnd(() => {
      stage.value = 0;
      if (x.value >= limit) {
        x.value = withSpring(width * 1.3, SPRING);
        scheduleOnRN(commit);
      } else {
        x.value = withSpring(0, SPRING);
      }
    });

  const cardStyle = useAnimatedStyle(() => {
    const p = Math.min(x.value / limit, 1);
    return {
      transform: [
        { translateX: x.value },
        { translateY: depth * 10 },
        { scale: 1 - depth * 0.04 },
        { rotate: reduceMotion ? '0deg' : `${interpolate(x.value, [0, width], [0, 4])}deg` },
      ],
      borderColor: p >= 1 ? c.green : interpolateColor(p, [0, 1], [c.border, c.borderStrong]),
    };
  });
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.min(x.value / limit, 1) }] }));
  const idleLabel = useAnimatedStyle(() => ({ opacity: x.value >= limit ? 0 : 1 }));
  const armedLabel = useAnimatedStyle(() => ({ opacity: x.value >= limit ? 1 : 0 }));

  const critical = incident.severity === 'CRITICAL';

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.card, { zIndex: 10 - depth, opacity: depth > 2 ? 0 : 1 - depth * 0.25 }, cardStyle]}
        accessible={top}
        importantForAccessibility={top ? 'yes' : 'no-hide-descendants'}
        accessibilityLabel={`${incident.severity} incident. ${incident.title} on ${incident.target_server}. ${incident.metric}. ${proofText(incident.context) ?? ''}`}
        accessibilityHint={live ? `Suggested fix: ${fix.label}. ${incident.reason ?? ''} Double tap to run it, or pick another fix from the actions menu.` : undefined}
        accessibilityActions={live
          ? [
            { name: 'activate', label: `${fix.verb} ${incident.target_server}` },
            ...options.filter((a) => a !== choice).map((a) => ({ name: `fix_${a}`, label: `${fixFor(a).verb} ${incident.target_server}` })),
          ]
          : []}
        onAccessibilityAction={(e) => {
          const name = e.nativeEvent.actionName;
          if (name === 'activate') tapFix();
          else if (name.startsWith('fix_')) tapFix(name.slice(4));
        }}
      >
        <View style={styles.meta}>
          <Chip label={incident.severity} color={critical ? c.red : c.amber} tint={critical ? c.redTint : c.amberTint} />
          {incident.provider && <Chip label={PROVIDER[incident.provider] ?? incident.provider} />}
          <Text style={[type.monoCaption, styles.time]}>{timeAgo(incident.created_at, now)}</Text>
        </View>

        <View style={{ gap: space.xs }}>
          <Text style={type.title}>{incident.title}</Text>
          <Text style={type.monoStrong}>{incident.target_server}</Text>
        </View>

        <View style={styles.evidence}>
          <Text style={type.mono}>{incident.metric}</Text>
          {incident.reason && (
            <View style={styles.reason}>
              {incident.suggested_by === 'ai'
                ? <Sparkle size={16} color={c.green} weight="fill" />
                : <ListChecks size={16} color={c.muted} weight="bold" />}
              <Text style={[type.body, { flex: 1, fontSize: 14, lineHeight: 20 }]}>
                {incident.reason}
                <Text style={type.caption}>{incident.suggested_by === 'ai' ? '  Claude' : '  Rules'}</Text>
              </Text>
            </View>
          )}
        </View>

        <ProofStrip context={incident.context} />

        {options.length > 1 && (
          <View style={styles.picker}>
            {options.map((a) => {
              const f = fixFor(a);
              const on = a === choice;
              return (
                <Pressable
                  key={a}
                  disabled={!live}
                  onPress={() => setPicked(a)}
                  hitSlop={4}
                  style={[styles.option, on && styles.optionOn]}
                >
                  <f.icon size={16} color={on ? c.green : c.muted} weight="bold" />
                  <Text style={[type.label, { color: on ? c.green : c.text }]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.footer}>
          <View style={styles.rail}>
            <Animated.View style={[styles.fill, fillStyle]} />
            <ArrowRight size={18} color={live ? c.green : c.muted} weight="bold" />
            <View style={{ flex: 1 }}>
              <Animated.Text style={[type.label, idleLabel]} numberOfLines={1}>
                {live ? fix.rail : 'Fix in progress'}
              </Animated.Text>
              <Animated.Text style={[type.label, styles.armed, armedLabel]} numberOfLines={1}>
                Release to {fix.label.toLowerCase()}
              </Animated.Text>
            </View>
          </View>
          <Pressable
            onPress={() => tapFix()}
            disabled={!live}
            accessibilityRole="button"
            accessibilityLabel={`${fix.verb} ${incident.target_server}`}
            style={({ pressed }) => [styles.fixButton, !live && styles.fixDisabled, pressed && styles.pressed]}
          >
            <Fingerprint size={24} color={live ? c.onGreen : c.muted} weight="bold" />
          </Pressable>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

// Proof only counts for the PR commit OpsSwipe opened (the server enforces the same rule).
function proofState(ctx: Incident['context']) {
  const pr = ctx?.pr;
  if (!pr) return null;
  const proof = ctx?.proof?.headSha === pr.headSha ? ctx.proof : undefined;
  return { pr, proof, samples: ctx?.replay?.length ?? 0 };
}

function proofText(ctx: Incident['context']) {
  const st = proofState(ctx);
  if (!st) return null;
  const { pr, proof, samples } = st;
  if (!proof) return `PR #${pr.number}: CI is replaying ${samples} failing production request${samples === 1 ? '' : 's'}`;
  if (proof.ok) return `${proof.passed}/${proof.total} failing production requests now pass, tests pass`;
  return `Proof failed: ${proof.passed}/${proof.total} pass${proof.tests ? '' : ', tests fail'}`;
}

function ProofStrip({ context }: { context: Incident['context'] }) {
  const st = proofState(context);
  if (!st) return null;
  const { pr, proof } = st;
  const [Icon, color, tint] = !proof
    ? [Flask, c.muted, c.surface2]
    : proof.ok
    ? [SealCheck, c.green, c.greenTint]
    : [SealWarning, c.red, c.redTint];
  return (
    <Pressable
      onPress={() => Linking.openURL(proof?.runUrl ?? pr.url)}
      accessibilityRole="link"
      style={[styles.proof, { backgroundColor: tint }]}
    >
      <Icon size={16} color={color} weight="fill" />
      <Text style={[type.label, { color, flex: 1 }]}>{proofText(context)}</Text>
      <ArrowSquareOut size={14} color={color} weight="bold" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.lg,
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  time: { marginLeft: 'auto' },
  evidence: { backgroundColor: c.surface2, borderRadius: radius.control, padding: space.md, gap: space.sm },
  reason: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  picker: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  proof: {
    minHeight: 40,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  option: {
    minHeight: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: c.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  optionOn: { borderColor: c.green, backgroundColor: c.greenTint },
  footer: { flexDirection: 'row', gap: space.sm },
  rail: {
    flex: 1,
    height: TARGET,
    borderRadius: radius.control,
    backgroundColor: c.surface2,
    borderWidth: 1,
    borderColor: c.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    overflow: 'hidden',
  },
  fill: { ...StyleSheet.absoluteFill, backgroundColor: c.greenTint, transformOrigin: 'left' },
  armed: { position: 'absolute', color: c.green },
  fixButton: {
    width: TARGET,
    height: TARGET,
    borderRadius: radius.control,
    backgroundColor: c.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fixDisabled: { backgroundColor: c.surface2 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
});
