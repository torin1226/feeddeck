import { db } from './database.js'
import { logger } from './logger.js'

// ============================================================
// Unified Scoring Engine (3.12 Taste Feedback)
//
// Every video gets scored the same way everywhere. Consolidates
// the scattered scoring from feed.js + homeStore.js into one
// server-side function with multi-signal taste profile support.
//
// Formula:
//   base_score * (1 + tag_score) * (1 + creator_score)
//             * (1 + surface_tag_score) * (1 + surface_creator_score)
//   Clamped to max 5x base_score
//
// Decay: 60-day half-life on all taste_profile signals
// ============================================================

const HALF_LIFE_DAYS = 60
const MAX_SCORE_MULTIPLIER = 5.0

// Cache taste profile data to avoid re-querying on every video
let _profileCache = null
let _profileCacheTime = 0
const CACHE_TTL_MS = 30_000 // 30s cache

function _loadProfile() {
  const now = Date.now()
  if (_profileCache && (now - _profileCacheTime) < CACHE_TTL_MS) {
    return _profileCache
  }

  try {
    const signals = db.prepare('SELECT signal_type, signal_value, weight, surface_key, updated_at FROM taste_profile').all()
    const creators = db.prepare('SELECT creator, boost_score, surface_boosts, last_updated FROM creator_boosts').all()
    const downvotedUrls = db.prepare("SELECT video_url FROM video_ratings WHERE rating = 'down'").all()

    // OPTIMIZATION 1: Pre-index signals by type+value for O(1) lookups
    // Instead of scanning all signals per video, build lookup maps
    const globalTagMap = new Map()    // tag -> { weight, updated_at }
    const surfaceTagMap = new Map()   // `${surface}:${tag}` -> { weight, updated_at }
    const globalDomainMap = new Map() // domain -> { weight, updated_at }

    for (const s of signals) {
      const key = s.signal_value.toLowerCase()
      if (s.signal_type === 'tag') {
        if (!s.surface_key) {
          globalTagMap.set(key, s)
        } else {
          surfaceTagMap.set(`${s.surface_key}:${key}`, s)
        }
      } else if (s.signal_type === 'source_domain' && !s.surface_key) {
        globalDomainMap.set(key, s)
      }
    }

    // OPTIMIZATION 2: Pre-index creators by lowercase name for O(1) lookup
    const creatorMap = new Map()
    for (const c of creators) {
      creatorMap.set(c.creator.toLowerCase(), c)
    }

    _profileCache = {
      signals,
      globalTagMap,
      surfaceTagMap,
      globalDomainMap,
      creatorMap,
      downvotedUrls: new Set(downvotedUrls.map(r => r.video_url)),
    }
    _profileCacheTime = now
    return _profileCache
  } catch (err) {
    logger.error('Failed to load taste profile', { error: err.message })
    return {
      signals: [], globalTagMap: new Map(), surfaceTagMap: new Map(),
      globalDomainMap: new Map(), creatorMap: new Map(), downvotedUrls: new Set(),
    }
  }
}

function _applyDecay(weight, updatedAt) {
  if (!updatedAt) return weight
  const daysSince = (Date.now() - new Date(updatedAt).getTime()) / 86_400_000
  if (daysSince <= 0) return weight
  return weight * Math.pow(0.5, daysSince / HALF_LIFE_DAYS)
}

/**
 * Score a single video against the taste profile.
 *
 * @param {Object} video - Must have: tags (array|JSON string), creator/uploader (string), view_count, url
 * @param {string} surfaceKey - The surface context (category key, feed tab name, etc.)
 * @param {Object} [profile] - Pre-loaded profile (optional, will load if not provided)
 * @returns {number} Final score (always >= 0.1)
 */
export function scoreVideo(video, surfaceKey = null, profile = null) {
  const p = profile || _loadProfile()

  // Parse tags
  let videoTags = []
  try {
    videoTags = typeof video.tags === 'string' ? JSON.parse(video.tags || '[]') : (video.tags || [])
  } catch { /* malformed tags */ }

  const creator = (video.creator || video.uploader || '').toLowerCase().trim()

  // Base score: normalize view_count to 0-1 range.
  // feed_cache rows lack view_count, so default to 0.5 (neutral) to let
  // taste signals differentiate rather than all scoring at 0.1 minimum.
  const viewCount = video.view_count || 0
  const baseScore = viewCount > 0
    ? Math.max(0.1, Math.log10(viewCount) / 8) // log-scaled, ~0.1-1.0
    : 0.5 // neutral base when view_count unknown

  // Global tag score — O(tags) via pre-indexed map instead of O(tags * signals)
  let tagScore = 0
  for (const rawTag of videoTags) {
    const t = rawTag.toLowerCase().trim()
    if (!t) continue
    const signal = p.globalTagMap.get(t)
    if (signal) tagScore += _applyDecay(signal.weight, signal.updated_at)
  }

  // Surface-specific tag score — O(tags) via pre-indexed map
  let surfaceTagScore = 0
  if (surfaceKey) {
    for (const rawTag of videoTags) {
      const t = rawTag.toLowerCase().trim()
      if (!t) continue
      const signal = p.surfaceTagMap.get(`${surfaceKey}:${t}`)
      if (signal) surfaceTagScore += _applyDecay(signal.weight, signal.updated_at)
    }
  }

  // Global creator score — O(1) via pre-indexed map
  let creatorScore = 0
  let surfaceCreatorScore = 0
  if (creator) {
    const boost = p.creatorMap.get(creator)
    if (boost) {
      creatorScore = _applyDecay(boost.boost_score, boost.last_updated)
      if (surfaceKey) {
        try {
          const surfaceBoosts = JSON.parse(boost.surface_boosts || '{}')
          if (surfaceBoosts[surfaceKey]) {
            surfaceCreatorScore = _applyDecay(surfaceBoosts[surfaceKey], boost.last_updated)
          }
        } catch { /* malformed JSON */ }
      }
    }
  }

  // Source domain score — O(1) via pre-indexed map
  const sourceDomain = video.source_domain || video.source || ''
  if (sourceDomain) {
    const domainSignal = p.globalDomainMap.get(sourceDomain)
    if (domainSignal) tagScore += _applyDecay(domainSignal.weight, domainSignal.updated_at)
  }

  // Multiplicative combination
  const rawScore = baseScore
    * (1 + tagScore)
    * (1 + creatorScore)
    * (1 + surfaceTagScore)
    * (1 + surfaceCreatorScore)

  // Clamp to max 5x base_score
  const clamped = Math.min(rawScore, baseScore * MAX_SCORE_MULTIPLIER)

  return Math.max(0.1, clamped)
}

/**
 * Score an array of videos in bulk. More efficient than calling scoreVideo per item.
 *
 * @param {Array} videos - Array of video objects
 * @param {string} surfaceKey - Surface context
 * @param {Object} [options] - { excludeDownvoted: true }
 * @returns {Array} Videos with `_score` field added, sorted by score descending
 */
export function scoreVideos(videos, surfaceKey = null, options = {}) {
  const profile = _loadProfile()

  let result = videos
  if (options.excludeDownvoted !== false) {
    result = result.filter(v => !profile.downvotedUrls.has(v.url))
  }

  return result
    .map(v => ({ ...v, _score: scoreVideo(v, surfaceKey, profile) }))
    .sort((a, b) => b._score - a._score)
}

/**
 * Check if a video URL has been downvoted (for exclusion from surfaces).
 */
export function isDownvoted(url) {
  const p = _loadProfile()
  return p.downvotedUrls.has(url)
}

/**
 * Invalidate the profile cache (call after recording a new rating).
 */
export function invalidateProfileCache() {
  _profileCache = null
  _profileCacheTime = 0
}

/**
 * Get a score breakdown for debug overlay (dev mode only).
 */
export function getScoreBreakdown(video, surfaceKey = null) {
  const p = _loadProfile()
  let videoTags = []
  try {
    videoTags = typeof video.tags === 'string' ? JSON.parse(video.tags || '[]') : (video.tags || [])
  } catch {}
  const creator = (video.creator || video.uploader || '').toLowerCase().trim()

  const viewCount = video.view_count || 0
  const baseScore = Math.max(0.1, Math.log10(Math.max(1, viewCount)) / 8)

  let tagScore = 0
  const matchedTags = []
  for (const rawTag of videoTags) {
    const t = rawTag.toLowerCase().trim()
    if (!t) continue
    const signal = p.globalTagMap.get(t)
    if (signal) {
      const decayed = _applyDecay(signal.weight, signal.updated_at)
      tagScore += decayed
      matchedTags.push({ tag: t, weight: +decayed.toFixed(3) })
    }
  }

  let creatorScore = 0
  const boost = creator ? p.creatorMap.get(creator) : null
  if (boost) creatorScore = _applyDecay(boost.boost_score, boost.last_updated)

  const final = scoreVideo(video, surfaceKey, p)

  return {
    baseScore: +baseScore.toFixed(3),
    tagScore: +tagScore.toFixed(3),
    creatorScore: +creatorScore.toFixed(3),
    matchedTags,
    final: +final.toFixed(3),
    isDownvoted: p.downvotedUrls.has(video.url),
  }
}
