// ============================================================
// Content Filters
// Shared filters for keeping low-quality / off-topic content out
// of homepage_cache and feed_cache.
// ============================================================

import { db } from './database.js'

// Heuristic patterns that match low-effort YouTube clickbait farms.
// Tuned against real contamination seen in social_late_night
// ("Try Not To Laugh — Top 100 Funniest Videos Ever 2026 #109",
// "TRY NOT TO LAUGH 🤣 Top 101 Funniest Videos Ever", etc).
const CLICKBAIT_PATTERNS = [
  /try\s*not\s*to\s*laugh/i,
  /top\s+\d{2,3}\s+(funniest|funny|trending|viral)/i,
  /funny\s+videos?\s+(compilation|of\s+the)/i,
  /you\s+laugh\s+you\s+lose/i,
  /(funniest|funny)\s+videos?\s+(ever|of\s+(the\s+)?(year|week|month))/i,
  /best\s+of\s+\d{4}\s+(funny|comedy|trending)/i,
]

// Hashtag-spam pattern: 3+ hashtags in a title is a strong signal
// the content is algorithmically gamed shorts/reels content.
const HASHTAG_SPAM = /(#\w+\s*){3,}/

export function isClickbaitTitle(title) {
  if (!title || typeof title !== 'string') return false
  if (HASHTAG_SPAM.test(title)) return true
  return CLICKBAIT_PATTERNS.some(p => p.test(title))
}

// Returns sets of identifiers that uniquely identify a real YouTube
// subscription. We match on channel_id when available, but
// subscription_backups today only stores display_name/handle (manual
// import path doesn't capture UC-ids), so we also match on name.
// Cached at module level since subscription_backups changes rarely.
let _subscribedSets = null
let _subscribedSetsLoadedAt = 0
const SUBS_CACHE_TTL_MS = 5 * 60 * 1000

function _normName(s) {
  return (s || '').toLowerCase().trim()
}

export function getSubscribedYouTubeIdentifiers() {
  const now = Date.now()
  if (_subscribedSets && (now - _subscribedSetsLoadedAt) < SUBS_CACHE_TTL_MS) {
    return _subscribedSets
  }
  const ids = new Set()
  const names = new Set()
  try {
    const rows = db.prepare(
      "SELECT platform_id, display_name, handle FROM subscription_backups WHERE platform = 'youtube'"
    ).all()
    for (const r of rows) {
      if (r.platform_id) ids.add(r.platform_id)
      if (r.display_name) names.add(_normName(r.display_name))
      if (r.handle) names.add(_normName(r.handle))
    }
  } catch { /* keep empty sets */ }
  _subscribedSets = { ids, names }
  _subscribedSetsLoadedAt = now
  return _subscribedSets
}

// Decides whether a yt-dlp raw entry from /feed/subscriptions is from a
// real subscription. Returns true if the entry's channel_id OR channel
// name matches an entry in subscription_backups.
export function isFromSubscribedYouTubeChannel(rawEntry) {
  const { ids, names } = getSubscribedYouTubeIdentifiers()
  if (ids.size === 0 && names.size === 0) return true // no signal -> don't filter
  const cid = rawEntry?.channel_id || rawEntry?.uploader_id
  if (cid && ids.has(cid)) return true
  const name = _normName(rawEntry?.channel || rawEntry?.uploader || rawEntry?.creator)
  if (name && names.has(name)) return true
  return false
}

export function _resetSubscribedChannelCache() {
  _subscribedSets = null
  _subscribedSetsLoadedAt = 0
}
