// First launch only. Explains the value, then asks for notifications in context
// (Android guidance: request POST_NOTIFICATIONS when the user understands why).
import type { Icon } from 'phosphor-react-native';
import { Bell, Fingerprint, HandSwipeRight } from 'phosphor-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { c, radius, space, type } from './theme';
import { Button } from './ui';

const POINTS: { icon: Icon; title: string; body: string }[] = [
  { icon: Bell, title: 'Paged when it breaks', body: 'Your app reports failures the moment they happen, and OpsSwipe alerts you.' },
  { icon: HandSwipeRight, title: 'One swipe to fix', body: 'Each incident comes with one pre-approved fix, like restarting the service.' },
  { icon: Fingerprint, title: 'Your fingerprint approves it', body: 'Nothing runs until you confirm. Every attempt lands in the audit log.' },
];

export function Onboarding({ onEnableAlerts, onSkip }: { onEnableAlerts: () => void; onSkip: () => void }) {
  return (
    <View style={styles.root}>
      <View style={styles.mark} />
      <Text style={type.display} accessibilityRole="header">Fix production from your lock screen</Text>
      <View style={styles.points}>
        {POINTS.map((p) => (
          <View key={p.title} style={styles.point}>
            <View style={styles.icon}>
              <p.icon size={20} color={c.green} weight="bold" />
            </View>
            <View style={{ flex: 1, gap: space.xs }}>
              <Text style={[type.body, { fontWeight: '600' }]}>{p.title}</Text>
              <Text style={[type.body, { color: c.muted }]}>{p.body}</Text>
            </View>
          </View>
        ))}
      </View>
      <View style={styles.actions}>
        <Button label="Turn on alerts" icon={Bell} onPress={onEnableAlerts} />
        <Button label="Not now" kind="secondary" onPress={onSkip} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', gap: space.xl, paddingVertical: space.xxl },
  mark: { width: 28, height: 28, borderRadius: radius.chip, backgroundColor: c.green },
  points: { gap: space.lg },
  point: { flexDirection: 'row', gap: space.md },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.control,
    backgroundColor: c.greenTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { gap: space.sm, marginTop: space.sm },
});
