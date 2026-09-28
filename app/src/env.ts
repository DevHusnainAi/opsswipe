// Expo Go vs our own builds. Expo Go can run the app for quick checks, minus two native parts:
// server push (removed from Expo Go on Android in SDK 53) and real purchases (RevenueCat switches
// itself to its Preview API mode there).
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';

export const inExpoGo = isRunningInExpoGo();

// Where OAuth sends the user back: "opsswipe://" in our builds, "exp://<laptop>:8081/--/" in Expo Go.
// Built from hostUri ("192.168.18.4:8081"): linkingUri drops the "/--/" separator on some Expo Go versions.
export const appBase = inExpoGo ? `exp://${Constants.expoConfig?.hostUri}/--/` : 'opsswipe://';
export const appLink = (path: string) => `${appBase}${path}`;

// Where Supabase sends GitHub sign-in back to. Supabase refuses raw IP hosts (exp://192.168...), so in
// Expo Go it goes through our oauth-callback, which forwards to appLink('auth') with the session intact.
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const authRedirect = inExpoGo
  ? `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/oauth-callback?to=auth&state=go~${b64url(appBase)}`
  : 'opsswipe://auth';

// ponytail: expo-notifications throws in Expo Go on Android as soon as it loads, so only our builds
// load it. Expo Go still shows new incidents live through realtime while the app is open.
export const Notifications: typeof import('expo-notifications') | null = inExpoGo
  ? null
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  : require('expo-notifications');
