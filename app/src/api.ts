import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

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
  gcpIdentity: string | null;
};
export type NewService = { service: Service; report: { url: string; secret: string } };

// Connect actions run on the server for the signed-in user; errors come back as plain sentences.
export async function connect<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('connect', { body: { action, ...params } });
  if (!error) return data as T;
  const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
  throw new Error(body?.error ?? 'Could not reach OpsSwipe. Try again.');
}
