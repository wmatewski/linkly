import { UAParser } from 'ua-parser-js'

const geoCache = new Map<string, { expiresAt: number; value: { countryCode: string | null; countryName: string | null; region: string | null; city: string | null; timezone: string | null } }>()

function headerText(request: Request, name: string, limit: number) {
  const value = request.headers.get(name)
  if (!value) return null
  try { return decodeURIComponent(value).slice(0, limit) } catch { return value.slice(0, limit) }
}

async function approximateLocation(request: Request, ip: string | null) {
  const vercelCountryCode = headerText(request, 'x-vercel-ip-country', 2)
  const vercelLocation = {
    countryCode: vercelCountryCode, countryName: vercelCountryCode ? new Intl.DisplayNames(['pl'], { type: 'region' }).of(vercelCountryCode) ?? null : null,
    region: headerText(request, 'x-vercel-ip-country-region', 120), city: headerText(request, 'x-vercel-ip-city', 120),
    timezone: headerText(request, 'x-vercel-ip-timezone', 80),
  }
  if (vercelLocation.countryCode) return vercelLocation
  if (!ip || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd)/i.test(ip)) return { countryCode: null, countryName: null, region: null, city: null, timezone: null }
  const cached = geoCache.get(ip)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  try {
    const response = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { signal: AbortSignal.timeout(1500) })
    const data = await response.json() as Record<string, string>
    const value = { countryCode: data.country_code?.slice(0, 2) ?? null, countryName: data.country_name?.slice(0, 100) ?? null, region: data.region?.slice(0, 120) ?? null, city: data.city?.slice(0, 120) ?? null, timezone: data.timezone?.slice(0, 80) ?? null }
    geoCache.set(ip, { expiresAt: Date.now() + 15 * 60 * 1000, value })
    return value
  } catch {
    return { countryCode: null, countryName: null, region: null, city: null, timezone: null }
  }
}

export async function requestAnalytics(request: Request) {
  const ua = request.headers.get('user-agent') ?? ''
  const parsed = new UAParser(ua).getResult()
  const platform = request.headers.get('sec-ch-ua-platform')?.replaceAll('"', '')
  const platformVersion = request.headers.get('sec-ch-ua-platform-version')?.replaceAll('"', '')
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwarded && /^[0-9a-fA-F:.]+$/.test(forwarded) ? forwarded : null
  const isBot = /bot|crawler|spider|slurp|facebookexternalhit/i.test(ua)
  const location = await approximateLocation(request, ip)
  const windows = /windows/i.test(platform ?? parsed.os.name ?? '')
  const windowsHintVersion = Number.parseInt(platformVersion ?? '', 10)
  const osName = windows ? 'Windows' : parsed.os.name ?? null
  const osVersion = windows ? (Number.isFinite(windowsHintVersion) ? (windowsHintVersion >= 13 ? '11' : '10') : parsed.os.version === '10' ? '10 lub 11' : parsed.os.version ?? null) : parsed.os.version ?? null
  return {
    ip, userAgent: ua || null, referrer: request.headers.get('referer'), browserName: parsed.browser.name ?? null,
    browserVersion: parsed.browser.version ?? null, osName, osVersion,
    deviceType: isBot ? 'bot' : parsed.device.type ?? 'desktop', deviceVendor: parsed.device.vendor ?? null,
    deviceModel: parsed.device.model ?? null, language: request.headers.get('accept-language')?.slice(0, 40) ?? null,
    acceptLanguage: request.headers.get('accept-language'), method: request.method, isBot, botName: isBot ? parsed.browser.name ?? 'bot' : null, ...location,
  }
}
