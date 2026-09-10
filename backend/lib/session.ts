import { decode, encode } from '@auth/core/jwt'

const cookieName = process.env.AUTH_SESSION_COOKIE ?? 'authjs.session-token'
const authSecret = process.env.AUTH_SECRET ?? ''
if (!authSecret) throw new Error('AUTH_SECRET is required')

export type SessionUser = { id: string; email: string; name: string | null }

export async function createSession(user: SessionUser) {
  return encode({ secret: authSecret, salt: cookieName, token: { sub: user.id, email: user.email, name: user.name }, maxAge: 60 * 60 * 24 * 30 })
}

export async function readSession(request: Request): Promise<SessionUser | null> {
  const raw = request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${cookieName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}=([^;]+)`))?.[1]
  if (!raw) return null
  const token = await decode({ secret: authSecret, salt: cookieName, token: decodeURIComponent(raw) })
  const id = token?.sub
  if (!id || typeof token?.email !== 'string') return null
  return { id, email: token.email, name: typeof token.name === 'string' ? token.name : null }
}

export function sessionCookie(value: string, maxAge = 60 * 60 * 24 * 30) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  // Intentionally no Domain attribute: this is a host-only cookie.
  return `${cookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

export function clearSessionCookie() { return sessionCookie('', 0) }
