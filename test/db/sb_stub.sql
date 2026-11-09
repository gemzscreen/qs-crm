-- Minimal stand-in for Supabase on a local PostgreSQL, so supabase/schema.sql and the crm_* functions can be tested.
-- auth.uid() reads the session setting request.uid (set it with: select set_config('request.uid', '<uuid>', false)).
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
