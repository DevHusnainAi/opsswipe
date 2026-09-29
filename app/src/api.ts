import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { appLink, authRedirect, Notifications } from './env';
import { paramsOf } from './format';
import { fixKey, FixKeyError, forgetFixKey, secureStorage } from './secure';

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
    proof?: {
      ok: boolean;
      passed: number;
      total: number;
      tests: boolean;
      runUrl?: string;
      headSha: string;
      results?: { method: string; path: string; was: number; now: number }[]; // each saved failure, then and now
    };
  } | null;
};

export type AuditEntry = { id: number; incident_id: string | null; action: string; target: string; outcome: string; detail: string | null; created_at: string };

export const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_KEY!, {
  // PKCE: a sign-in link carries a one-time code that only this app (holding the matching verifier) can turn
  // into a session, so a crafted link can't sign the phone into someone else's account.
  auth: { storage: secureStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
});

// The signed-in user, or null (show the auth screen). The id doubles as the RevenueCat appUserID, so the
// server can check the plan of the same person the JWT names.
export async function currentUserId() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export type ExecuteResult = { result: 'ok' | 'paywall' | 'error'; detail?: string };

export const SIGN_IN_AGAIN =
  'For your security, sign in again to approve fixes on this phone (new phone or new fingerprint).';

// A new fix key is enrolled only right after a sign-in (the server checks), see secure.ts.
async function enroll(key: string) {
  try {
    await connect('register_fix_key', { key });
  } catch (e) {
    await forgetFixKey();
    throw new FixKeyError(e instanceof Error && e.message === 'sign_in_again' ? SIGN_IN_AGAIN : String(e));
  }
}

// The fingerprint prompt, as the phone's secure hardware releasing the fix key. Throws FixKeyError.
export const approve = (prompt: string) => fixKey(prompt, enroll);

// The server re-checks the chosen fix against the incident and the allowlist, and the fix key.
export async function execute(incidentId: string, action: string, key: string): Promise<ExecuteResult> {
  const { data, error } = await supabase.functions.invoke('execute', {
    body: { incidentId, action },
    headers: { 'x-fix-key': key },
  });
  if (!error) return { result: 'ok', detail: data?.detail };
  const res = (error as { context?: Response }).context;
  if (res?.status === 403 && (await res.clone().json().catch(() => null))?.error === 'fix_key') {
    await forgetFixKey(); // not this account's key (or removed): the next fix enrolls a new one
    return { result: 'error', detail: SIGN_IN_AGAIN };
  }
  return { result: res?.status === 402 ? 'paywall' : 'error' };
}

export type Service = {
  id: string;
  name: string;
  provider: 'gcp' | 'render' | 'railway';
  sentry_secret_id?: string | null;
  last_report_at?: string | null; // the last signed failure report (or test) that arrived
  last_report_test?: boolean | null;
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
  railway: { connected: boolean; oauth?: boolean; available?: boolean }; // oauth: connected with Connect Railway
  alerts: { connected: boolean; kind: 'discord' | 'slack' | null; channel?: string | null };
  revenuecat: { connected: boolean; project: string | null };
  google: { connected: boolean; account: string | null; available: boolean };
  gcpIdentity: string | null;
};
export type RailwayService = {
  projectId: string;
  project: string;
  serviceId: string;
  service: string;
  environments: { id: string; name: string }[];
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

export type Claimed = { kind: 'github' | 'google' | 'slack' | 'discord'; account: string | null; projects?: GcpProject[] };
const claims = new Map<string, Promise<Claimed>>();
const NAMES: Record<string, string> = { github: 'GitHub', google: 'Google', slack: 'Slack', discord: 'Discord' };

// A Connect flow comes back to opsswipe://connect?claim=… on the phone that approved it; this account
// claims it (the server checks it's the one that started it). The same link can arrive twice (the
// browser sheet and the app's link handler), so each claim is sent once. Null when there's nothing to claim.
export function claimFrom(url: string): Promise<Claimed | null> {
  const q = paramsOf(url);
  if (q.error === 'access_denied') return Promise.reject(new Error('Access was not allowed.'));
  if (q.error === 'start_in_app') return Promise.reject(new Error('Start connecting from the app, then try again.'));
  if (q.error) {
    const who = NAMES[q.error.replace(/_failed$/, '')] ?? 'The provider';
    return Promise.reject(new Error(`${who} did not finish. Try again.`));
  }
  if (!q.claim) return Promise.resolve(null);
  if (!claims.has(q.claim)) claims.set(q.claim, connect<Claimed>('oauth_claim', { claim: q.claim }));
  return claims.get(q.claim)!;
}

// Only a one-time PKCE code is accepted, never tokens in the link: the exchange needs the verifier this
// app stored when it started the sign-in or reset, so a link someone else made can't sign this phone in.
export async function sessionFromRedirect(url: string) {
  const p = paramsOf(url);
  if (p.error) {
    const why = decodeURIComponent(p.error_description ?? '');
    // The provider's one-time code couldn't be traded (used twice, or expired): starting again fixes it.
    throw new Error(
      /exchange external code/i.test(why) ? 'That sign-in didn\'t finish. Try again.' : why || 'Sign-in failed. Try again.',
    );
  }
  if (!p.code) return null;
  const { data, error } = await supabase.auth.exchangeCodeForSession(p.code);
  if (error) throw new Error('That sign-in link was not started on this phone, or it expired. Try again.');
  return { uid: data.user!.id, recovery: (data as { redirectType?: string | null }).redirectType === 'recovery' };
}

// While GitHub sign-in is open, its return link belongs to that call; the app's deep-link handler skips it
// (a PKCE code works only once).
let oauthInFlight = false;
export const githubSignInOpen = () => oauthInFlight;

// Continue with GitHub or Google: one browser sheet, new or returning users alike. Null if cancelled.
export async function signInWith(provider: 'github' | 'google') {
  oauthInFlight = true;
  try {
    return await oauthSignIn(provider);
  } finally {
    oauthInFlight = false;
  }
}
export const signInWithGithub = () => signInWith('github');

async function oauthSignIn(provider: 'github' | 'google') {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    // The account picker lets you choose which account instead of reusing the last one.
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
  await forgetFixKey(); // it belongs to this account; the next one signing in enrolls their own
  await supabase.auth.signOut();
}
