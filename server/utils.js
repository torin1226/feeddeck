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
  'xhms.pro',          // xHamster CDN
  'redtube.com',       // RedTube CDN (also uses phncdn.com)
  'youporn.com',       // YouPorn CDN (also uses phncdn.com)
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

/** Pull a URL-like string off any video-shaped object.
 *  Returns null if no URL field is present. */
export function urlOf(item) {
  if (!item || typeof item !== 'object') return null
  return item.url || item.video_url || item.streamUrl || item.stream_url || item.source || null
}

/** Helper: seconds → "3:45" */
export function formatDuration(seconds) {
  if (!seconds) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = String(Math.floor(seconds % 60)).padStart(2, '0')
  return `${m}:${s}`
}

// Referer rules for CDN proxying.
// Each rule: when the URL contains ANY of `match`, send `referer`.
// Order matters -- first matching rule wins.
// IMPORTANT: When adding a new NSFW source to COOKIE_MAP (server/cookies.js)
// AND ALLOWED_CDN_DOMAINS above, also add a rule here. Without it, the CDN
// will silently return 403 (it sees the wrong Referer). The server test
// suite asserts every NSFW source in COOKIE_MAP has its own rule here.
export const REFERER_RULES = [
  { match: ['pornhub', 'phncdn'],            referer: 'https://www.pornhub.com/' },
  { match: ['tiktok'],                        referer: 'https://www.tiktok.com/' },
  { match: ['googlevideo', 'youtube'],        referer: 'https://www.youtube.com/' },
  { match: ['redgifs'],                       referer: 'https://www.redgifs.com/' },
  { match: ['b-cdn.net'],                     referer: 'https://fikfap.com/' },
  { match: ['xhamster', 'xhms', 'hamster'],   referer: 'https://xhamster.com/' },
  { match: ['xvideos', 'xv-cdn'],             referer: 'https://www.xvideos.com/' },
  { match: ['spankbang'],                     referer: 'https://spankbang.com/' },
  { match: ['redtube'],                       referer: 'https://www.redtube.com/' },
  { match: ['youporn'],                       referer: 'https://www.youporn.com/' },
  { match: ['fikfap'],                        referer: 'https://fikfap.com/' },
  { match: ['xnxx'],                          referer: 'https://www.xnxx.com/' },
]

const DEFAULT_REFERER = 'https://www.youtube.com/'

/**
 * Returns the Referer header value to use when proxying a CDN URL.
 * Prevents 403s from CDNs that check the Referer against the originating site.
 */
export function getRefererForUrl(url) {
  if (!url) return DEFAULT_REFERER
  for (const rule of REFERER_RULES) {
    for (const m of rule.match) {
      if (url.includes(m)) return rule.referer
    }
  }
  return DEFAULT_REFERER
}

export function safeParse(str, fallback = null) {
  try {
    return JSON.parse(str)
  } catch (err) {
    logger.error('[safeParse] Failed to parse', { preview: str?.slice(0, 200), error: err.message })
    return fallback
  }
}
