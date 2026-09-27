-- Minimal stand-ins for what Supabase provides, so migrations run on plain Postgres (CI, local).
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create table auth.users (id uuid primary key);
-- Tests impersonate a user with: set local test.uid = '<uuid>';
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated;
grant usage on schema public to authenticated;
create publication supabase_realtime;

create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), secret text not null);
create function vault.create_secret(secret text) returns uuid language sql as
  $$ insert into vault.secrets (secret) values (secret) returning id $$;
create view vault.decrypted_secrets as select id, secret as decrypted_secret from vault.secrets;
