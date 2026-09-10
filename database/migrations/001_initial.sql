-- Run this file once in the Neon SQL editor or with `pnpm db:migrate`.
-- It is intentionally self-contained: do not run database.sql as a second migration.
create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists links;
create schema if not exists analytics;

create table if not exists auth.users (id uuid primary key default gen_random_uuid(), name text, email text unique, email_verified timestamptz, image text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists auth.accounts (user_id uuid not null references auth.users(id) on delete cascade, type text not null, provider text not null, provider_account_id text not null, refresh_token text, access_token text, expires_at integer, token_type text, scope text, id_token text, session_state text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(provider, provider_account_id));
create table if not exists auth.sessions (session_token text primary key, user_id uuid not null references auth.users(id) on delete cascade, expires timestamptz not null, created_at timestamptz not null default now());
create table if not exists auth.verification_tokens (identifier text not null, token text not null, expires timestamptz not null, primary key(identifier, token));
create table if not exists auth.password_credentials (user_id uuid primary key references auth.users(id) on delete cascade, password_hash text not null, password_changed_at timestamptz not null default now(), failed_attempts integer not null default 0 check (failed_attempts >= 0), locked_until timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
do $$ begin create type auth.token_purpose as enum ('verify_email','reset_password','change_email'); exception when duplicate_object then null; end $$;
create table if not exists auth.one_time_tokens (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, purpose auth.token_purpose not null, token_hash text not null unique, expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now());
create table if not exists auth.user_settings (user_id uuid primary key references auth.users(id) on delete cascade, analytics_retention_days integer not null default 90 check (analytics_retention_days between 1 and 3650), store_raw_ip boolean not null default true, timezone varchar(80) not null default 'Europe/Warsaw', created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table if not exists links.links (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, slug varchar(80) not null unique, destination_url text not null, name varchar(160), description text, is_active boolean not null default true, redirect_mode varchar(20) not null default 'direct' check (redirect_mode in ('direct','redirect_page','information_page')), expires_at timestamptz, max_clicks bigint check (max_clicks is null or max_clicks >= 1), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz, constraint destination_url_http check (destination_url ~* '^https?://'));
create index if not exists links_user_created_idx on links.links(user_id, created_at desc);
create index if not exists links_active_slug_idx on links.links(slug) where deleted_at is null and is_active = true;
create table if not exists links.tags (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, name varchar(50) not null, created_at timestamptz not null default now(), unique(user_id, name));
create table if not exists links.link_tags (link_id uuid not null references links.links(id) on delete cascade, tag_id uuid not null references links.tags(id) on delete cascade, primary key(link_id, tag_id));

create table if not exists analytics.clicks (id uuid primary key default gen_random_uuid(), link_id uuid not null references links.links(id) on delete cascade, occurred_at timestamptz not null default now(), ip inet, user_agent text, referrer text, browser_name varchar(80), browser_version varchar(40), os_name varchar(80), os_version varchar(40), device_type varchar(30), device_vendor varchar(80), device_model varchar(120), country_code char(2), country_name varchar(100), region varchar(120), city varchar(120), timezone varchar(80), language varchar(40), accept_language text, method varchar(10) not null default 'GET', is_bot boolean not null default false, bot_name varchar(120), request_id uuid default gen_random_uuid(), raw_ip_delete_at timestamptz);
create index if not exists clicks_link_time_idx on analytics.clicks(link_id, occurred_at desc);
create index if not exists clicks_country_idx on analytics.clicks(link_id, country_code);
create table if not exists analytics.link_daily_stats (link_id uuid not null references links.links(id) on delete cascade, day date not null, clicks bigint not null default 0, unique_visitors bigint not null default 0, bots bigint not null default 0, primary key(link_id, day));

create or replace function auth.current_user_id() returns uuid language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

alter table links.links enable row level security;
alter table links.links force row level security;
alter table links.tags enable row level security;
alter table links.tags force row level security;
alter table links.link_tags enable row level security;
alter table links.link_tags force row level security;
alter table analytics.clicks enable row level security;
alter table analytics.clicks force row level security;
alter table analytics.link_daily_stats enable row level security;
alter table analytics.link_daily_stats force row level security;

create policy links_owner_only on links.links for all using (user_id = auth.current_user_id()) with check (user_id = auth.current_user_id());
create policy tags_owner_only on links.tags for all using (user_id = auth.current_user_id()) with check (user_id = auth.current_user_id());
create policy link_tags_owner_only on links.link_tags for all using (exists (select 1 from links.links l where l.id = link_id and l.user_id = auth.current_user_id())) with check (exists (select 1 from links.links l where l.id = link_id and l.user_id = auth.current_user_id()));
create policy clicks_owner_only on analytics.clicks for select using (exists (select 1 from links.links l where l.id = link_id and l.user_id = auth.current_user_id()));
create policy daily_stats_owner_only on analytics.link_daily_stats for select using (exists (select 1 from links.links l where l.id = link_id and l.user_id = auth.current_user_id()));
create policy links_public_redirect on links.links for select using (current_setting('app.public_redirect', true) = '1' and deleted_at is null and is_active);
create policy clicks_public_redirect on analytics.clicks for select using (current_setting('app.public_redirect', true) = '1');
create policy clicks_public_insert on analytics.clicks for insert with check (current_setting('app.public_redirect', true) = '1');
create policy daily_public_redirect on analytics.link_daily_stats for all using (current_setting('app.public_redirect', true) = '1') with check (current_setting('app.public_redirect', true) = '1');

create or replace function analytics.record_public_click(p_slug text, p_ip inet, p_user_agent text, p_referrer text, p_browser_name text, p_browser_version text, p_os_name text, p_os_version text, p_device_type text, p_device_vendor text, p_device_model text, p_language text, p_accept_language text, p_method text, p_is_bot boolean, p_bot_name text)
returns table(id uuid, destination_url text, redirect_mode varchar, name varchar)
language plpgsql security definer set search_path = pg_catalog, links, analytics as $$
declare v_link links.links%rowtype;
begin
  perform set_config('app.public_redirect', '1', true);
  select * into v_link from links.links where slug = p_slug and deleted_at is null and is_active and (expires_at is null or expires_at > now()) and (max_clicks is null or (select count(*) from analytics.clicks where link_id = links.links.id) < max_clicks) limit 1;
  if not found then return; end if;
  insert into analytics.clicks(link_id, ip, user_agent, referrer, browser_name, browser_version, os_name, os_version, device_type, device_vendor, device_model, language, accept_language, method, is_bot, bot_name) values(v_link.id, p_ip, p_user_agent, p_referrer, p_browser_name, p_browser_version, p_os_name, p_os_version, p_device_type, p_device_vendor, p_device_model, p_language, p_accept_language, p_method, p_is_bot, p_bot_name);
  insert into analytics.link_daily_stats(link_id, day, clicks, unique_visitors, bots) values(v_link.id, current_date, 1, 0, case when p_is_bot then 1 else 0 end) on conflict(link_id, day) do update set clicks = analytics.link_daily_stats.clicks + 1, bots = analytics.link_daily_stats.bots + excluded.bots;
  return query select v_link.id, v_link.destination_url, v_link.redirect_mode, v_link.name;
end $$;
