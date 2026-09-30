// Create account / Sign in. GitHub is the primary way in (the users are developers); email and
// password work too, with password reset. Every screen here has one job and one primary button.
import { ArrowLeft, Envelope, Eye, EyeSlash, GithubLogo, GoogleLogo, ShieldCheck } from 'phosphor-react-native';
import { type ReactNode, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { sendPasswordReset, setNewPassword, signInWith, signInWithEmail, signUpWithEmail } from './api';
import { Logo } from './Onboarding';
import { c, radius, space, TARGET, type } from './theme';
import { Button } from './ui';

const PRIVACY = 'https://github.com/DevHusnainAi/opsswipe/blob/main/PRIVACY.md';
const TERMS = 'https://github.com/DevHusnainAi/opsswipe/blob/main/TERMS.md';

export type AuthMode = 'signup' | 'signin';
type Step = AuthMode | 'forgot' | 'sent' | 'confirm';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Props = {
  mode: AuthMode;
  onBack?: () => void;
  onSignedIn: (uid: string, isNew: boolean) => void;
};

export function Auth({ mode, onBack, onSignedIn }: Props) {
  const [view, setView] = useState<Step>(mode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<'github' | 'google' | 'email' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: 'github' | 'google' | 'email', fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const oauth = (provider: 'github' | 'google') =>
    run(provider, async () => {
      const s = await signInWith(provider);
      if (s) onSignedIn(s.uid, view === 'signup');
    });

  const submit = () =>
    run('email', async () => {
      const addr = email.trim().toLowerCase();
      if (!EMAIL.test(addr)) throw new Error('Enter a valid email address.');
      if (view === 'forgot') {
        await sendPasswordReset(addr);
        setView('sent');
        return;
      }
      if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
      if (view === 'signup') {
        const uid = await signUpWithEmail(addr, password);
        if (uid) onSignedIn(uid, true);
        else setView('confirm');
      } else {
        onSignedIn(await signInWithEmail(addr, password), false);
      }
    });

  const switchTo = (v: Step) => {
    setError(null);
    setView(v);
  };

  if (view === 'sent' || view === 'confirm') {
    return (
      <View style={styles.root}>
        <View style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
          <View style={styles.badge}>
            <Envelope size={48} color={c.green} weight="duotone" />
          </View>
          <Text style={type.display} accessibilityRole="header">Check your inbox</Text>
          <Text style={[type.body, { color: c.muted }]}>
            {view === 'sent'
              ? `We sent a link to ${email.trim()}. Open it on this phone to choose a new password.`
              : `We sent a confirmation link to ${email.trim()}. Open it on this phone to finish creating your account.`}
          </Text>
        </View>
        <Button label="Back to sign in" kind="secondary" onPress={() => switchTo('signin')} />
      </View>
    );
  }

  const title = view === 'signup' ? 'Create your account' : view === 'signin' ? 'Welcome back' : 'Reset your password';
  const sub =
    view === 'signup'
      ? 'Your services, fixes and plan are saved to your account and follow you to any phone.'
      : view === 'signin'
      ? 'Sign in to see your services and incidents.'
      : 'Enter your email and we will send you a link to set a new password.';

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.top}>
          {onBack || view === 'forgot' ? (
            <Pressable
              onPress={() => (view === 'forgot' ? switchTo('signin') : onBack?.())}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={styles.back}
            >
              <ArrowLeft size={22} color={c.text} weight="bold" />
            </Pressable>
          ) : (
            <View style={styles.back} />
          )}
          <Logo size={24} />
          <View style={styles.back} />
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={type.display} accessibilityRole="header">{title}</Text>
          <Text style={[type.body, { color: c.muted }]}>{sub}</Text>
        </View>

        {view !== 'forgot' && (
          <>
            <Pressable
              onPress={() => oauth('github')}
              disabled={!!busy}
              accessibilityRole="button"
              style={({ pressed }) => [styles.github, pressed && { opacity: 0.85 }]}
            >
              <GithubLogo size={20} color={c.bg} weight="fill" />
              <Text style={[type.label, { color: c.bg, fontSize: 16 }]}>
                {busy === 'github' ? 'Opening GitHub…' : 'Continue with GitHub'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => oauth('google')}
              disabled={!!busy}
              accessibilityRole="button"
              style={({ pressed }) => [styles.google, pressed && { opacity: 0.85 }]}
            >
              <GoogleLogo size={20} color={c.text} weight="bold" />
              <Text style={[type.label, { fontSize: 16 }]}>
                {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
              </Text>
            </Pressable>
            <View style={styles.or}>
              <View style={styles.rule} />
              <Text style={type.caption}>or with email</Text>
              <View style={styles.rule} />
            </View>
          </>
        )}

        <View style={{ gap: space.md }}>
          <Field label="Email" value={email} onChange={setEmail} placeholder="you@company.com" keyboard="email-address" autoComplete="email" />
          {view !== 'forgot' && (
            <Field
              label="Password"
              value={password}
              onChange={setPassword}
              placeholder={view === 'signup' ? 'At least 8 characters' : 'Your password'}
              secure={!show}
              autoComplete={view === 'signup' ? 'new-password' : 'current-password'}
              trailing={
                <Pressable onPress={() => setShow(!show)} hitSlop={10} accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'}>
                  {show ? <EyeSlash size={20} color={c.muted} /> : <Eye size={20} color={c.muted} />}
                </Pressable>
              }
            />
          )}
          {view === 'signin' && (
            <Pressable onPress={() => switchTo('forgot')} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'flex-end' }}>
              <Text style={[type.label, { color: c.green }]}>Forgot password?</Text>
            </Pressable>
          )}
        </View>

        {error && <Text style={[type.label, styles.error]} accessibilityLiveRegion="polite">{error}</Text>}

        <Button
          label={
            busy === 'email'
              ? 'Please wait…'
              : view === 'signup'
              ? 'Create account'
              : view === 'signin'
              ? 'Sign in'
              : 'Send reset link'
          }
          onPress={submit}
        />

        {view !== 'forgot' && (
          <Pressable
            onPress={() => switchTo(view === 'signup' ? 'signin' : 'signup')}
            accessibilityRole="button"
            style={styles.switch}
          >
            <Text style={type.body}>
              <Text style={{ color: c.muted }}>{view === 'signup' ? 'Already have an account? ' : 'New to OpsSwipe? '}</Text>
              <Text style={{ color: c.green, fontWeight: '600' }}>{view === 'signup' ? 'Sign in' : 'Create an account'}</Text>
            </Text>
          </Pressable>
        )}

        {/* The empty lower half answers the question people have before connecting production. */}
        {view === 'signup' && (
          <View style={styles.trust}>
            <ShieldCheck size={18} color={c.green} weight="fill" />
            <Text style={[type.caption, { flex: 1 }]}>
              Nothing runs on your servers until you approve it with your fingerprint. Code fixes merge only after CI
              proves them.{' '}
              <Text style={{ color: c.text }} onPress={() => Linking.openURL(PRIVACY)} accessibilityRole="link">
                Privacy
              </Text>
              <Text style={{ color: c.muted }}>{' · '}</Text>
              <Text style={{ color: c.text }} onPress={() => Linking.openURL(TERMS)} accessibilityRole="link">
                Terms
              </Text>
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Shown after a password-reset link signs the user in.
export function NewPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setError(null);
    if (password.length < 8) return setError('Use at least 8 characters for your password.');
    setBusy(true);
    try {
      await setNewPassword(password);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[styles.root, { justifyContent: 'center' }]}>
      <View style={{ gap: space.lg }}>
        <Text style={type.display} accessibilityRole="header">Choose a new password</Text>
        <Field label="New password" value={password} onChange={setPassword} placeholder="At least 8 characters" secure autoComplete="new-password" />
        {error && <Text style={[type.label, styles.error]}>{error}</Text>}
        <Button label={busy ? 'Saving…' : 'Save password'} onPress={save} />
      </View>
    </View>
  );
}

function Field(f: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  secure?: boolean;
  keyboard?: 'email-address';
  autoComplete?: 'email' | 'new-password' | 'current-password';
  trailing?: ReactNode;
}) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={type.label}>{f.label}</Text>
      <View style={styles.input}>
        <TextInput
          value={f.value}
          onChangeText={f.onChange}
          placeholder={f.placeholder}
          placeholderTextColor={c.muted}
          secureTextEntry={f.secure}
          keyboardType={f.keyboard}
          autoComplete={f.autoComplete}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={f.label}
          style={[type.body, { flex: 1, paddingVertical: 0 }]}
        />
        {f.trailing}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingVertical: space.lg, gap: space.lg },
  scroll: { flexGrow: 1, gap: space.xl, paddingBottom: space.xxl },
  trust: { marginTop: 'auto', flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 },
  back: { width: TARGET, height: TARGET, justifyContent: 'center' },
  github: {
    minHeight: 52,
    borderRadius: radius.control,
    backgroundColor: c.text,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  google: {
    minHeight: 52,
    borderRadius: radius.control,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderStrong,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  or: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rule: { flex: 1, height: 1, backgroundColor: c.border },
  input: {
    minHeight: 52,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  error: { color: c.red, backgroundColor: c.redTint, padding: space.md, borderRadius: radius.control },
  switch: { alignItems: 'center', minHeight: TARGET, justifyContent: 'center' },
  badge: {
    width: 96,
    height: 96,
    borderRadius: radius.badge,
    backgroundColor: c.greenTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
