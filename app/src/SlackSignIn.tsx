// "Add to Slack" inside the app. Slack refuses web sign-in on phone browsers (it redirects to its
// Play Store page) and Android hands *.slack.com links to the Slack app, so a normal browser tab can
// never finish the OAuth. An in-app web view that presents as a desktop browser gets Slack's usual
// sign-in and channel picker; when Slack redirects to oauth-callback it bounces back to the app's own
// link with a one-time claim, which we catch here and hand to the settings screen.
import { X } from 'phosphor-react-native';
import { type ComponentType, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TurboModuleRegistry, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { appBase } from './env';
import { c, space, TARGET, type } from './theme';

// Dev builds made before react-native-webview was added don't have its native half, and importing it
// there throws; they keep using the browser (and need a rebuild for Slack).
export const canSignInHere = !!TurboModuleRegistry.get('RNCWebViewModule');

type WebViewProps = {
  source: { uri: string } | { html: string };
  userAgent?: string;
  injectedJavaScript?: string;
  onMessage?: (e: { nativeEvent: { data: string } }) => void;
  onShouldStartLoadWithRequest?: (r: { url: string }) => boolean;
  style: object;
};

// Slack turns away browsers it thinks are old ("your browser is not supported"), so a desktop Chrome
// user agent with a fixed, ageing version stops working. The phone's own web view is kept up to date by
// Android: we read its Chrome version and present as desktop Chrome of that same version.
const desktopUa = (chrome: string) =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
const READ_UA = 'window.ReactNativeWebView.postMessage(navigator.userAgent); true;';
// ponytail: a phone whose web view is itself years old gets a recent version instead; bump the floor yearly.
const FLOOR = 145;
const currentChrome = (agent: string) => {
  const v = /Chrome\/([\d.]+)/.exec(agent)?.[1];
  return v && Number(v.split('.')[0]) >= FLOOR ? v : `${FLOOR}.0.0.0`;
};

export function SlackSignIn({ url, onDone }: { url: string; onDone: (back?: string) => void }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebView } = require('react-native-webview') as { WebView: ComponentType<WebViewProps> };
  const [ua, setUa] = useState<string | null>(null);
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => onDone()}>
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Text style={[type.title, { flex: 1 }]}>Add to Slack</Text>
          <Pressable onPress={() => onDone()} accessibilityRole="button" accessibilityLabel="Close" style={styles.icon}>
            <X size={22} color={c.text} weight="bold" />
          </Pressable>
        </View>
        {ua === null ? (
          <View style={styles.loading}>
            <ActivityIndicator color={c.green} />
            {/* Invisible: reports the phone's web view version, then Slack loads with a matching desktop agent. */}
            <WebView
              source={{ html: '<html><body></body></html>' }}
              injectedJavaScript={READ_UA}
              onMessage={(e) => setUa(desktopUa(currentChrome(e.nativeEvent.data)))}
              style={styles.hidden}
            />
          </View>
        ) : (
          <WebView
            source={{ uri: url }}
            userAgent={ua}
            // The redirect back to opsswipe:// (or exp:// in Expo Go) carries the one-time claim for the channel.
            onShouldStartLoadWithRequest={(r) => {
              if (r.url.startsWith(appBase) || r.url.startsWith('opsswipe:')) {
                onDone(r.url);
                return false;
              }
              return r.url.startsWith('https://') || r.url.startsWith('about:'); // Slack uses about:blank frames
            }}
            style={{ flex: 1 }}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: space.lg, gap: space.md },
  icon: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hidden: { width: 1, height: 1, opacity: 0 },
});
