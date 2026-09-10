import { Hono } from 'hono'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { asUser, sql } from './lib/db.js'
import { clearSessionCookie, createSession, readSession, sessionCookie } from './lib/session.js'
import { requestAnalytics } from './lib/analytics.js'
import { Auth } from '@auth/core'
import Google from '@auth/core/providers/google'

const app = new Hono()

const credentials = z.object({ email: z.string().email().max(320), password: z.string().min(8).max(200), name: z.string().trim().min(1).max(120).optional() })
const newLink = z.object({ destinationUrl: z.string().url().refine((value) => /^https?:\/\//i.test(value)), name: z.string().trim().max(160).optional(), description: z.string().trim().max(4000).optional(), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{2,79}$/).optional(), redirectMode: z.enum(['direct', 'redirect_page', 'information_page']).optional() })

function jsonError(message: string, status = 400) { return { message, status } }
async function body<T>(request: Request, schema: z.ZodType<T>) { return schema.parse(await request.json()) }
async function requiredUser(request: Request) { const user = await readSession(request); if (!user) throw jsonError('Zaloguj się, aby kontynuować.', 401); return user }
function appDomain() { return process.env.VITE_APP_DOMAIN?.replace(/\/$/, '') ?? '' }
function serializeLink(row: any) { return { id: row.id, slug: row.slug, url: row.destination_url, title: row.name ?? 'Bez nazwy', description: row.description, clicks: Number(row.clicks ?? 0), created: row.created_at, last: row.last_click_at, status: row.is_active ? 'Aktywny' : 'Wstrzymany', redirectMode: row.redirect_mode } }

app.all('/auth/authjs/*', async (c) => {
  const response = await Auth(c.req.raw, {
    trustHost: process.env.AUTH_TRUST_HOST === 'true', secret: process.env.AUTH_SECRET, session: { strategy: 'jwt' },
    providers: [Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET })],
    callbacks: {
      async signIn({ user, account }) {
        if (!user.email || !account) return false
        const rows = await sql`insert into auth.users(name, email, image, email_verified) values (${user.name ?? null}, ${user.email.toLowerCase()}, ${user.image ?? null}, now()) on conflict(email) do update set name = excluded.name, image = excluded.image, updated_at = now() returning id`
        await sql`insert into auth.accounts(user_id, type, provider, provider_account_id, access_token, refresh_token, expires_at, token_type, scope, id_token) values (${rows[0].id}, ${account.type}, ${account.provider}, ${account.providerAccountId}, ${account.access_token ?? null}, ${account.refresh_token ?? null}, ${account.expires_at ?? null}, ${account.token_type ?? null}, ${account.scope ?? null}, ${account.id_token ?? null}) on conflict(provider, provider_account_id) do update set access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at`
        await sql`insert into auth.user_settings(user_id) values (${rows[0].id}) on conflict do nothing`
        ;(user as any).id = rows[0].id
        return true
      },
      async jwt({ token, user }) {
        if (user?.email) {
          const rows = await sql`select id from auth.users where email = ${user.email.toLowerCase()} limit 1`
          if (rows[0]) token.sub = rows[0].id
        }
        return token
      },
    },
  })
  return response
})

app.onError((error, c) => {
  if (typeof error === 'object' && error && 'status' in error) return c.json({ error: (error as any).message }, (error as any).status)
  if (error instanceof z.ZodError) return c.json({ error: 'Nieprawidłowe dane formularza.' }, 422)
  console.error(error)
  return c.json({ error: 'Wystąpił nieoczekiwany błąd.' }, 500)
})

app.post('/auth/register', async (c) => {
  const input = await body(c.req.raw, credentials)
  const hash = await bcrypt.hash(input.password, 12)
  const rows = await sql`insert into auth.users(name, email) values (${input.name ?? null}, ${input.email.toLowerCase()}) returning id, email, name`
  const user = rows[0]
  await sql`insert into auth.password_credentials(user_id, password_hash) values (${user.id}, ${hash})`
  await sql`insert into auth.user_settings(user_id) values (${user.id})`
  const token = await createSession({ id: String(user.id), email: String(user.email), name: user.name ? String(user.name) : null })
  c.header('Set-Cookie', sessionCookie(token))
  return c.json({ user })
})
app.post('/auth/login', async (c) => {
  const input = await body(c.req.raw, credentials.pick({ email: true, password: true }))
  const rows = await sql`select u.id, u.email, u.name, p.password_hash from auth.users u join auth.password_credentials p on p.user_id = u.id where u.email = ${input.email.toLowerCase()} limit 1`
  const user = rows[0]
  if (!user || !(await bcrypt.compare(input.password, user.password_hash))) throw jsonError('Nieprawidłowy adres e-mail lub hasło.', 401)
  const token = await createSession({ id: String(user.id), email: String(user.email), name: user.name ? String(user.name) : null })
  c.header('Set-Cookie', sessionCookie(token))
  return c.json({ user: { id: user.id, email: user.email, name: user.name } })
})
app.post('/auth/logout', (c) => { c.header('Set-Cookie', clearSessionCookie()); return c.body(null, 204) })
app.get('/auth/session', async (c) => c.json({ user: await readSession(c.req.raw) }))

app.get('/links', async (c) => {
  const user = await requiredUser(c.req.raw)
  const q = c.req.query('q')?.trim() ?? ''
  const links = await asUser(user.id, (tx) => tx`
    select l.*, count(c.id) as clicks, max(c.occurred_at) as last_click_at from links.links l
    left join analytics.clicks c on c.link_id = l.id where l.deleted_at is null
    and (${q} = '' or l.slug ilike ${'%' + q + '%'} or coalesce(l.name,'') ilike ${'%' + q + '%'} or l.destination_url ilike ${'%' + q + '%'})
    group by l.id order by l.created_at desc`)
  return c.json({ links: links.map(serializeLink), appDomain: appDomain() })
})
app.post('/links', async (c) => {
  const user = await requiredUser(c.req.raw); const input = await body(c.req.raw, newLink)
  const base = input.slug ?? crypto.randomUUID().replace(/-/g, '').slice(0, 7)
  const rows = await asUser(user.id, (tx) => tx`insert into links.links(user_id, slug, destination_url, name, description, redirect_mode) values (${user.id}, ${base}, ${input.destinationUrl}, ${input.name ?? null}, ${input.description ?? null}, ${input.redirectMode ?? 'direct'}) returning *`)
  return c.json({ link: serializeLink(rows[0]), shortUrl: `${appDomain()}/${base}` }, 201)
})
app.delete('/links/:id', async (c) => {
  const user = await requiredUser(c.req.raw)
  const result = await asUser(user.id, (tx) => tx`update links.links set deleted_at = now(), updated_at = now() where id = ${c.req.param('id')} returning id`)
  if (!result.length) throw jsonError('Nie znaleziono linku.', 404)
  return c.body(null, 204)
})
app.get('/links/:id', async (c) => {
  const user = await requiredUser(c.req.raw)
  const data = await asUser(user.id, async (tx) => {
    const links = await tx`select l.*, count(c.id) as clicks, max(c.occurred_at) as last_click_at from links.links l left join analytics.clicks c on c.link_id = l.id where l.id = ${c.req.param('id')} and l.deleted_at is null group by l.id`
    if (!links.length) return null
    const clicks = await tx`select occurred_at, host(ip) as ip, browser_name, browser_version, os_name, os_version, device_type, country_name, city, referrer from analytics.clicks where link_id = ${links[0].id} order by occurred_at desc limit 200`
    const summary = await tx`select count(*)::int as clicks, count(distinct ip)::int as unique_visitors, coalesce(round(100.0 * count(*) filter (where device_type = 'mobile') / nullif(count(*),0),1),0) as mobile_percent, mode() within group (order by country_code) as country_code from analytics.clicks where link_id = ${links[0].id}`
    return { link: serializeLink(links[0]), clicks, summary: summary[0] }
  })
  if (!data) throw jsonError('Nie znaleziono linku.', 404)
  return c.json(data)
})

app.get('/r/:slug', async (c) => {
  const a = requestAnalytics(c.req.raw)
  const rows = await sql`select * from analytics.record_public_click(${c.req.param('slug')}, ${a.ip}, ${a.userAgent}, ${a.referrer}, ${a.browserName}, ${a.browserVersion}, ${a.osName}, ${a.osVersion}, ${a.deviceType}, ${a.deviceVendor}, ${a.deviceModel}, ${a.language}, ${a.acceptLanguage}, ${a.method}, ${a.isBot}, ${a.botName})`
  if (!rows.length) return c.text('Nie znaleziono aktywnego linku.', 404)
  const link = rows[0]
  if (link.redirect_mode === 'direct') return c.redirect(link.destination_url, 302)
  return c.json({ destinationUrl: link.destination_url, redirectMode: link.redirect_mode, name: link.name })
})

export default app
