import { COOKIE_MAP } from './cookies.js'
import { logger } from './logger.js'

// Allowed CDN domains for proxy endpoints (prevents SSRF)
export const ALLOWED_CDN_DOMAINS = [
  'phncdn.com',
  'googlevideo.com',
  'youtube.com',
  'ytimg.com',
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'akamaized.net',
  'cloudfront.net',
  'xvideos-cdn.com',
  'spankbang.com',
  'redgifs.com',
  'thumbs2.redgifs.com',
  'b-cdn.net',         // BunnyCDN (FikFap video streams)
]

export function isAllowedCdnUrl(url) {
  try {
    const hostname = new URL(url).hostname
    return ALLOWED_CDN_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))
  } catch {
    return false
  }
}

// Mode inference: determine if a URL/source is NSFW or social
// Derived from COOKIE_MAP (single source of truth for domain→mode mapping)
const NSFW_DOMAINS = new Set(
  Object.entries(COOKIE_MAP).filter(([, v]) => v.mode === 'nsfw').map(([k]) => k)
)

export function inferMode(urlOrSource) {
  if (!urlOrSource) return 'social'
  const str = urlOrSource.toLowerCase()
  for (const domain of NSFW_DOMAINS) {
    if (str.includes(domain)) return 'nsfw'
  }
  return 'social'
}

/** Read mode from request query, default to 'social' (fail safe).
 *  Logs a warning if mode param is missing on content endpoints. */
export function getMode(req) {
  const mode = req.query.mode
  if (!mode) {
    logger.warn(`Missing mode param on ${req.path} — defaulting to social`, { query: req.query })
  }
  if (mode === 'nsfw') return 'nsfw'
  return 'social'
}

/** Helper: seconds → "3:45" */
export function formatDuration(seconds) {
  if (!seconds) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = String(Math.floor(seconds % 60)).padStart(2, '0')
  return `${m}:${s}`
}

/**
 * Returns the Referer header value to use when proxying a CDN URL.
 * Prevents 403s from CDNs that check the Referer against the originating site.
 */
export function getRefererForUrl(url) {
  if (url.includes('pornhub') || url.includes('phncdn')) return 'https://www.pornhub.com/'
  if (url.includes('tiktok')) return 'https://www.tiktok.com/'
  if (url.includes('googlevideo') || url.includes('youtube')) return 'https://www.youtube.com/'
  if (url.includes('redgifs') || url.includes('b-cdn.net')) return 'https://www.redgifs.com/'
  return 'https://www.youtube.com/'
}

export function safeParse(str, fallback = null) {
  try {
    return JSON.parse(str)
  } catch (err) {
    logger.error('[safeParse] Failed to parse', { preview: str?.slice(0, 200), error: err.message })
    return fallback
  }
}
