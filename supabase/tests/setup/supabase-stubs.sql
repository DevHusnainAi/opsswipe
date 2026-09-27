-- Minimal stand-ins for what Supabase provides, so migrations run on plain Postgres (CI, local).
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql as 'select null::uuid';
create publication supabase_realtime;
