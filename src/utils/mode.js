// ============================================================
// Mode utilities (client-side mirror of server/utils.js inferMode)
// ============================================================
// The mode firewall: a video's mode is determined by its source URL.
// A video from pornhub.com is NSFW forever. A video from youtube.com
// is SOCIAL forever. The user's current mode is just the rendering
// context; mode of the CONTENT is fixed at the source.
//
// This module is the source of truth on the client. Every render
// path that displays videos should pass items through filterByMode
// or check isVideoForMode before rendering.
//
// Keep the NSFW_DOMAINS list in sync with server/cookies.js
// COOKIE_MAP. If you add a new NSFW source there, add it here too.
// ============================================================

// Domains classified as NSFW. Sourced from server/cookies.js COOKIE_MAP.
// Use lowercase. Subdomains are matched via .endsWith.
const NSFW_DOMAINS = [
  'pornhub.com',
  'fikfap.com',
  'redgifs.com',
  'xvideos.com',
  'spankbang.com',
  'redtube.com',
  'xhamster.com',
  'youporn.com',
  'xnxx.com',
  // CDNs that exclusively serve NSFW content
  'phncdn.com',     // PornHub CDN
  'b-cdn.net',      // BunnyCDN (FikFap)
  'xhms.pro',       // xHamster CDN
]

// Domains classified as SOCIAL. Used for explicit positive matches when
// inferMode is called on a CDN URL or unfamiliar domain.
const SOCIAL_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'reddit.com',
  'redd.it',
  'googlevideo.com', // YouTube CDN
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'ytimg.com',
]

/**
 * Classify a URL or source string as 'social' or 'nsfw'.
 * Returns 'social' for unknown/empty inputs (matches server behavior).
 */
export function inferMode(urlOrSource) {
  if (!urlOrSource || typeof urlOrSource !== 'string') return 'social'
  const str = urlOrSource.toLowerCase()
  for (const d of NSFW_DOMAINS) {
    if (str.includes(d)) return 'nsfw'
  }
  for (const d of SOCIAL_DOMAINS) {
    if (str.includes(d)) return 'social'
  }
  // Unknown domain: default social (matches server). Server-side firewall
  // is the authoritative final filter; this is a UX guard.
  return 'social'
}

/** Extract a URL-like field from any video-shaped object. */
export function urlOf(item) {
  if (!item || typeof item !== 'object') return null
  return item.url || item.video_url || item.streamUrl || item.stream_url || item.source || null
}

/** Does this video belong in the requested mode? */
export function isVideoForMode(item, mode) {
  if (!mode) return true
  if (!item || typeof item !== 'object') return true
  // Trust an explicit mode field on the item over URL inference.
  // Server-side rows (videos.mode, video_ratings.mode) carry their own mode.
  if (item.mode === 'social' || item.mode === 'nsfw') {
    return item.mode === mode
  }
  const url = urlOf(item)
  if (!url) return true // Can't classify, allow through
  return inferMode(url) === mode
}

/** Filter an array of video-shaped objects to only those matching the given mode. */
export function filterByMode(items, mode) {
  if (!Array.isArray(items)) return items
  return items.filter((it) => isVideoForMode(it, mode))
}

/** Translate the boolean isSFW flag into the wire-format 'social' | 'nsfw'. */
export function modeFromIsSFW(isSFW) {
  return isSFW ? 'social' : 'nsfw'
}
