-- Adds approximate IP geolocation to public click recording.
-- Run after 001_initial.sql in Neon.
drop function if exists analytics.record_public_click(text, inet, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text);

create or replace function analytics.record_public_click(
  p_slug text, p_ip inet, p_user_agent text, p_referrer text,
  p_browser_name text, p_browser_version text, p_os_name text, p_os_version text,
  p_device_type text, p_device_vendor text, p_device_model text, p_language text,
  p_accept_language text, p_method text, p_is_bot boolean, p_bot_name text,
  p_country_code text, p_country_name text, p_region text, p_city text, p_timezone text
)
returns table(id uuid, destination_url text, redirect_mode varchar, name varchar)
language plpgsql security definer set search_path = pg_catalog, links, analytics as $$
declare v_link links.links%rowtype;
begin
  perform set_config('app.public_redirect', '1', true);
  select * into v_link from links.links where slug = p_slug and deleted_at is null and is_active and (expires_at is null or expires_at > now()) and (max_clicks is null or (select count(*) from analytics.clicks where link_id = links.links.id) < max_clicks) limit 1;
  if not found then return; end if;
  insert into analytics.clicks(link_id, ip, user_agent, referrer, browser_name, browser_version, os_name, os_version, device_type, device_vendor, device_model, language, accept_language, method, is_bot, bot_name, country_code, country_name, region, city, timezone)
  values(v_link.id, p_ip, p_user_agent, p_referrer, p_browser_name, p_browser_version, p_os_name, p_os_version, p_device_type, p_device_vendor, p_device_model, p_language, p_accept_language, p_method, p_is_bot, p_bot_name, p_country_code, p_country_name, p_region, p_city, p_timezone);
  insert into analytics.link_daily_stats(link_id, day, clicks, unique_visitors, bots) values(v_link.id, current_date, 1, 0, case when p_is_bot then 1 else 0 end) on conflict(link_id, day) do update set clicks = analytics.link_daily_stats.clicks + 1, bots = analytics.link_daily_stats.bots + excluded.bots;
  return query select v_link.id, v_link.destination_url, v_link.redirect_mode, v_link.name;
end $$;
