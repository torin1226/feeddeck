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

export function safeParse(str, fallback = null) {
  try {
    return JSON.parse(str)
  } catch (err) {
    console.error('[safeParse] Failed to parse:', str?.slice(0, 200), err.message)
    return fallback
  }
}
