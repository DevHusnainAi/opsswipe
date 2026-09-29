import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { appLink, authRedirect, Notifications } from './env';
import { paramsOf } from './format';

export type Incident = {
  id: string;
  title: string;
  target_server: string;
  environment: string;
  severity: string;
  metric: string;
  action: string;
  provider: 'gcp' | 'render' | 'railway' | null;
  status: 'active' | 'resolving' | 'resolved';
  created_at: string;
  resolved_at: string | null;
  recovered_at: string | null;
  actions: string[];
  reason: string | null;
  suggested_by: 'rules' | 'ai' | 'agent' | null;
  context: {
    agent?: { name: string };
    alert_count?: number; // alerts from other tools folded into this card (alert inbox)
    self_healed?: boolean;
    dismissed?: boolean; // closed as a false alarm
    declined?: boolean; // an agent's proposal the human said no to
    // the model's second opinion: agreed or not (with its reason), or why it was unavailable
    ai?: { action: string; reason: string; agreed: boolean } | { error: string };
    live?: { commit?: { id: string; message?: string } } | null; // the release running when it broke
    revenue?: { perHour: number; currency: string }; // estimate from the owner's RevenueCat, last 28 days
    replay?: { method: string; path: string; status: number }[];
    pr?: { number: number; url: string; headSha: string };
    proof?: { ok: boolean; passed: number; total: number; tests: boolean; runUrl?: string; headSha: string };
  } | null;
};

export type AuditEntry = { id: number; incident_id: string | null; action: string; target: string; outcome: string; detail: string | null; created_at: string };

export const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_KEY!, {
  auth: { storage: AsyncStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

// The signed-in user, or null (show the auth screen). The id doubles as the RevenueCat appUserID, so the
// server can check the plan of the same person the JWT names.
export async function currentUserId() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
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
  provider: 'gcp' | 'render' | 'railway';
  sentry_secret_id?: string | null;
  config: {
    url: string;
    repo?: string;
    branch?: string;
    proofPr?: string;
    autofix?: string; // 'on': AI fix prepared and proven as soon as an incident opens (Pro)
    serviceId?: string;
    project?: string;
    zone?: string;
    instance?: string;
    projectId?: string;
  };
};
export type RenderOption = { id: string; name: string; url: string; repo?: string };
export type ConnectStatus = {
  statusPage: string | null; // public status page link, when turned on
  alertInbox: string | null; // webhook URL for alerts from other tools
  github: { connected: boolean; account: string | null; installUrl: string };
  render: { connected: boolean };
  railway: { connected: boolean };
  alerts: { connected: boolean; kind: 'discord' | 'slack' | null; channel?: string | null };
  revenuecat: { connected: boolean; project: string | null };
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

const AUTH_REDIRECT = appLink('auth');

// Supabase puts the new session in the redirect's fragment; this turns it into the app's session.
// `type` is "recovery" when the user came from a password-reset email.
export async function sessionFromRedirect(url: string) {
  const p = paramsOf(url);
  if (p.error) throw new Error(p.error_description || 'Sign-in failed. Try again.');
  if (!p.access_token || !p.refresh_token) return null;
  const { data, error } = await supabase.auth.setSession({ access_token: p.access_token, refresh_token: p.refresh_token });
  if (error) throw error;
  return { uid: data.user!.id, recovery: p.type === 'recovery' };
}

// Continue with GitHub: one browser sheet, new or returning users alike. Null if cancelled.
export async function signInWithGithub() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    // The account picker lets you choose which GitHub account instead of reusing the last one.
    options: { redirectTo: authRedirect, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
  });
  if (error) throw error;
  const r = await WebBrowser.openAuthSessionAsync(data.url!, AUTH_REDIRECT);
  return r.type === 'success' ? sessionFromRedirect(r.url) : null;
}

const friendly = (e: { message: string }) =>
  /invalid login/i.test(e.message)
    ? 'That email and password do not match.'
    : /already registered/i.test(e.message)
    ? 'An account with this email already exists. Sign in instead.'
    : e.message;

// Returns the user id, or null when Supabase needs the email confirmed first.
export async function signUpWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: authRedirect } });
  if (error) throw new Error(friendly(error));
  return data.session?.user.id ?? null;
}

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendly(error));
  return data.user.id;
}

// The email link comes back to the app signed in (type=recovery), where the user sets a new password.
export async function sendPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirect });
  if (error) throw new Error(friendly(error));
}

export async function setNewPassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(friendly(error));
}

async function pushToken() {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!Notifications || !projectId || (await Notifications.getPermissionsAsync()).status !== 'granted') return null;
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

// Lets the server page this phone even when the app is closed. Needs the EAS projectId (eas init).
export async function registerPush() {
  const token = await pushToken();
  if (token) await connect('register_push', { token });
}

// Signing out: stop this phone's alerts for the account, then end the session.
export async function signOut() {
  const token = await pushToken().catch(() => null);
  if (token) await connect('unregister_push', { token }).catch(() => {});
  await supabase.auth.signOut();
}
