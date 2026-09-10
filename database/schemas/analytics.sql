create schema if not exists analytics;

create table if not exists analytics.clicks (
  id uuid primary key default gen_random_uuid(), link_id uuid not null references links.links(id) on delete cascade,
  occurred_at timestamptz not null default now(), ip inet, user_agent text, referrer text,
  browser_name varchar(80), browser_version varchar(40), os_name varchar(80), os_version varchar(40),
  device_type varchar(30), device_vendor varchar(80), device_model varchar(120), country_code char(2),
  country_name varchar(100), region varchar(120), city varchar(120), timezone varchar(80), language varchar(40),
  accept_language text, method varchar(10) not null default 'GET', is_bot boolean not null default false,
  bot_name varchar(120), request_id uuid default gen_random_uuid(), raw_ip_delete_at timestamptz
);
create index if not exists clicks_link_time_idx on analytics.clicks(link_id, occurred_at desc);
create index if not exists clicks_time_idx on analytics.clicks(occurred_at desc);
create index if not exists clicks_country_idx on analytics.clicks(link_id, country_code);
create table if not exists analytics.link_daily_stats (
  link_id uuid not null references links.links(id) on delete cascade, day date not null, clicks bigint not null default 0,
  unique_visitors bigint not null default 0, bots bigint not null default 0, primary key(link_id, day)
);
