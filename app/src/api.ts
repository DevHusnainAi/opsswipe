import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as WebBrowser from 'expo-web-browser';
import { paramsOf } from './format';

export type Incident = {
  id: string;
  title: string;
  target_server: string;
  environment: string;
  severity: string;
  metric: string;
  action: string;
  provider: 'gcp' | 'render' | null;
  status: 'active' | 'resolving' | 'resolved';
  created_at: string;
  resolved_at: string | null;
  recovered_at: string | null;
  actions: string[];
  reason: string | null;
  suggested_by: 'rules' | 'ai' | null;
  context: {
    replay?: { method: string; path: string; status: number }[];
    pr?: { number: number; url: string; headSha: string };
    proof?: { ok: boolean; passed: number; total: number; tests: boolean; runUrl?: string; headSha: string };
  } | null;
};

export type AuditEntry = { id: number; action: string; target: string; outcome: string; detail: string | null; created_at: string };

export const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_KEY!, {
  auth: { storage: AsyncStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

// Anonymous Supabase user; its id doubles as the RevenueCat appUserID so the server can verify both.
export async function ensureUser() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: signed, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return signed.user!.id;
}

export type ExecuteResult = { result: 'ok' | 'paywall' | 'error'; detail?: string };

// The server re-checks the chosen fix against the incident and the allowlist.
export async function execute(incidentId: string, action: string): Promise<ExecuteResult> {
  const { data, error } = await supabase.functions.invoke('execute', { body: { incidentId, action } });
  if (!error) return { result: 'ok', detail: data?.detail };
  return { result: (error as { context?: Response }).context?.status === 402 ? 'paywall' : 'error' };
}

export type Service = {
  id: string;
  name: string;
  provider: 'gcp' | 'render';
  config: { url: string; repo?: string; branch?: string; serviceId?: string; project?: string; zone?: string; instance?: string };
};
export type RenderOption = { id: string; name: string; url: string; repo?: string };
export type ConnectStatus = {
  github: { connected: boolean; account: string | null; installUrl: string };
  render: { connected: boolean };
  google: { connected: boolean; account: string | null; available: boolean };
  gcpIdentity: string | null;
};
export type GcpProject = { id: string; name: string };
export type VmOption = { name: string; zone: string; status: string; ip: string | null };
export type NewService = { service: Service; report: { url: string; secret: string } };

// Connect actions run on the server for the signed-in user; errors come back as plain sentences.
export async function connect<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('connect', { body: { action, ...params } });
  if (!error) return data as T;
  const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
  throw new Error(body?.error ?? 'Could not reach OpsSwipe. Try again.');
}

const AUTH_REDIRECT = 'opsswipe://auth';

// Opens the provider in a browser sheet and returns the redirect's params, or null if cancelled.
async function browserAuth(start: { data: { url: string | null }; error: unknown }) {
  if (start.error) throw start.error;
  const r = await WebBrowser.openAuthSessionAsync(start.data.url!, AUTH_REDIRECT);
  return r.type === 'success' ? paramsOf(r.url) : null;
}

// Guest -> GitHub account, keeping the same user id, so services, incidents and Pro carry over.
// If that GitHub account already has OpsSwipe (a new phone), sign in to it instead.
export async function signInWithGithub(): Promise<{ uid: string; switched: boolean } | null> {
  const before = (await supabase.auth.getUser()).data.user;
  const options = { redirectTo: AUTH_REDIRECT, skipBrowserRedirect: true };
  let p = before?.is_anonymous
    ? await browserAuth(await supabase.auth.linkIdentity({ provider: 'github', options }))
    : null;
  if (!before?.is_anonymous || p?.error_code === 'identity_already_exists') {
    p = await browserAuth(await supabase.auth.signInWithOAuth({ provider: 'github', options }));
  }
  if (!p) return null;
  if (p.error) throw new Error(p.error_description || 'GitHub sign-in failed. Try again.');
  const { data, error } = await supabase.auth.setSession({ access_token: p.access_token, refresh_token: p.refresh_token });
  if (error) throw error;
  return { uid: data.user!.id, switched: data.user!.id !== before?.id };
}

// Lets the server page this phone even when the app is closed. Needs the EAS projectId (eas init).
export async function registerPush() {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId || (await Notifications.getPermissionsAsync()).status !== 'granted') return;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  await connect('register_push', { token: data });
}
