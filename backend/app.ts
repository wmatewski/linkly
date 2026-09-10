import { Hono } from 'hono'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { asUser, sql } from './lib/db.js'
import { clearSessionCookie, createSession, readSession, sessionCookie } from './lib/session.js'
import { requestAnalytics } from './lib/analytics.js'
import { sendLoginEmail, sendPasswordChangedEmail, sendPasswordResetEmail, sendWelcomeEmail } from './lib/email.js'
import { createHash, randomBytes } from 'node:crypto'

const app = new Hono()
const password = z.string().min(8, 'Hasło musi mieć co najmniej 8 znaków.').max(200).regex(/[a-z]/, 'Hasło musi zawierać małą literę.').regex(/[A-Z]/, 'Hasło musi zawierać wielką literę.').regex(/\d/, 'Hasło musi zawierać cyfrę.')
const registration = z.object({ name: z.string().trim().min(2, 'Wpisz imię i nazwisko.').max(120), email: z.string().email('Wpisz poprawny adres e-mail.').max(320), password, confirmPassword: z.string() }).refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Hasła muszą być identyczne.' })
const login = z.object({ email: z.string().trim().min(1), password: z.string().min(1) })
const passwordReset = z.object({ token: z.string().min(32), password, confirmPassword: z.string() }).refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Hasła muszą być identyczne.' })
const newLink = z.object({ destinationUrl: z.string().url('Wpisz poprawny adres URL.').refine((value) => /^https?:\/\//i.test(value), 'Adres musi zaczynać się od http:// lub https://.'), name: z.string().trim().max(160).optional(), description: z.string().trim().max(4000).optional(), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{2,79}$/).optional(), redirectMode: z.enum(['direct', 'redirect_page', 'information_page']).optional() })

function problem(message: string, status = 400, fields?: Record<string, string>) { return { message, status, fields } }
async function parse<T>(request: Request, schema: z.ZodType<T>) { return schema.parse(await request.json()) }
async function userFrom(request: Request) { const user = await readSession(request); if (!user) throw problem('Zaloguj się, aby kontynuować.', 401); return user }
function domain(request: Request) { return (process.env.VITE_APP_DOMAIN || new URL(request.url).origin).replace(/\/$/, '') }
function linkDto(row: any, request: Request) { return { id: row.id, slug: row.slug, shortUrl: `${domain(request)}/${row.slug}`, url: row.destination_url, title: row.name ?? 'Bez nazwy', description: row.description ?? '', clicks: Number(row.clicks ?? 0), createdAt: row.created_at, lastClickAt: row.last_click_at, status: row.is_active ? 'Aktywny' : 'Wstrzymany', redirectMode: row.redirect_mode } }
function tokenHash(token: string) { return createHash('sha256').update(token).digest('hex') }
function deliver(message: Promise<void>) { void message.catch((error) => console.error('Nie udało się wysłać e-maila:', error)) }

app.onError((error, c) => {
  if (error instanceof z.ZodError) { const fields = Object.fromEntries(error.issues.map((issue) => [String(issue.path[0] ?? 'form'), issue.message])); return c.json({ error: 'Popraw zaznaczone pola.', fields }, 422) }
  if (typeof error === 'object' && error && 'status' in error) return c.json({ error: (error as any).message, fields: (error as any).fields }, (error as any).status)
  console.error(error)
  return c.json({ error: 'Wystąpił nieoczekiwany błąd.' }, 500)
})

app.get('/auth/session', async (c) => c.json({ user: await readSession(c.req.raw) }))
app.post('/auth/register', async (c) => {
  const input = await parse(c.req.raw, registration)
  const email = input.email.toLowerCase()
  const exists = await sql`select 1 from auth.users where email = ${email} limit 1`
  if (exists.length) throw problem('Nie udało się utworzyć konta dla tego adresu e-mail.', 409, { email: 'Ten adres e-mail jest już używany.' })
  const hash = await bcrypt.hash(input.password, 12)
  const rows = await sql`insert into auth.users(name, email) values (${input.name}, ${email}) returning id, email, name`
  const created = rows[0]
  await sql`insert into auth.password_credentials(user_id, password_hash) values (${created.id}, ${hash})`
  await sql`insert into auth.user_settings(user_id) values (${created.id})`
  const token = await createSession({ id: String(created.id), email: String(created.email), name: String(created.name) })
  c.header('Set-Cookie', sessionCookie(token))
  deliver(sendWelcomeEmail(String(created.email), String(created.name)))
  return c.json({ user: { id: created.id, email: created.email, name: created.name } }, 201)
})
app.post('/auth/login', async (c) => {
  const input = await parse(c.req.raw, login)
  const rows = await sql`select u.id, u.email, u.name, p.password_hash from auth.users u join auth.password_credentials p on p.user_id = u.id where u.email = ${input.email.toLowerCase()} limit 1`
  const found = rows[0]
  if (!found || !(await bcrypt.compare(input.password, found.password_hash))) throw problem('Email lub hasło jest niepoprawne. Spróbuj ponownie.', 401)
  const token = await createSession({ id: String(found.id), email: String(found.email), name: found.name ? String(found.name) : null })
  c.header('Set-Cookie', sessionCookie(token))
  deliver(sendLoginEmail(String(found.email), found.name ? String(found.name) : null))
  return c.json({ user: { id: found.id, email: found.email, name: found.name } })
})
app.post('/auth/logout', (c) => { c.header('Set-Cookie', clearSessionCookie()); return c.body(null, 204) })
app.post('/auth/forgot-password', async (c) => {
  const input = await parse(c.req.raw, z.object({ email: z.string().trim().email() }))
  const rows = await sql`select id, email, name from auth.users where email = ${input.email.toLowerCase()} limit 1`
  const user = rows[0]
  if (user) {
    const rawToken = randomBytes(32).toString('base64url')
    await sql.begin(async (tx) => {
      await tx`update auth.one_time_tokens set used_at = now() where user_id = ${user.id} and purpose = 'reset_password' and used_at is null`
      await tx`insert into auth.one_time_tokens(user_id, purpose, token_hash, expires_at) values (${user.id}, 'reset_password', ${tokenHash(rawToken)}, now() + interval '1 hour')`
    })
    deliver(sendPasswordResetEmail(String(user.email), user.name ? String(user.name) : null, `${domain(c.req.raw)}/reset-password?token=${encodeURIComponent(rawToken)}`))
  }
  return c.json({ message: 'Jeżeli konto istnieje, wysłaliśmy instrukcję resetu hasła.' }, 202)
})
app.post('/auth/reset-password', async (c) => {
  const input = await parse(c.req.raw, passwordReset)
  const users = await sql.begin(async (tx) => {
    const tokens = await tx`update auth.one_time_tokens set used_at = now() where token_hash = ${tokenHash(input.token)} and purpose = 'reset_password' and used_at is null and expires_at > now() returning user_id`
    if (!tokens.length) return []
    await tx`update auth.password_credentials set password_hash = ${await bcrypt.hash(input.password, 12)}, password_changed_at = now(), updated_at = now() where user_id = ${tokens[0].user_id}`
    return tx`select email, name from auth.users where id = ${tokens[0].user_id}`
  })
  if (!users.length) throw problem('Link do resetu hasła jest nieprawidłowy lub wygasł.', 422)
  const recipient = users[0] as { email: string; name: string | null }
  deliver(sendPasswordChangedEmail(String(recipient.email), recipient.name ? String(recipient.name) : null))
  return c.body(null, 204)
})

app.get('/account', async (c) => c.json({ user: await userFrom(c.req.raw) }))
app.patch('/account', async (c) => {
  const user = await userFrom(c.req.raw); const input = await parse(c.req.raw, z.object({ name: z.string().trim().min(2).max(120), email: z.string().email().max(320) }))
  const rows = await sql`update auth.users set name = ${input.name}, email = ${input.email.toLowerCase()}, updated_at = now() where id = ${user.id} returning id, name, email`
  const updated = rows[0]
  const token = await createSession({ id: String(updated.id), email: String(updated.email), name: updated.name ? String(updated.name) : null })
  c.header('Set-Cookie', sessionCookie(token))
  return c.json({ user: updated })
})
app.patch('/account/password', async (c) => {
  const user = await userFrom(c.req.raw); const input = await parse(c.req.raw, z.object({ currentPassword: z.string().min(1), password, confirmPassword: z.string() }).refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Hasła muszą być identyczne.' }))
  const rows = await sql`select password_hash from auth.password_credentials where user_id = ${user.id}`
  if (!rows[0] || !(await bcrypt.compare(input.currentPassword, rows[0].password_hash))) throw problem('Obecne hasło jest nieprawidłowe.', 422, { currentPassword: 'Obecne hasło jest nieprawidłowe.' })
  await sql`update auth.password_credentials set password_hash = ${await bcrypt.hash(input.password, 12)}, password_changed_at = now(), updated_at = now() where user_id = ${user.id}`
  deliver(sendPasswordChangedEmail(user.email, user.name))
  return c.body(null, 204)
})

app.get('/dashboard', async (c) => {
  const user = await userFrom(c.req.raw)
  const data = await asUser(user.id, async (tx) => {
    const summary = await tx`select count(c.id)::int as clicks, count(*) filter (where l.deleted_at is null and l.is_active)::int as active_links, count(c.id) filter (where c.occurred_at >= date_trunc('day', now()))::int as today_clicks from links.links l left join analytics.clicks c on c.link_id = l.id where l.deleted_at is null`
    const activity = await tx`select to_char(days.day, 'YYYY-MM-DD') as day, coalesce(sum(s.clicks), 0)::int as clicks from generate_series(current_date - interval '6 days', current_date, interval '1 day') as days(day) left join analytics.link_daily_stats s on s.day = days.day::date and exists (select 1 from links.links l where l.id = s.link_id and l.user_id = auth.current_user_id() and l.deleted_at is null) group by days.day order by days.day`
    const top = await tx`select l.*, count(c.id) as clicks, max(c.occurred_at) as last_click_at from links.links l left join analytics.clicks c on c.link_id = l.id where l.deleted_at is null group by l.id order by count(c.id) desc, l.created_at desc limit 3`
    const recent = await tx`select l.*, count(c.id) as clicks, max(c.occurred_at) as last_click_at from links.links l left join analytics.clicks c on c.link_id = l.id where l.deleted_at is null group by l.id order by l.created_at desc limit 4`
    return { summary: summary[0], activity, top, recent }
  })
  return c.json({ summary: { clicks: Number(data.summary.clicks), activeLinks: Number(data.summary.active_links), todayClicks: Number(data.summary.today_clicks) }, activity: data.activity.map((x: any) => ({ day: x.day, clicks: Number(x.clicks) })), topLinks: data.top.map((x: any) => linkDto(x, c.req.raw)), recentLinks: data.recent.map((x: any) => linkDto(x, c.req.raw)) })
})

app.get('/links', async (c) => {
  const user = await userFrom(c.req.raw); const q = c.req.query('q')?.trim() ?? ''
  const links = await asUser(user.id, (tx) => tx`select l.*, count(c.id) as clicks, max(c.occurred_at) as last_click_at from links.links l left join analytics.clicks c on c.link_id = l.id where l.deleted_at is null and (${q} = '' or l.slug ilike ${'%' + q + '%'} or coalesce(l.name,'') ilike ${'%' + q + '%'} or l.destination_url ilike ${'%' + q + '%'}) group by l.id order by l.created_at desc`)
  return c.json({ links: links.map((x: any) => linkDto(x, c.req.raw)) })
})
app.post('/links', async (c) => {
  const user = await userFrom(c.req.raw); const input = await parse(c.req.raw, newLink); const slug = input.slug ?? crypto.randomUUID().replace(/-/g, '').slice(0, 7)
  const rows = await asUser(user.id, (tx) => tx`insert into links.links(user_id, slug, destination_url, name, description, redirect_mode) values (${user.id}, ${slug}, ${input.destinationUrl}, ${input.name ?? null}, ${input.description ?? null}, ${input.redirectMode ?? 'redirect_page'}) returning *`)
  return c.json({ link: linkDto(rows[0], c.req.raw) }, 201)
})
app.delete('/links/:id', async (c) => { const user = await userFrom(c.req.raw); const rows = await asUser(user.id, (tx) => tx`update links.links set deleted_at = now(), updated_at = now() where id = ${c.req.param('id')} returning id`); if (!rows.length) throw problem('Nie znaleziono linku.', 404); return c.body(null, 204) })
app.get('/links/:id', async (c) => {
  const user = await userFrom(c.req.raw); const data = await asUser(user.id, async (tx) => {
    const links = await tx`select l.*, count(c.id) as clicks, max(c.occurred_at) as last_click_at from links.links l left join analytics.clicks c on c.link_id = l.id where l.id = ${c.req.param('id')} and l.deleted_at is null group by l.id`; if (!links.length) return null
    const id = links[0].id
    const clicks = await tx`select id, occurred_at, host(ip) as ip, user_agent, referrer, browser_name, browser_version, os_name, os_version, device_type, device_vendor, device_model, country_code, country_name, region, city, timezone, language, method, is_bot, bot_name from analytics.clicks where link_id = ${id} order by occurred_at desc limit 200`
    const summary = await tx`select count(*)::int as clicks, count(distinct ip)::int as unique_visitors, coalesce(round(100.0 * count(*) filter (where device_type = 'mobile') / nullif(count(*),0),1),0) as mobile_percent, coalesce(mode() within group (order by country_code), '-') as country_code from analytics.clicks where link_id = ${id}`
    const timeline = await tx`select to_char(date_trunc('hour', occurred_at), 'HH24:00') as label, count(*)::int as clicks from analytics.clicks where link_id = ${id} and occurred_at >= now() - interval '24 hours' group by 1 order by 1`
    const devices = await tx`select coalesce(device_type, 'other') as label, count(*)::int as clicks from analytics.clicks where link_id = ${id} group by 1 order by 2 desc`
    return { link: links[0], clicks, summary: summary[0], timeline, devices }
  }); if (!data) throw problem('Nie znaleziono linku.', 404)
  return c.json({ link: linkDto(data.link, c.req.raw), clicks: data.clicks, summary: { clicks: Number(data.summary.clicks), uniqueVisitors: Number(data.summary.unique_visitors), mobilePercent: Number(data.summary.mobile_percent), countryCode: data.summary.country_code }, timeline: data.timeline.map((x: any) => ({ label: x.label, clicks: Number(x.clicks) })), devices: data.devices.map((x: any) => ({ label: x.label, clicks: Number(x.clicks) })) })
})

app.get('/public/:slug', async (c) => {
  c.header('Accept-CH', 'Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version, Sec-CH-UA-Model, Sec-CH-UA-Mobile')
  const a = await requestAnalytics(c.req.raw)
  const rows = await sql`select * from analytics.record_public_click(${c.req.param('slug')}, ${a.ip}, ${a.userAgent}, ${a.referrer}, ${a.browserName}, ${a.browserVersion}, ${a.osName}, ${a.osVersion}, ${a.deviceType}, ${a.deviceVendor}, ${a.deviceModel}, ${a.language}, ${a.acceptLanguage}, ${a.method}, ${a.isBot}, ${a.botName}, ${a.countryCode}, ${a.countryName}, ${a.region}, ${a.city}, ${a.timezone})`
  if (!rows.length) throw problem('Nie znaleziono aktywnego linku.', 404)
  return c.json({ destinationUrl: rows[0].destination_url, redirectMode: rows[0].redirect_mode, name: rows[0].name ?? null })
})

export default app
