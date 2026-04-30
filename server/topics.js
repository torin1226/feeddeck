// ============================================================
// Topic Resolver Registry — Phase 2 of multi-search topic pipeline
//
// Each resolver is a fail-open async function returning:
//   { topics: string[], creators: {handle, channel_url}[], directVideos: object[] }
//
// The pipeline (refillCategory) merges every resolver's output, runs
// per-topic and per-creator yt-dlp searches, scores, dedupes, and
// records uploaders into discovered_creators.
//
// Resolver shorthand:
//   trends24:<section>           — e.g. trends24:music, trends24:news-and-politics
//   liked_tags[:csv]             — empty csv = all liked tags for current mode
//   boosted_creators[:n]         — top N by boost_score (default 5)
//   subscribed_models:<row_key>  — NSFW only (Phase 3)
//   likes_pool                   — NSFW only (Phase 3)
//   eporner_api:<sort>           — NSFW only (Phase 3)
//   cross_site:<intent>          — NSFW only (Phase 3)
//   discovered_creators:<row_key>— fallback layer
// ============================================================

import { db } from './database.js'
import { logger } from './logger.js'

const TRENDS_TTL_MIN_DEFAULT = 360 // 6h

/**
 * trends_cache helpers — reads/writes to the trends_cache table so a
 * cold restart doesn't re-hammer external sources.
 */
function readTrendsCache(sourceKey) {
  try {
    const row = db.prepare(
      `SELECT payload_json, fetched_at, ttl_minutes FROM trends_cache WHERE source_key = ?`
    ).get(sourceKey)
    if (!row) return null
    const fetchedAt = new Date(row.fetched_at).getTime()
    const ageMin = (Date.now() - fetchedAt) / 60_000
    if (ageMin > (row.ttl_minutes || TRENDS_TTL_MIN_DEFAULT)) return null
    return JSON.parse(row.payload_json)
  } catch (err) {
    logger.warn('trends_cache read failed', { sourceKey, error: err.message })
    return null
  }
}

function writeTrendsCache(sourceKey, payload, ttlMinutes = TRENDS_TTL_MIN_DEFAULT) {
  try {
    db.prepare(
      `INSERT INTO trends_cache (source_key, fetched_at, payload_json, ttl_minutes)
       VALUES (?, datetime('now'), ?, ?)
       ON CONFLICT(source_key) DO UPDATE SET
         fetched_at = excluded.fetched_at,
         payload_json = excluded.payload_json,
         ttl_minutes = excluded.ttl_minutes`
    ).run(sourceKey, JSON.stringify(payload), ttlMinutes)
  } catch (err) {
    logger.warn('trends_cache write failed', { sourceKey, error: err.message })
  }
}

// ----------------------------------------------------------------
// Resolver: trends24:<section>
// ----------------------------------------------------------------
async function resolveTrends24(section) {
  const sourceKey = `trends24:${section}`
  const cached = readTrendsCache(sourceKey)
  if (cached) return cached

  try {
    // Lazy import — only loads Puppeteer when actually needed.
    const mod = await import('./sources/trends24.js')
    const result = await mod.fetchSection(`group-${section}`)
    const payload = {
      topics: result.keywords || [],
      creators: (result.creators || []).map(c => ({
        handle: typeof c === 'string' ? c : c.handle,
        channel_url: typeof c === 'string' ? null : c.channel_url,
      })),
      directVideos: result.videos || [],
    }
    writeTrendsCache(sourceKey, payload, 360)
    return payload
  } catch (err) {
    logger.warn('trends24 resolver failed', { section, error: err.message })
    return { topics: [], creators: [], directVideos: [] }
  }
}

// ----------------------------------------------------------------
// Resolver: liked_tags[:csv] — pulls from tag_preferences with
// recency-weighted ordering. Empty csv = all liked tags for the mode.
// ----------------------------------------------------------------
function resolveLikedTags(csv, mode) {
  try {
    const filter = (csv || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    const rows = db.prepare(
      `SELECT tag, COALESCE(weight, 1.0) AS weight,
              COALESCE(last_seen, updated_at) AS last_seen
       FROM tag_preferences
       WHERE preference = 'liked' AND (mode IS NULL OR mode = ?)`
    ).all(mode)
    // Apply recency decay to ordering so newer likes lead (matches scoring.js).
    const now = Date.now()
    const HALF_LIFE_DAYS = 90
    const ranked = rows
      .map(r => {
        const ts = r.last_seen ? new Date(r.last_seen).getTime() : now
        const ageDays = Math.max(0, (now - ts) / 86_400_000)
        const eff = (r.weight || 1) * Math.pow(0.5, ageDays / HALF_LIFE_DAYS)
        return { tag: r.tag, eff }
      })
      .filter(r => filter.length === 0 || filter.includes(r.tag.toLowerCase()))
      .sort((a, b) => b.eff - a.eff)
      .slice(0, 8)
    return { topics: ranked.map(r => r.tag), creators: [], directVideos: [] }
  } catch (err) {
    logger.warn('liked_tags resolver failed', { csv, mode, error: err.message })
    return { topics: [], creators: [], directVideos: [] }
  }
}

// ----------------------------------------------------------------
// Resolver: boosted_creators[:n] — top N from creator_boosts.
// No niche-map filtering; let the scoring layer sort.
// ----------------------------------------------------------------
function resolveBoostedCreators(nStr, mode) {
  try {
    const n = Math.max(1, Math.min(20, parseInt(nStr, 10) || 5))
    const rows = db.prepare(
      `SELECT creator, boost_score FROM creator_boosts
       WHERE boost_score > 0 AND (mode IS NULL OR mode = ?)
       ORDER BY boost_score DESC LIMIT ?`
    ).all(mode, n)
    const creators = rows.map(r => ({ handle: r.creator, channel_url: null }))
    return { topics: [], creators, directVideos: [] }
  } catch (err) {
    logger.warn('boosted_creators resolver failed', { error: err.message })
    return { topics: [], creators: [], directVideos: [] }
  }
}

// ----------------------------------------------------------------
// Resolver: twitter_trends:<region> — Phase 4 trending source.
// Backed by server/sources/twitter-trends.js using the existing
// Twitter cookie + bearer auth from subscription-backup.js.
// 1h trends_cache TTL; cookie failure / rotated API fails open.
// Currently only "us" is implemented; other regions return empty.
// ----------------------------------------------------------------
async function resolveTwitterTrends(region) {
  const reg = (region || 'us').toLowerCase()
  if (reg !== 'us') return { topics: [], creators: [], directVideos: [] }
  const sourceKey = `twitter_trends:${reg}`
  const cached = readTrendsCache(sourceKey)
  if (cached) return cached
  try {
    const mod = await import('./sources/twitter-trends.js')
    const topics = await mod.fetchUsTrends()
    const payload = { topics, creators: [], directVideos: [] }
    writeTrendsCache(sourceKey, payload, 60) // 1h
    return payload
  } catch (err) {
    logger.warn('twitter_trends resolver failed', { region: reg, error: err.message })
    return { topics: [], creators: [], directVideos: [] }
  }
}

// ----------------------------------------------------------------
// Resolver: discovered_creators:<row_key> — fallback layer
// ----------------------------------------------------------------
function resolveDiscoveredCreators(rowKey) {
  try {
    const rows = db.prepare(
      `SELECT creator, channel_url FROM discovered_creators
       WHERE row_key = ? ORDER BY times_seen DESC, last_seen_at DESC LIMIT 5`
    ).all(rowKey)
    const creators = rows.map(r => ({ handle: r.creator, channel_url: r.channel_url || null }))
    return { topics: [], creators, directVideos: [] }
  } catch (err) {
    logger.warn('discovered_creators resolver failed', { rowKey, error: err.message })
    return { topics: [], creators: [], directVideos: [] }
  }
}

// ----------------------------------------------------------------
// resolveTopics — fan-out runner
//
// Sources is an array of strings ("trends24:music", "liked_tags:ai,tech").
// Each is dispatched to the appropriate resolver in parallel.
// Returns merged { topics, creators, directVideos } with dedup on
// canonical keys.
// ----------------------------------------------------------------
export async function resolveTopics(sources, ctx = {}) {
  const mode = ctx.mode || 'social'
  const rowKey = ctx.rowKey || null
  if (!Array.isArray(sources) || sources.length === 0) {
    return { topics: [], creators: [], directVideos: [] }
  }

  const promises = sources.map(async (src) => {
    const colon = src.indexOf(':')
    const kind = colon >= 0 ? src.slice(0, colon) : src
    const arg  = colon >= 0 ? src.slice(colon + 1) : ''
    try {
      switch (kind) {
        case 'trends24':           return await resolveTrends24(arg)
        case 'twitter_trends':     return await resolveTwitterTrends(arg)
        case 'liked_tags':         return resolveLikedTags(arg, mode)
        case 'boosted_creators':   return resolveBoostedCreators(arg, mode)
        case 'discovered_creators':return resolveDiscoveredCreators(arg || rowKey)
        // Phase 3 resolvers; lazy-loaded only when configured on a row.
        case 'subscribed_models': {
          const m = await import('./topics-nsfw.js').catch(() => null)
          return m ? m.resolveSubscribedModels(arg || rowKey) : { topics: [], creators: [], directVideos: [] }
        }
        case 'likes_pool': {
          const m = await import('./topics-nsfw.js').catch(() => null)
          return m ? m.resolveLikesPool() : { topics: [], creators: [], directVideos: [] }
        }
        case 'eporner_api': {
          const m = await import('./topics-nsfw.js').catch(() => null)
          return m ? m.resolveEpornerApi(arg) : { topics: [], creators: [], directVideos: [] }
        }
        case 'cross_site': {
          const m = await import('./topics-nsfw.js').catch(() => null)
          return m ? m.resolveCrossSite(arg) : { topics: [], creators: [], directVideos: [] }
        }
        default:
          logger.warn('unknown topic source', { src })
          return { topics: [], creators: [], directVideos: [] }
      }
    } catch (err) {
      logger.warn('resolver threw', { src, error: err.message })
      return { topics: [], creators: [], directVideos: [] }
    }
  })

  const settled = await Promise.allSettled(promises)
  const merged = { topics: [], creators: [], directVideos: [] }
  const seenTopics = new Set()
  const seenCreators = new Set()
  const seenUrls = new Set()
  for (const r of settled) {
    if (r.status !== 'fulfilled' || !r.value) continue
    for (const t of r.value.topics || []) {
      const k = String(t).toLowerCase().trim()
      if (k && !seenTopics.has(k)) { seenTopics.add(k); merged.topics.push(t) }
    }
    for (const c of r.value.creators || []) {
      const k = (c.handle || '').toLowerCase().trim()
      if (k && !seenCreators.has(k)) { seenCreators.add(k); merged.creators.push(c) }
    }
    for (const v of r.value.directVideos || []) {
      const u = (v.url || '').trim()
      if (u && !seenUrls.has(u)) { seenUrls.add(u); merged.directVideos.push(v) }
    }
  }
  return merged
}

/**
 * recordDiscoveredCreators — upsert each unique uploader into
 * discovered_creators for the row, tagged with the originating source.
 *
 * Called fire-and-forget from refillCategory after dedup.
 */
export function recordDiscoveredCreators(rowKey, videos, sourceKeys = []) {
  if (!rowKey || !Array.isArray(videos) || videos.length === 0) return
  const sourceLabel = sourceKeys[0] || 'search'
  try {
    const upsert = db.prepare(
      `INSERT INTO discovered_creators (creator, platform, row_key, source, channel_url, last_seen_at, times_seen)
       VALUES (?, ?, ?, ?, ?, datetime('now'), 1)
       ON CONFLICT(platform, creator, row_key) DO UPDATE SET
         times_seen = times_seen + 1,
         last_seen_at = datetime('now'),
         channel_url = COALESCE(excluded.channel_url, discovered_creators.channel_url)`
    )
    const seen = new Set()
    for (const v of videos) {
      const creator = (v.uploader || v.creator || '').trim()
      if (!creator || seen.has(creator)) continue
      seen.add(creator)
      const platform = inferPlatform(v.url || v.source || '')
      const channelUrl = v.channel_url || null
      upsert.run(creator, platform, rowKey, sourceLabel, channelUrl)
    }
  } catch (err) {
    logger.warn('recordDiscoveredCreators failed', { rowKey, error: err.message })
  }
}

function inferPlatform(urlOrSource) {
  const s = String(urlOrSource).toLowerCase()
  if (s.includes('youtube')) return 'youtube'
  if (s.includes('reddit')) return 'reddit'
  if (s.includes('tiktok')) return 'tiktok'
  if (s.includes('twitter') || s.includes('x.com')) return 'twitter'
  if (s.includes('pornhub') || s.includes('xvideos') || s.includes('redgifs') ||
      s.includes('spankbang') || s.includes('xhamster') || s.includes('youporn') ||
      s.includes('redtube') || s.includes('fikfap') || s.includes('eporner')) return 'pornhub'
  return 'youtube' // default
}
