-- =====================================================================
--  SÓ PARA TESTE (modo teste do site e testes automáticos com PGlite).
--  Imita o pedaço do Supabase que o schema.sql usa: papéis anon /
--  authenticated, a tabela de usuários (auth.users) e auth.uid().
--  NUNCA rodar no Supabase de verdade.
-- =====================================================================
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
grant usage on schema auth, public, extensions to anon, authenticated;

create table if not exists auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, email text unique, encrypted_password text,
  email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz,
  confirmation_token text, recovery_token text, email_change_token_new text, email_change text
);
create table if not exists auth.identities (
  id uuid primary key, user_id uuid references auth.users(id) on delete cascade, provider_id text, identity_data jsonb, provider text,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
);

create or replace function auth.uid() returns uuid language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;  -- igual ao do Supabase
grant execute on function auth.uid() to anon, authenticated;

-- login do modo teste: confere a senha e devolve o id (roda como superusuário, fora do papel do site)
create or replace function auth.entrar_teste(p_email text, p_senha text) returns uuid language sql stable as
$$ select id from auth.users where lower(email) = lower(p_email) and encrypted_password = extensions.crypt(p_senha, encrypted_password) $$;
