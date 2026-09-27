// First launch only. Step 1 explains the value and asks for notifications in context (Android guidance:
// request POST_NOTIFICATIONS when the user understands why). Step 2 leads into connecting something.
import type { Icon } from 'phosphor-react-native';
import { Bell, Cloud, Fingerprint, GithubLogo, HandSwipeRight, HardDrives, Plug } from 'phosphor-react-native';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { c, radius, space, type } from './theme';
import { Button } from './ui';

const POINTS: { icon: Icon; title: string; body: string }[] = [
  { icon: Bell, title: 'Paged when it breaks', body: 'Your app reports failures the moment they happen, and OpsSwipe alerts you.' },
  { icon: HandSwipeRight, title: 'One swipe to fix', body: 'Each incident comes with one pre-approved fix, like restarting the service.' },
  { icon: Fingerprint, title: 'Your fingerprint approves it', body: 'Nothing runs until you confirm. Every attempt lands in the audit log.' },
];

const CONNECT: { icon: Icon; title: string; body: string }[] = [
  { icon: GithubLogo, title: 'GitHub', body: 'Revert a bad release and merge the fix once CI proves it.' },
  { icon: Cloud, title: 'Render', body: 'Restart a service or roll back to the last good deploy.' },
  { icon: HardDrives, title: 'Google Cloud', body: 'Reset one VM. OpsSwipe gets nothing else.' },
];

type Props = {
  onAlerts: (enable: boolean) => Promise<void>;
  onSignIn: () => Promise<unknown>;
  onDone: (openServices: boolean) => void;
};

export function Onboarding({ onAlerts, onSignIn, onDone }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alerts = async (enable: boolean) => {
    await onAlerts(enable).catch(() => {});
    setStep(2);
  };
  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      if (await onSignIn()) onDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const points = step === 1 ? POINTS : CONNECT;
  return (
    <View style={styles.root}>
      <View style={styles.mark} />
      <Text style={type.display} accessibilityRole="header">
        {step === 1 ? 'Fix production from your lock screen' : 'Connect what you run'}
      </Text>
      <View style={styles.points}>
        {points.map((p) => (
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
      {error && <Text style={[type.label, { color: c.red }]} accessibilityLiveRegion="polite">{error}</Text>}
      {step === 1
        ? (
          <View style={styles.actions}>
            <Button label="Turn on alerts" icon={Bell} onPress={() => alerts(true)} />
            <Button label="Not now" kind="secondary" onPress={() => alerts(false)} />
          </View>
        )
        : (
          <View style={styles.actions}>
            <Button label={busy ? 'Opening GitHub…' : 'Sign in with GitHub'} icon={GithubLogo} onPress={signIn} />
            <Text style={[type.caption, { textAlign: 'center' }]}>Keeps your setup when you switch phones.</Text>
            <Button label="Connect a service" icon={Plug} kind="secondary" onPress={() => onDone(true)} />
            <Button label="Look around first" kind="secondary" onPress={() => onDone(false)} />
          </View>
        )}
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
