// Small shared primitives. Every pressable meets the 48dp touch target.
import type { Icon } from 'phosphor-react-native';
import { ArrowSquareOut, Check, CheckCircle, Copy, WarningCircle, XCircle } from 'phosphor-react-native';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { TARGET, c, radius, space, type } from './theme';

export function useNow(everyMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

type ButtonProps = { label: string; onPress: () => void; kind?: 'primary' | 'secondary'; icon?: Icon; style?: ViewStyle };

export function Button({ label, onPress, kind = 'primary', icon: IconCmp, style }: ButtonProps) {
  const primary = kind === 'primary';
  const fg = primary ? c.onGreen : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, primary ? styles.primary : styles.secondary, pressed && styles.pressed, style]}
    >
      {IconCmp && <IconCmp size={18} color={fg} weight="bold" />}
      <Text style={[type.label, { color: fg, fontSize: 15 }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, color = c.muted, tint = c.surface2 }: { label: string; color?: string; tint?: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: tint }]}>
      <Text style={[type.monoCaption, { color, fontWeight: '500' }]}>{label}</Text>
    </View>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[type.label, { color: c.muted }]} accessibilityRole="header">{title}</Text>
      {children}
    </View>
  );
}

export type BannerState = { kind: 'busy' | 'ok' | 'warn' | 'error'; text: string; link?: { label: string; url: string } } | null;

const BANNER = {
  ok: { icon: CheckCircle, color: c.green, tint: c.greenTint },
  warn: { icon: WarningCircle, color: c.amber, tint: c.amberTint },
  error: { icon: XCircle, color: c.red, tint: c.redTint },
};

// Inline feedback for the action in progress. Announced to TalkBack as it changes.
export function Banner({ state }: { state: BannerState }) {
  if (!state) return <View style={styles.bannerSpace} />;
  const b = state.kind === 'busy' ? null : BANNER[state.kind];
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: b?.tint ?? c.surface2 }]}
    >
      {b ? <b.icon size={18} color={b.color} weight="fill" /> : <ActivityIndicator size="small" color={c.muted} />}
      <Text style={[type.label, { color: b?.color ?? c.text, flex: 1 }]}>{state.text}</Text>
      {state.link && (
        <Pressable
          onPress={() => Linking.openURL(state.link!.url)}
          accessibilityRole="link"
          hitSlop={8}
          style={styles.bannerLink}
        >
          <Text style={[type.label, { color: c.text }]}>{state.link.label}</Text>
          <ArrowSquareOut size={14} color={c.text} weight="bold" />
        </Pressable>
      )}
    </View>
  );
}

export function Skeleton({ height, style }: { height: number; style?: ViewStyle }) {
  return <View style={[{ height, borderRadius: radius.card, backgroundColor: c.surface }, style]} />;
}

// A value to copy (a URL, a secret, a command), with its label and a copy button.
export function CopyRow({ label, value, lines = 4 }: { label: string; value: string; lines?: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <View style={styles.copyRow}>
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
        style={styles.copyIcon}
      >
        {copied ? <Check size={18} color={c.green} weight="bold" /> : <Copy size={18} color={c.text} weight="bold" />}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: c.surface,
    borderRadius: radius.control,
    padding: space.md,
  },
  copyIcon: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },

  button: {
    minHeight: TARGET,
    borderRadius: radius.control,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  primary: { backgroundColor: c.green },
  secondary: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  chip: { borderRadius: radius.chip, paddingHorizontal: space.sm, paddingVertical: 2, alignSelf: 'flex-start' },
  section: { gap: space.sm, marginTop: space.xl },
  banner: {
    minHeight: TARGET,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  bannerSpace: { minHeight: TARGET },
  bannerLink: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, paddingHorizontal: space.sm },
});
