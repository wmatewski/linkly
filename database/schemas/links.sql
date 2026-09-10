create schema if not exists links;

create table if not exists links.links (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  slug varchar(80) not null unique, destination_url text not null, name varchar(160), description text,
  is_active boolean not null default true, redirect_mode varchar(20) not null default 'direct'
    check (redirect_mode in ('direct','redirect_page','information_page')),
  expires_at timestamptz, max_clicks bigint check (max_clicks is null or max_clicks >= 1),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  constraint destination_url_http check (destination_url ~* '^https?://')
);
create index if not exists links_user_created_idx on links.links(user_id, created_at desc);
create index if not exists links_active_slug_idx on links.links(slug) where deleted_at is null and is_active = true;
create table if not exists links.tags (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name varchar(50) not null, created_at timestamptz not null default now(), unique(user_id, name)
);
create table if not exists links.link_tags (
  link_id uuid not null references links.links(id) on delete cascade, tag_id uuid not null references links.tags(id) on delete cascade,
  primary key(link_id, tag_id)
);
