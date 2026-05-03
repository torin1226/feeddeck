import { db } from './database.js'
import { logger } from './logger.js'

// ============================================================
// Point-Based Scoring Engine — Dynamic, Mode-Aware
//
// Per the multi-search topic pipeline plan (2026-04-30):
//
//   * Two POINTS dicts (SOCIAL_POINTS, NSFW_POINTS). NSFW demotes
//     recency, boosts quality + likes-pool / subscribed-models overlap.
//
//   * tag_preferences is the dynamic signal source: each row carries
//     accumulated `weight` and `last_seen` so newer likes count more.
//     A 90-day half-life decay applies. taste_profile is still read
//     for backward compat (existing rows stay valid).
//
//   * tag_associations table: when the user thumbs-up videos with
//     overlapping tags, the pair count is incremented. Co-occurring
//     tags get a half-credit "associated liked" lift in scoring,
//     so liking three "AI / Claude / coding" videos lifts adjacent
//     content automatically.
//
//   * NSFW extras: subscribedModels (creators in ph_subs) and
//     likesPool (urls + creators in ph_likes) get explicit bonuses.
//
// Profile is cached per-mode for 30s. Engagement events
// (recordEngagement) invalidate the cache.
// ============================================================

const SOCIAL_POINTS = {
  subscriber: 100,
  creatorBoostMultiplier: 60,
  creatorBoostCap: 60,
  likedTagPerMatch: 30,
  associatedTagPerMatch: 12,
  dislikedTagPerMatch: -15,
  recent30d: 20,
  older30d: -5,
  systemSearch: 10,
  likeCap: 25,
  viewCap: 15,
  subscriberCountCap: 5,
  inSubscribedModelsPool: 0,
  inLikesPool: 0,
}

const NSFW_POINTS = {
  subscriber: 60,
  creatorBoostMultiplier: 60,
  creatorBoostCap: 60,
  likedTagPerMatch: 35,
  associatedTagPerMatch: 14,
  dislikedTagPerMatch: -25,
  recent30d: 5,
  older30d: 0,
  systemSearch: 5,
  likeCap: 40,
  viewCap: 30,
  subscriberCountCap: 5,
  inSubscribedModelsPool: 50,
  inLikesPool: 30,
}

function pointsFor(mode) { return mode === 'nsfw' ? NSFW_POINTS : SOCIAL_POINTS }

const AGE_PENALTY_MIN_YEARS = 2
const HALF_LIFE_DAYS = 90               // tag_preferences recency decay
const ASSOC_THRESHOLD = 2               // pair must co-occur >=2 times to count
const ASSOC_TOP_LIKED = 10              // expand top-N liked tags into associations
const ASSOC_PARTNERS_PER_TAG = 3        // top-3 partners per liked tag
const MS_PER_DAY = 86_400_000
const MS_PER_YEAR = 365.25 * MS_PER_DAY

export const MIN_VISIBLE_SCORE = 5

// Profile cache per mode. A thumbs-up calls invalidateProfileCache so the
// very next request sees the fresh signal.
const _profileCache = new Map()
const _profileCacheTime = new Map()
const CACHE_TTL_MS = 30_000

function _loadProfile(mode = 'social') {
  const now = Date.now()
  const cached = _profileCache.get(mode)
  if (cached && (now - (_profileCacheTime.get(mode) || 0)) < CACHE_TTL_MS) {
    return cached
  }

  try {
    // Existing taste_profile signals (backward compat) — these have weight already.
    const tasteSignals = db.prepare(
      'SELECT signal_value, weight FROM taste_profile WHERE signal_type = ? AND (mode IS NULL OR mode = ?)'
    ).all('tag', mode)

    // tag_preferences with recency decay (the dynamic layer).
    const tagPrefs = db.prepare(
      `SELECT tag, preference, COALESCE(weight, 1.0) AS weight,
              COALESCE(last_seen, updated_at) AS last_seen
       FROM tag_preferences
       WHERE mode IS NULL OR mode = ?`
    ).all(mode)

    const likedWeights = new Map()      // tag → effective weight (post-decay)
    const dislikedWeights = new Map()

    // Seed from taste_profile (no decay; legacy data).
    for (const s of tasteSignals) {
      if (!s.signal_value) continue
      const tag = s.signal_value.toLowerCase()
      if (s.weight > 0) likedWeights.set(tag, Math.max(likedWeights.get(tag) || 0, s.weight))
      else if (s.weight < 0) dislikedWeights.set(tag, Math.max(dislikedWeights.get(tag) || 0, Math.abs(s.weight)))
    }

    // Layer tag_preferences with recency decay on top.
    for (const r of tagPrefs) {
      const tag = (r.tag || '').toLowerCase().trim()
      if (!tag) continue
      const ts = r.last_seen ? new Date(r.last_seen).getTime() : now
      const ageDays = Math.max(0, (now - ts) / MS_PER_DAY)
      const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS)
      const eff = (r.weight || 1) * decay
      if (r.preference === 'liked') {
        likedWeights.set(tag, Math.max(likedWeights.get(tag) || 0, eff))
      } else if (r.preference === 'disliked') {
        dislikedWeights.set(tag, Math.max(dislikedWeights.get(tag) || 0, eff))
      }
    }

    // Tag associations: take top-N liked tags, look up co-occurring partners.
    const associatedTagSet = new Set()
    if (likedWeights.size > 0) {
      const topLiked = [...likedWeights.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, ASSOC_TOP_LIKED)
        .map(e => e[0])
      const stmt = db.prepare(
        `SELECT partner, co_occurrences FROM (
           SELECT tag_b AS partner, co_occurrences FROM tag_associations
            WHERE tag_a = ? AND co_occurrences >= ?
           UNION ALL
           SELECT tag_a AS partner, co_occurrences FROM tag_associations
            WHERE tag_b = ? AND co_occurrences >= ?
         )
         ORDER BY co_occurrences DESC LIMIT ?`
      )
      for (const t of topLiked) {
        for (const r of stmt.all(t, ASSOC_THRESHOLD, t, ASSOC_THRESHOLD, ASSOC_PARTNERS_PER_TAG)) {
          if (!likedWeights.has(r.partner) && !dislikedWeights.has(r.partner)) {
            associatedTagSet.add(r.partner)
          }
        }
      }
    }

    // creator_boosts (mode-scoped; legacy NULL rows count for either mode).
    const creatorBoostRows = db.prepare(
      'SELECT creator, boost_score FROM creator_boosts WHERE mode IS NULL OR mode = ?'
    ).all(mode)
    const creatorBoosts = new Map()
    for (const r of creatorBoostRows) {
      if (r.creator && r.boost_score !== 0) creatorBoosts.set(r.creator, r.boost_score)
    }

    // Downvotes are global (not mode-scoped) — once you say no, you mean no.
    const downvotedUrls = new Set(
      db.prepare("SELECT video_url FROM video_ratings WHERE rating = 'down'").all().map(r => r.video_url)
    )

    // Blocked creators: hard filter applied per-mode. action='blocked' only —
    // 'dismissed' rows are review-prompt state, not a scoring signal.
    const blockedCreators = new Set(
      db.prepare(
        "SELECT creator FROM blocked_creators WHERE action = 'blocked' AND mode = ?"
      ).all(mode).map(r => r.creator)
    )

    // NSFW extras — only loaded when needed.
    let subscribedModels = new Set()
    let likesPoolUrls = new Set()
    let likesPoolCreators = new Set()
    if (mode === 'nsfw') {
      try {
        const subRows = db.prepare(
          "SELECT DISTINCT uploader FROM persistent_row_items WHERE row_key = 'ph_subs' AND uploader IS NOT NULL"
        ).all()
        subscribedModels = new Set(subRows.map(r => r.uploader.toLowerCase()))

        const likeRows = db.prepare(
          "SELECT video_url, uploader FROM persistent_row_items WHERE row_key = 'ph_likes'"
        ).all()
        likesPoolUrls = new Set(likeRows.map(r => r.video_url))
        likesPoolCreators = new Set(
          likeRows.filter(r => r.uploader).map(r => r.uploader.toLowerCase())
        )
      } catch (err) {
        logger.warn('NSFW persistent-row pool load failed', { error: err.message })
      }
    }

    const profile = {
      likedTagSet: new Set(likedWeights.keys()),
      likedTagWeights: likedWeights,
      dislikedTagSet: new Set(dislikedWeights.keys()),
      dislikedTagWeights: dislikedWeights,
      associatedTagSet,
      creatorBoosts,
      downvotedUrls,
      blockedCreators,
      subscribedModels,
      likesPoolUrls,
      likesPoolCreators,
    }

    _profileCache.set(mode, profile)
    _profileCacheTime.set(mode, now)
    return profile
  } catch (err) {
    logger.error('Failed to load taste profile', { mode, error: err.message })
    return {
      likedTagSet: new Set(),
      likedTagWeights: new Map(),
      dislikedTagSet: new Set(),
      dislikedTagWeights: new Map(),
      associatedTagSet: new Set(),
      creatorBoosts: new Map(),
      downvotedUrls: new Set(),
      blockedCreators: new Set(),
      subscribedModels: new Set(),
      likesPoolUrls: new Set(),
      likesPoolCreators: new Set(),
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
 * Score a single video with the mode-aware point formula.
 *
 * @param {Object} video - tags, like_count, view_count, subscriber_count,
 *                         upload_date, url, creator/uploader
 * @param {string} surfaceKey - kept for API compatibility
 * @param {Object} [profile] - pre-loaded profile (optional)
 * @param {Object} [opts] - { isSubscribed, fromSavedSearch, mode }
 * @returns {number} Final point score (0 if downvoted, otherwise >= 0)
 */
export function scoreVideo(video, _surfaceKey = null, profile = null, opts = {}) {
  const mode = opts.mode || 'social'
  const P = pointsFor(mode)
  const p = profile || _loadProfile(mode)

  if (p.downvotedUrls.has(video.url)) return 0

  const creator = video.creator || video.uploader
  if (creator && p.blockedCreators.has(creator)) return 0

  let points = 0

  if (opts.isSubscribed) points += P.subscriber

  if (creator && p.creatorBoosts.has(creator)) {
    const raw = p.creatorBoosts.get(creator) * P.creatorBoostMultiplier
    points += Math.max(-P.creatorBoostCap, Math.min(P.creatorBoostCap, raw))
  }

  // Liked-tag scoring is proportional to weight, capped at 2× per tag.
  const tags = _parseTags(video.tags)
  for (const t of tags) {
    if (typeof t !== 'string') continue
    const tl = t.toLowerCase()
    if (p.likedTagWeights.has(tl)) {
      const w = Math.min(2, p.likedTagWeights.get(tl))
      points += P.likedTagPerMatch * w
    } else if (p.associatedTagSet.has(tl)) {
      points += P.associatedTagPerMatch
    } else if (p.dislikedTagWeights.has(tl)) {
      const w = Math.min(2, p.dislikedTagWeights.get(tl))
      points += P.dislikedTagPerMatch * w
    }
  }

  if (video.like_count > 0) {
    points += Math.min(P.likeCap, Math.log10(video.like_count + 1) * 5)
  }

  const ageMs = _ageMs(video.upload_date)
  if (ageMs !== null) {
    const ageDays = ageMs / MS_PER_DAY
    if (ageDays <= 30) points += P.recent30d
    else points += P.older30d
  }

  if (video.view_count > 0) {
    points += Math.min(P.viewCap, Math.log10(video.view_count + 1) * 2)
  }

  if (opts.fromSavedSearch) points += P.systemSearch

  if (video.subscriber_count > 0) {
    points += Math.min(P.subscriberCountCap, Math.log10(video.subscriber_count + 1))
  }

  // NSFW-only post-pass: likes-pool / subscribed-models overlap bonuses.
  if (mode === 'nsfw') {
    const cl = (creator || '').toLowerCase()
    if (cl && p.subscribedModels.has(cl)) points += P.inSubscribedModelsPool
    if (p.likesPoolUrls.has(video.url)) points += P.inLikesPool
    else if (cl && p.likesPoolCreators.has(cl)) points += P.inLikesPool * 0.5
  }

  // Divisive age penalty for videos older than 2 years.
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
 *
 * @param {Array} videos
 * @param {string} surfaceKey
 * @param {Object} [options] - { excludeDownvoted: true, mode: 'social'|'nsfw',
 *                               optsFor: (v)=>perVideoOpts }
 * @returns {Array} Sorted by score descending, with `_score` attached
 */
export function scoreVideos(videos, surfaceKey = null, options = {}) {
  const mode = options.mode || 'social'
  const profile = _loadProfile(mode)

  let result = videos
  if (options.excludeDownvoted !== false) {
    result = result.filter(v => !profile.downvotedUrls.has(v.url))
  }
  // Blocked creators are always filtered (no opt-out) — once you say block, you mean block.
  result = result.filter(v => {
    const c = v.creator || v.uploader
    return !c || !profile.blockedCreators.has(c)
  })

  return result
    .map(v => ({
      ...v,
      _score: scoreVideo(v, surfaceKey, profile, {
        ...(options.optsFor ? options.optsFor(v) : {}),
        mode,
      }),
    }))
    .sort((a, b) => b._score - a._score)
}

/**
 * Convenience: apply taste filter to a list of category-flavoured rows.
 * Used by /api/homepage, /api/feed/next, /api/discover, etc.
 */
export function applyTasteFilter(rows, options = {}) {
  return scoreVideos(rows, options.surfaceKey || null, options)
}

export function isDownvoted(url) {
  // Downvotes are global; reading either profile is fine. Use social as default.
  return _loadProfile('social').downvotedUrls.has(url)
}

export function invalidateProfileCache() {
  _profileCache.clear()
  _profileCacheTime.clear()
}

// Adaptive relevance threshold for the Recommended-For-You tab on the
// watch page. The threshold is the MINIMUM number of liked-tag matches
// a candidate must have to qualify. It scales with how rich the user's
// tag-preference profile is:
//   - <20 liked tags    → threshold 1 (lenient — show breadth)
//   - <50 liked tags    → threshold 2
//   - >=50 liked tags   → threshold 3 (strict — profile is rich enough)
// Mode-scoped: a sparse social profile + rich nsfw profile are independent.
export function getRelevanceThreshold(mode = 'social') {
  try {
    const row = db.prepare(
      `SELECT COUNT(*) AS n FROM tag_preferences
       WHERE preference = 'liked' AND (mode = ? OR mode IS NULL)`
    ).get(mode)
    const liked = row?.n || 0
    if (liked < 20) return 1
    if (liked < 50) return 2
    return 3
  } catch (err) {
    logger.warn('getRelevanceThreshold failed; defaulting to 1', { error: err.message })
    return 1
  }
}

// ============================================================
// Engagement event handler
//
// Called from the ratings route alongside the existing taste_profile
// + creator_boosts updates. This is the dynamic-taste-model write path:
//
//   * tag_preferences: upsert each tag with bumped weight + fresh last_seen.
//     Newer engagements decay slower in scoring.
//
//   * tag_associations: for thumbs-up only, increment co-occurrence
//     for every tag pair in the video. Used by _loadProfile to lift
//     adjacent content via associatedTagSet.
//
//   * Profile cache is invalidated so the next /api/homepage hit
//     reflects the change immediately.
// ============================================================
export function recordEngagement({ rating, tags = [], mode = 'social' }) {
  const norm = (Array.isArray(tags) ? tags : [])
    .map(t => String(t || '').toLowerCase().trim())
    .filter(Boolean)
  const pref = rating === 'up' ? 'liked' : rating === 'down' ? 'disliked' : null
  if (!pref || norm.length === 0) {
    invalidateProfileCache()
    return
  }

  try {
    const upsertPref = db.prepare(
      `INSERT INTO tag_preferences (tag, preference, mode, weight, last_seen, updated_at)
       VALUES (?, ?, ?, 1.0, datetime('now'), datetime('now'))
       ON CONFLICT(tag) DO UPDATE SET
         preference = excluded.preference,
         mode       = excluded.mode,
         weight     = COALESCE(tag_preferences.weight, 1.0) + 1.0,
         last_seen  = datetime('now'),
         updated_at = datetime('now')`
    )
    for (const t of norm) upsertPref.run(t, pref, mode)

    if (rating === 'up' && norm.length >= 2) {
      const upsertAssoc = db.prepare(
        `INSERT INTO tag_associations (tag_a, tag_b, co_occurrences, last_seen)
         VALUES (?, ?, 1, datetime('now'))
         ON CONFLICT(tag_a, tag_b) DO UPDATE SET
           co_occurrences = co_occurrences + 1,
           last_seen      = datetime('now')`
      )
      // Canonical pairs (tag_a < tag_b) keep one row per pair.
      for (let i = 0; i < norm.length; i++) {
        for (let j = i + 1; j < norm.length; j++) {
          if (norm[i] === norm[j]) continue
          const [a, b] = norm[i] < norm[j] ? [norm[i], norm[j]] : [norm[j], norm[i]]
          upsertAssoc.run(a, b)
        }
      }
    }
  } catch (err) {
    logger.error('recordEngagement failed', { error: err.message })
  }
  invalidateProfileCache()
}

/**
 * Score breakdown for debug overlays.
 */
export function getScoreBreakdown(video, surfaceKey = null, opts = {}) {
  const mode = opts.mode || 'social'
  const P = pointsFor(mode)
  const p = _loadProfile(mode)
  const tags = _parseTags(video.tags)

  const subscriberPts = opts.isSubscribed ? P.subscriber : 0
  const creator = video.creator || video.uploader
  const creatorBoostPts = (creator && p.creatorBoosts.has(creator))
    ? Math.min(P.creatorBoostCap, p.creatorBoosts.get(creator) * P.creatorBoostMultiplier)
    : 0

  let likedTagPts = 0
  let associatedTagPts = 0
  let dislikedTagPts = 0
  for (const t of tags) {
    if (typeof t !== 'string') continue
    const tl = t.toLowerCase()
    if (p.likedTagWeights.has(tl)) {
      likedTagPts += P.likedTagPerMatch * Math.min(2, p.likedTagWeights.get(tl))
    } else if (p.associatedTagSet.has(tl)) {
      associatedTagPts += P.associatedTagPerMatch
    } else if (p.dislikedTagWeights.has(tl)) {
      dislikedTagPts += P.dislikedTagPerMatch * Math.min(2, p.dislikedTagWeights.get(tl))
    }
  }

  const likePts = video.like_count > 0 ? Math.min(P.likeCap, Math.log10(video.like_count + 1) * 5) : 0
  const viewPts = video.view_count > 0 ? Math.min(P.viewCap, Math.log10(video.view_count + 1) * 2) : 0
  const subCountPts = video.subscriber_count > 0
    ? Math.min(P.subscriberCountCap, Math.log10(video.subscriber_count + 1)) : 0
  const savedSearchPts = opts.fromSavedSearch ? P.systemSearch : 0

  const ageMs = _ageMs(video.upload_date)
  const ageDays = ageMs !== null ? ageMs / MS_PER_DAY : null
  const ageYears = ageMs !== null ? ageMs / MS_PER_YEAR : null
  const recencyPts = ageDays === null ? 0 : (ageDays <= 30 ? P.recent30d : P.older30d)

  let nsfwPoolPts = 0
  if (mode === 'nsfw') {
    const cl = (creator || '').toLowerCase()
    if (cl && p.subscribedModels.has(cl)) nsfwPoolPts += P.inSubscribedModelsPool
    if (p.likesPoolUrls.has(video.url)) nsfwPoolPts += P.inLikesPool
    else if (cl && p.likesPoolCreators.has(cl)) nsfwPoolPts += P.inLikesPool * 0.5
  }

  const beforePenalty = subscriberPts + creatorBoostPts + likedTagPts + associatedTagPts +
    dislikedTagPts + likePts + recencyPts + viewPts + savedSearchPts + subCountPts + nsfwPoolPts
  const ageDivisor = (ageYears !== null && ageYears > AGE_PENALTY_MIN_YEARS && beforePenalty > 0) ? ageYears : 1
  const final = scoreVideo(video, surfaceKey, p, { ...opts, mode })

  return {
    mode,
    subscriberPts: +subscriberPts.toFixed(2),
    creatorBoostPts: +creatorBoostPts.toFixed(2),
    likedTagPts: +likedTagPts.toFixed(2),
    associatedTagPts: +associatedTagPts.toFixed(2),
    dislikedTagPts: +dislikedTagPts.toFixed(2),
    likePts: +likePts.toFixed(2),
    recencyPts: +recencyPts.toFixed(2),
    viewPts: +viewPts.toFixed(2),
    savedSearchPts: +savedSearchPts.toFixed(2),
    subCountPts: +subCountPts.toFixed(2),
    nsfwPoolPts: +nsfwPoolPts.toFixed(2),
    beforePenalty: +beforePenalty.toFixed(2),
    ageDays: ageDays === null ? null : +ageDays.toFixed(1),
    ageYears: ageYears === null ? null : +ageYears.toFixed(2),
    ageDivisor: +ageDivisor.toFixed(2),
    final: +final.toFixed(2),
    isDownvoted: p.downvotedUrls.has(video.url),
    belowMinVisible: final < MIN_VISIBLE_SCORE,
  }
}
