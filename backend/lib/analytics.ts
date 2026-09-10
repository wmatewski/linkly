import { UAParser } from 'ua-parser-js'

export function requestAnalytics(request: Request) {
  const ua = request.headers.get('user-agent') ?? ''
  const parsed = new UAParser(ua).getResult()
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwarded && /^[0-9a-fA-F:.]+$/.test(forwarded) ? forwarded : null
  const isBot = /bot|crawler|spider|slurp|facebookexternalhit/i.test(ua)
  return {
    ip, userAgent: ua || null, referrer: request.headers.get('referer'), browserName: parsed.browser.name ?? null,
    browserVersion: parsed.browser.version ?? null, osName: parsed.os.name ?? null, osVersion: parsed.os.version ?? null,
    deviceType: isBot ? 'bot' : parsed.device.type ?? 'desktop', deviceVendor: parsed.device.vendor ?? null,
    deviceModel: parsed.device.model ?? null, language: request.headers.get('accept-language')?.slice(0, 40) ?? null,
    acceptLanguage: request.headers.get('accept-language'), method: request.method, isBot, botName: isBot ? parsed.browser.name ?? 'bot' : null,
  }
}
