// "Add to Slack" inside the app. Slack refuses web sign-in on phone browsers (it redirects to its
// Play Store page) and Android hands *.slack.com links to the Slack app, so a normal browser tab can
// never finish the OAuth. An in-app web view that presents as a desktop browser gets Slack's usual
// sign-in and channel picker; the server finishes the connection when Slack redirects to
// oauth-callback, and we close as soon as it bounces back to the app's own link.
import { X } from 'phosphor-react-native';
import type { ComponentType } from 'react';
import { Modal, Pressable, StyleSheet, Text, TurboModuleRegistry, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { appBase } from './env';
import { c, space, TARGET, type } from './theme';

// Dev builds made before react-native-webview was added don't have its native half, and importing it
// there throws; they keep using the browser (and need a rebuild for Slack).
export const canSignInHere = !!TurboModuleRegistry.get('RNCWebViewModule');

type WebViewProps = {
  source: { uri: string };
  userAgent: string;
  onShouldStartLoadWithRequest: (r: { url: string }) => boolean;
  style: object;
};

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

export function SlackSignIn({ url, onDone }: { url: string; onDone: () => void }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebView } = require('react-native-webview') as { WebView: ComponentType<WebViewProps> };
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onDone}>
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Text style={[type.title, { flex: 1 }]}>Add to Slack</Text>
          <Pressable onPress={onDone} accessibilityRole="button" accessibilityLabel="Close" style={styles.icon}>
            <X size={22} color={c.text} weight="bold" />
          </Pressable>
        </View>
        <WebView
          source={{ uri: url }}
          userAgent={DESKTOP_UA}
          // The redirect back to opsswipe:// (or exp:// in Expo Go) means the server has the channel.
          onShouldStartLoadWithRequest={(r) => {
            if (r.url.startsWith(appBase) || r.url.startsWith('opsswipe:')) {
              onDone();
              return false;
            }
            return r.url.startsWith('https://') || r.url.startsWith('about:'); // Slack uses about:blank frames
          }}
          style={{ flex: 1 }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: space.lg, gap: space.md },
  icon: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
});
