import { db } from './database.js'
import { logger } from './logger.js'

// ============================================================
// Point-Based Scoring Engine
//
// Per the user's spec, every video accumulates additive points
// from a set of signals, then a divisive age penalty is applied.
//
// Priority order (highest to lowest, additive points stack):
//   1. From a subscribed creator (+SUBSCRIBER)
//   2. Each matching liked tag (+LIKED_TAG_PER_MATCH, stacks)
//   3. Video like_count (log-scaled, capped at +25)
//   4. Recent (uploaded in last 30 days) (+RECENT_30D)
//   5. View count (log-scaled, capped at +15)
//   6. From a saved manual search (+SYSTEM_SEARCH)
//   7. Older than 30 days (-OLDER_30D)
//   8. Older than 2 years: divide final score by ageYears
//
// Videos below MIN_VISIBLE_SCORE are filtered out by callers
// (so we never surface low-quality content).
// ============================================================

const POINTS = {
  subscriber: 100,
  likedTagPerMatch: 30,
  recent30d: 20,
  systemSearch: 10,
  older30d: -5,
}

const LIKE_CAP = 25
const VIEW_CAP = 15
const SUBSCRIBER_COUNT_CAP = 5
const CREATOR_BOOST_MULTIPLIER = 40
const CREATOR_BOOST_CAP = 30
const AGE_PENALTY_MIN_YEARS = 2
const MS_PER_DAY = 86_400_000
const MS_PER_YEAR = 365.25 * MS_PER_DAY

export const MIN_VISIBLE_SCORE = 5

// Cache profile data to avoid re-querying on every video
let _profileCache = null
let _profileCacheTime = 0
const CACHE_TTL_MS = 30_000

function _loadProfile() {
  const now = Date.now()
  if (_profileCache && (now - _profileCacheTime) < CACHE_TTL_MS) {
    return _profileCache
  }

  try {
    const signals = db.prepare('SELECT signal_type, signal_value, weight FROM taste_profile').all()
    const downvotedUrls = db.prepare("SELECT video_url FROM video_ratings WHERE rating = 'down'").all()
    const creatorBoostRows = db.prepare('SELECT creator, boost_score FROM creator_boosts').all()

    const likedTagSet = new Set()
    const dislikedTagSet = new Set()
    for (const s of signals) {
      if (s.signal_type !== 'tag' || !s.signal_value) continue
      const tag = s.signal_value.toLowerCase()
      if (s.weight > 0) likedTagSet.add(tag)
      else if (s.weight < 0) dislikedTagSet.add(tag)
    }

    const creatorBoosts = new Map()
    for (const r of creatorBoostRows) {
      if (r.creator && r.boost_score !== 0) creatorBoosts.set(r.creator, r.boost_score)
    }

    _profileCache = {
      likedTagSet,
      dislikedTagSet,
      downvotedUrls: new Set(downvotedUrls.map(r => r.video_url)),
      creatorBoosts,
    }
    _profileCacheTime = now
    return _profileCache
  } catch (err) {
    logger.error('Failed to load taste profile', { error: err.message })
    return {
      likedTagSet: new Set(), dislikedTagSet: new Set(), downvotedUrls: new Set(),
    }
  }
}

function _parseTags(tags) {
  if (Array.isArray(tags)) return tags
  if (typeof tags !== 'string') return []
  try { return JSON.parse(tags || '[]') } catch { return [] }
}

function _ageMs(uploadDate) {
  if (!uploadDate) return null
  const t = new Date(uploadDate).getTime()
  if (isNaN(t)) return null
  return Date.now() - t
}

/**
 * Score a single video with the point-based formula.
 *
 * @param {Object} video - Has: tags, like_count, view_count, subscriber_count,
 *                              upload_date, url, creator/uploader
 * @param {string} surfaceKey - Surface context (kept for API compatibility)
 * @param {Object} [profile] - Pre-loaded profile (optional)
 * @param {Object} [opts] - { isSubscribed, fromSavedSearch }
 * @returns {number} Final point score (0 if downvoted, otherwise >= 0)
 */
export function scoreVideo(video, _surfaceKey = null, profile = null, opts = {}) {
  const p = profile || _loadProfile()

  // Hard exclude downvoted
  if (p.downvotedUrls.has(video.url)) return 0

  let points = 0

  // 1. Subscribed creator
  if (opts.isSubscribed) points += POINTS.subscriber

  // 2. Liked tags (each match stacks)
  const tags = _parseTags(video.tags)
  for (const t of tags) {
    if (typeof t !== 'string') continue
    if (p.likedTagSet.has(t.toLowerCase())) points += POINTS.likedTagPerMatch
  }

  // 3. Video likes (log-scaled, capped)
  if (video.like_count > 0) {
    points += Math.min(LIKE_CAP, Math.log10(video.like_count + 1) * 5)
  }

  // 4 + 7. Recency / mild aging penalty
  const ageMs = _ageMs(video.upload_date)
  if (ageMs !== null) {
    const ageDays = ageMs / MS_PER_DAY
    if (ageDays <= 30) points += POINTS.recent30d
    else points += POINTS.older30d
  }

  // 5. View count (log-scaled, capped)
  if (video.view_count > 0) {
    points += Math.min(VIEW_CAP, Math.log10(video.view_count + 1) * 2)
  }

  // 6. Saved manual search (caller passes the flag from the SQL JOIN)
  if (opts.fromSavedSearch) points += POINTS.systemSearch

  // Subscriber count: small bonus to reward popular creators
  // (kept low so it doesn't displace the priority order)
  if (video.subscriber_count > 0) {
    points += Math.min(SUBSCRIBER_COUNT_CAP, Math.log10(video.subscriber_count + 1))
  }

  // 8. Divisive age penalty for videos older than 2 years
  if (ageMs !== null) {
    const ageYears = ageMs / MS_PER_YEAR
    if (ageYears > AGE_PENALTY_MIN_YEARS && points > 0) {
      points = points / ageYears
    }
  }

  return Math.max(0, points)
}

/**
 * Score an array of videos in bulk.
 * @param {Array} videos
 * @param {string} surfaceKey
 * @param {Object} [options] - { excludeDownvoted: true, opts: per-video opts factory }
 * @returns {Array} Sorted by score descending, with `_score` attached
 */
export function scoreVideos(videos, surfaceKey = null, options = {}) {
  const profile = _loadProfile()

  let result = videos
  if (options.excludeDownvoted !== false) {
    result = result.filter(v => !profile.downvotedUrls.has(v.url))
  }

  return result
    .map(v => ({ ...v, _score: scoreVideo(v, surfaceKey, profile, options.optsFor ? options.optsFor(v) : {}) }))
    .sort((a, b) => b._score - a._score)
}

export function isDownvoted(url) {
  return _loadProfile().downvotedUrls.has(url)
}

export function invalidateProfileCache() {
  _profileCache = null
  _profileCacheTime = 0
}

/**
 * Score breakdown for debug overlays. Returns each component separately.
 */
export function getScoreBreakdown(video, surfaceKey = null, opts = {}) {
  const p = _loadProfile()
  const tags = _parseTags(video.tags)

  const subscriberPts = opts.isSubscribed ? POINTS.subscriber : 0
  let likedTagPts = 0
  for (const t of tags) {
    if (typeof t === 'string' && p.likedTagSet.has(t.toLowerCase())) likedTagPts += POINTS.likedTagPerMatch
  }
  const likePts = video.like_count > 0 ? Math.min(LIKE_CAP, Math.log10(video.like_count + 1) * 5) : 0
  const viewPts = video.view_count > 0 ? Math.min(VIEW_CAP, Math.log10(video.view_count + 1) * 2) : 0
  const subCountPts = video.subscriber_count > 0 ? Math.min(SUBSCRIBER_COUNT_CAP, Math.log10(video.subscriber_count + 1)) : 0
  const savedSearchPts = opts.fromSavedSearch ? POINTS.systemSearch : 0

  const ageMs = _ageMs(video.upload_date)
  const ageDays = ageMs !== null ? ageMs / MS_PER_DAY : null
  const ageYears = ageMs !== null ? ageMs / MS_PER_YEAR : null
  const recencyPts = ageDays === null ? 0 : (ageDays <= 30 ? POINTS.recent30d : POINTS.older30d)

  const beforePenalty = subscriberPts + likedTagPts + likePts + recencyPts + viewPts + savedSearchPts + subCountPts
  const ageDivisor = (ageYears !== null && ageYears > AGE_PENALTY_MIN_YEARS && beforePenalty > 0) ? ageYears : 1
  const final = scoreVideo(video, surfaceKey, p, opts)

  return {
    subscriberPts: +subscriberPts.toFixed(2),
    likedTagPts: +likedTagPts.toFixed(2),
    likePts: +likePts.toFixed(2),
    recencyPts: +recencyPts.toFixed(2),
    viewPts: +viewPts.toFixed(2),
    savedSearchPts: +savedSearchPts.toFixed(2),
    subCountPts: +subCountPts.toFixed(2),
    beforePenalty: +beforePenalty.toFixed(2),
    ageDays: ageDays === null ? null : +ageDays.toFixed(1),
    ageYears: ageYears === null ? null : +ageYears.toFixed(2),
    ageDivisor: +ageDivisor.toFixed(2),
    final: +final.toFixed(2),
    isDownvoted: p.downvotedUrls.has(video.url),
    belowMinVisible: final < MIN_VISIBLE_SCORE,
  }
}
