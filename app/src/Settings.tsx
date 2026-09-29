// The Settings tab: who you are, your plan, whether alerts can reach you, and about.
import Constants from 'expo-constants';
import type { Icon } from 'phosphor-react-native';
import {
  ArrowCounterClockwise,
  ArrowSquareOut,
  Bell,
  ChatCircleText,
  BellSlash,
  CreditCard,
  DiscordLogo,
  Crown,
  GithubLogo,
  Info,
  ShieldCheck,
  SignOut,
  SlackLogo,
  Trash,
  UserCircle,
} from 'phosphor-react-native';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { AgentAccess } from './AgentAccess';
import { canSignInHere, SlackSignIn } from './SlackSignIn';
import { type ConnectStatus, connect, supabase } from './api';
import * as WebBrowser from 'expo-web-browser';
import { appBase, appLink, inExpoGo, Notifications } from './env';
import { paramsOf } from './format';
import { c, radius, space, TARGET, type } from './theme';
import { Section } from './ui';

const REPO = 'https://github.com/DevHusnainAi/opsswipe';

type Props = {
  active: boolean;
  pro: boolean;
  planBody: string;
  onDeleteAccount: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onUpgrade: () => Promise<void>;
  onManage: () => Promise<void>;
  onRestore: () => Promise<boolean>;
  onEnableAlerts: () => Promise<void>;
};

type Alerts = 'on' | 'off' | 'unavailable';

export function Settings(p: Props) {
  const [login, setLogin] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<Alerts>('unavailable');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [channel, setChannel] = useState<ConnectStatus['alerts'] | null>(null);

  const load = useCallback(async () => {
    const user = (await supabase.auth.getUser()).data.user;
    // GitHub accounts show @username; email accounts show the address.
    setLogin(user?.user_metadata?.user_name ? `@${user.user_metadata.user_name}` : (user?.email ?? null));
    setAlerts(Notifications ? ((await Notifications.getPermissionsAsync()).granted ? 'on' : 'off') : 'unavailable');
    setChannel((await connect<ConnectStatus>('status')).alerts);
  }, []);

  useEffect(() => {
    // Reloads each time the tab opens; state is only set after the awaits inside load().
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (p.active) load().catch(() => {});
  }, [p.active, load]);

  // Coming back from the system settings page: show the permission as it is now.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && p.active) load().catch(() => {});
    });
    return () => sub.remove();
  }, [p.active, load]);

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setNote(null);
    try {
      const done = await fn();
      if (done) setNote({ text: done });
      await load();
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(null);
    }
  };

  // The server stores the channel when the provider calls back, so whatever the browser returns,
  // looking again (run's load) shows the result. Slack goes through SlackSignIn (see why there).
  const [slackUrl, setSlackUrl] = useState<string | null>(null);
  const addChat = (kind: 'slack' | 'discord') =>
    run(kind, async () => {
      const { url } = await connect<{ url: string }>('alerts_start', { kind, returnTo: appBase });
      if (kind === 'slack' && canSignInHere) return void setSlackUrl(url);
      const r = await WebBrowser.openAuthSessionAsync(url, appLink('connect'));
      const name = kind === 'slack' ? 'Slack' : 'Discord';
      if (r.type === 'success' && paramsOf(r.url).error) throw new Error(`${name} did not finish. Try again.`);
      if (!(await connect<ConnectStatus>('status')).alerts.connected) {
        return kind === 'slack'
          ? 'Slack sign-in needs the latest app build on this phone (a phone browser can\'t sign in to Slack).'
          : 'Not connected yet: pick a channel and tap Authorize.';
      }
    });

  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <Text style={[type.display, { marginTop: space.md }]} accessibilityRole="header">Settings</Text>
      {note && (
        <Text style={[type.label, styles.note, note.error && styles.noteError]} accessibilityLiveRegion="polite">
          {note.text}
        </Text>
      )}

      <Section title="Account">
        <View style={styles.group}>
          <Row
            icon={UserCircle}
            title={login ? `Signed in as ${login}` : 'Signed in'}
            body="Your services, fixes and plan follow you to any phone."
          />
          <Action
            icon={SignOut}
            label={busy === 'signout' ? 'Signing out…' : 'Sign out'}
            danger
            onPress={() => run('signout', p.onSignOut)}
          />
          <Action
            icon={Trash}
            label={busy === 'delete' ? 'Deleting…' : confirmDelete ? 'Tap again to delete everything' : 'Delete account'}
            danger
            onPress={() => {
              // Two taps: nothing irreversible happens on one.
              if (!confirmDelete) return setConfirmDelete(true);
              setConfirmDelete(false);
              run('delete', p.onDeleteAccount);
            }}
          />
          {confirmDelete && (
            <Text style={[type.caption, { paddingBottom: space.md }]}>
              Deletes your services, connections, incidents and history, and revokes Google access. Your subscription
              is managed by the store: cancel it there. Remove the GitHub App on GitHub.
            </Text>
          )}
        </View>
      </Section>

      <Section title="Plan">
        <View style={styles.group}>
          <Row
            icon={Crown}
            tint={p.pro ? c.green : undefined}
            title={p.pro ? 'OpsSwipe Pro' : 'Free'}
            body={p.planBody}
          />
          {!p.pro && (
            <Action icon={Crown} label="Upgrade to Pro" primary onPress={() => run('upgrade', p.onUpgrade)} />
          )}
          {inExpoGo && (
            <Text style={[type.caption, { paddingBottom: space.md }]}>
              You are in Expo Go, where RevenueCat runs in preview mode: the paywall and purchases open only in the
              OpsSwipe app.
            </Text>
          )}
          {p.pro && (
            <Action icon={CreditCard} label="Manage subscription" onPress={() => run('manage', p.onManage)} />
          )}
          <Action
            icon={ArrowCounterClockwise}
            label={busy === 'restore' ? 'Restoring…' : 'Restore purchases'}
            onPress={() => run('restore', async () => ((await p.onRestore()) ? 'Pro restored.' : 'No purchases to restore on this account.'))}
          />
        </View>
      </Section>

      <Section title="Alerts">
        <View style={styles.group}>
          <Row
            icon={alerts === 'on' ? Bell : BellSlash}
            tint={alerts === 'on' ? c.green : c.amber}
            title={alerts === 'on' ? 'Alerts are on' : alerts === 'off' ? 'Alerts are off' : 'Alerts need the OpsSwipe app'}
            body={
              alerts === 'on'
                ? 'You are paged when a service breaks and when CI proves a fix, even with the app closed.'
                : alerts === 'off'
                ? 'Turn them on so a broken service can reach you.'
                : inExpoGo
                ? 'Expo Go cannot receive push alerts. New incidents still appear live while the app is open.'
                : 'Push alerts are not available on this device.'
            }
          />
          {alerts === 'off' && (
            <Action icon={Bell} label="Turn on alerts" primary onPress={() => run('alerts', p.onEnableAlerts)} />
          )}
          {alerts !== 'unavailable' && (
            <Action icon={ArrowSquareOut} label="Open system notification settings" onPress={() => Linking.openSettings()} />
          )}
        </View>
        {/* A second channel: when the phone is on silent, the team channel still sees it. One click: the
            provider asks which channel, and the server keeps the webhook it hands back. */}
        <View style={styles.group}>
          <Row
            icon={ChatCircleText}
            tint={channel?.connected ? c.green : undefined}
            title={channel?.connected
              ? `Posting to ${channel.kind === 'slack' ? 'Slack' : 'Discord'}${channel.channel ? ` · ${channel.channel}` : ''}`
              : 'Slack or Discord'}
            body={channel?.connected
              ? 'Incidents, recoveries and proven fixes post there too.'
              : 'Post every alert to a team channel as well. You pick the channel; nothing to copy.'}
          />
          {channel?.connected ? (
            <Action
              icon={Trash}
              label={busy === 'hook' ? 'Removing…' : 'Stop posting there'}
              danger
              onPress={() => run('hook', async () => void (await connect('set_alerts', { url: '' })))}
            />
          ) : (
            <>
              <Action icon={SlackLogo} label={busy === 'slack' ? 'Waiting for Slack…' : 'Add to Slack'} primary onPress={() => addChat('slack')} />
              <Action icon={DiscordLogo} label={busy === 'discord' ? 'Waiting for Discord…' : 'Add to Discord'} onPress={() => addChat('discord')} />
              {/* Slack's pages send phone browsers to "get the app" and drop the request; the server finishes
                  the connection whichever device opens the link, so a laptop works. The link expires in 15 min. */}
              <Action
                icon={ArrowSquareOut}
                label="Add to Slack from a computer"
                onPress={() =>
                  run('slack-link', async () => {
                    const { url } = await connect<{ url: string }>('alerts_start', { kind: 'slack' });
                    await Share.share({ message: url });
                    return 'Open the link on your computer within 15 minutes and pick a channel. Then come back here.';
                  })}
              />
            </>
          )}
        </View>
      </Section>

      {slackUrl && (
        <SlackSignIn
          url={slackUrl}
          onDone={() => {
            setSlackUrl(null);
            void run('slack', async () =>
              (await connect<ConnectStatus>('status')).alerts.connected ? 'Slack connected. A test message was posted.' : undefined);
          }}
        />
      )}

      <AgentAccess active={p.active} />

      <Section title="About">
        <View style={styles.group}>
          <Row icon={Info} title={`OpsSwipe ${version}`} body="Fix production from your phone, and prove it worked." />
          <Action icon={GithubLogo} label="Source code on GitHub" onPress={() => Linking.openURL(REPO)} />
          <Action icon={ArrowSquareOut} label="How OpsSwipe keeps your servers safe" onPress={() => Linking.openURL(`${REPO}#security-model`)} />
          <Action icon={ShieldCheck} label="Privacy policy" onPress={() => Linking.openURL(`${REPO}/blob/main/PRIVACY.md`)} />
        </View>
      </Section>
    </ScrollView>
  );
}

function Row({ icon: IconCmp, title, body, tint }: { icon: Icon; title: string; body: string; tint?: string }) {
  return (
    <View style={styles.row}>
      <IconCmp size={24} color={tint ?? c.text} weight="regular" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.body}>{title}</Text>
        <Text style={type.caption}>{body}</Text>
      </View>
    </View>
  );
}

function Action(a: { icon: Icon; label: string; onPress: () => void; primary?: boolean; danger?: boolean }): ReactNode {
  const color = a.primary ? c.green : a.danger ? c.red : c.text;
  return (
    <Pressable
      onPress={a.onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
    >
      <a.icon size={20} color={color} weight="bold" />
      <Text style={[type.label, { color, fontSize: 15, flex: 1 }]}>{a.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xxl, gap: space.sm },
  group: { backgroundColor: c.surface, borderRadius: radius.card, paddingHorizontal: space.lg, paddingVertical: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.md },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: TARGET,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  note: { color: c.green, backgroundColor: c.greenTint, padding: space.md, borderRadius: radius.control },
  noteError: { color: c.red, backgroundColor: c.redTint },
});
