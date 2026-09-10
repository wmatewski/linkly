-- Linkly PostgreSQL schema
-- Auth.js / NextAuth.js + Credentials + Google OAuth + link analytics

create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists links;
create schema if not exists analytics;

-- =========================================================
-- AUTH / NEXTAUTH
-- =========================================================

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text unique,
  email_verified timestamptz,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- OAuth identities, e.g. Google. One user may have several providers.
create table if not exists auth.accounts (
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  provider text not null,
  provider_account_id text not null,
  refresh_token text,
  access_token text,
  expires_at integer,
  token_type text,
  scope text,
  id_token text,
  session_state text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, provider_account_id)
);
create index if not exists accounts_user_id_idx on auth.accounts(user_id);

-- Database-session strategy. If you use JWT-only sessions this table can be omitted.
create table if not exists auth.sessions (
  session_token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_id_idx on auth.sessions(user_id);
create index if not exists sessions_expires_idx on auth.sessions(expires);

-- Used by Auth.js email/magic-link providers. It is also a useful primitive
-- for email verification if your adapter is mapped to this table.
create table if not exists auth.verification_tokens (
  identifier text not null,
  token text not null,
  expires timestamptz not null,
  primary key (identifier, token)
);
create index if not exists verification_tokens_expires_idx on auth.verification_tokens(expires);

-- Password auth is application-specific. Store only a slow password hash,
-- never a plaintext password. Recommended: Argon2id.
create table if not exists auth.password_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  password_hash text not null,
  password_changed_at timestamptz not null default now(),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Separate one-time application tokens for registration verification and reset.
-- Store only a HASH of the token sent to the user.
create type auth.token_purpose as enum ('verify_email','reset_password','change_email');
create table if not exists auth.one_time_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose auth.token_purpose not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists one_time_tokens_lookup_idx
  on auth.one_time_tokens(user_id, purpose, expires_at)
  where used_at is null;

-- Optional WebAuthn/passkeys table matching the current Auth.js model.
create table if not exists auth.authenticators (
  credential_id text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_account_id text not null,
  credential_public_key text not null,
  counter integer not null,
  credential_device_type text not null,
  credential_backed_up boolean not null,
  transports text,
  primary key (user_id, credential_id)
);

-- =========================================================
-- LINKS
-- =========================================================

create table if not exists links.links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slug varchar(80) not null unique,
  destination_url text not null,
  name varchar(160),                 -- private: dashboard only
  description text,                  -- private: dashboard only
  is_active boolean not null default true,
  redirect_mode varchar(20) not null default 'direct'
    check (redirect_mode in ('direct','redirect_page','information_page')),
  expires_at timestamptz,
  max_clicks bigint check (max_clicks is null or max_clicks >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint destination_url_http check (destination_url ~* '^https?://')
);
create index if not exists links_user_created_idx on links.links(user_id, created_at desc);
create index if not exists links_active_slug_idx on links.links(slug) where deleted_at is null and is_active = true;

-- Optional tags for organizing links in the dashboard.
create table if not exists links.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name varchar(50) not null,
  created_at timestamptz not null default now(),
  unique(user_id, name)
);
create table if not exists links.link_tags (
  link_id uuid not null references links.links(id) on delete cascade,
  tag_id uuid not null references links.tags(id) on delete cascade,
  primary key(link_id, tag_id)
);

-- =========================================================
-- CLICK / VISIT ANALYTICS
-- =========================================================

create table if not exists analytics.clicks (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references links.links(id) on delete cascade,
  occurred_at timestamptz not null default now(),

  -- request / network
  ip inet,
  ip_hash text,                       -- useful if raw IP is later removed
  user_agent text,
  referrer text,

  -- parsed client metadata
  browser_name varchar(80),
  browser_version varchar(40),
  os_name varchar(80),
  os_version varchar(40),
  device_type varchar(30),            -- desktop/mobile/tablet/bot/other
  device_vendor varchar(80),
  device_model varchar(120),

  -- coarse geolocation derived from IP
  country_code char(2),
  country_name varchar(100),
  region varchar(120),
  city varchar(120),
  timezone varchar(80),

  -- optional request metadata
  language varchar(40),
  accept_language text,
  method varchar(10) not null default 'GET',
  is_bot boolean not null default false,
  bot_name varchar(120),
  request_id uuid default gen_random_uuid(),

  -- privacy / retention helper
  raw_ip_delete_at timestamptz
);

create index if not exists clicks_link_time_idx on analytics.clicks(link_id, occurred_at desc);
create index if not exists clicks_time_idx on analytics.clicks(occurred_at desc);
create index if not exists clicks_country_idx on analytics.clicks(link_id, country_code);
create index if not exists clicks_browser_idx on analytics.clicks(link_id, browser_name);
create index if not exists clicks_device_idx on analytics.clicks(link_id, device_type);

-- Daily aggregate for a fast dashboard. Populate in a job/cron or incrementally.
create table if not exists analytics.link_daily_stats (
  link_id uuid not null references links.links(id) on delete cascade,
  day date not null,
  clicks bigint not null default 0,
  unique_visitors bigint not null default 0,
  bots bigint not null default 0,
  primary key(link_id, day)
);

-- =========================================================
-- USER SETTINGS
-- =========================================================

create table if not exists auth.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  analytics_retention_days integer not null default 90 check (analytics_retention_days between 1 and 3650),
  store_raw_ip boolean not null default true,
  timezone varchar(80) not null default 'Europe/Warsaw',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
