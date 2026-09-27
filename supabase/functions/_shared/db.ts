import { createClient } from 'npm:@supabase/supabase-js@2';

export const env = (k: string) => Deno.env.get(k) ?? '';

const secretKey = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}').default ?? env('SUPABASE_SERVICE_ROLE_KEY');
export const db = createClient(env('SUPABASE_URL'), secretKey);

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
