create extension if not exists pgcrypto;
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(), name text, email text unique,
  email_verified timestamptz, image text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists auth.accounts (
  user_id uuid not null references auth.users(id) on delete cascade, type text not null, provider text not null,
  provider_account_id text not null, refresh_token text, access_token text, expires_at integer, token_type text,
  scope text, id_token text, session_state text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (provider, provider_account_id)
);
create table if not exists auth.sessions (
  session_token text primary key, user_id uuid not null references auth.users(id) on delete cascade,
  expires timestamptz not null, created_at timestamptz not null default now()
);
create table if not exists auth.verification_tokens (
  identifier text not null, token text not null, expires timestamptz not null, primary key (identifier, token)
);
create table if not exists auth.password_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade, password_hash text not null,
  password_changed_at timestamptz not null default now(), failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create type auth.token_purpose as enum ('verify_email','reset_password','change_email');
create table if not exists auth.one_time_tokens (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  purpose auth.token_purpose not null, token_hash text not null unique, expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists auth.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  analytics_retention_days integer not null default 90 check (analytics_retention_days between 1 and 3650),
  store_raw_ip boolean not null default true, timezone varchar(80) not null default 'Europe/Warsaw',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create or replace function auth.current_user_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;
