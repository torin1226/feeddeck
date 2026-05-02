// ============================================================
// Recommendation Trail — Search Composer + Runner
//
// Given a "seed" video the user just clicked, fire two yt-dlp
// searches in parallel:
//   1. Same-creator channel pull (12 most recent uploads)
//   2. Keyword search distilled from the seed's title + tags
//
// Results are normalized and returned with provenance so the
// caller can persist them to the recommendation_trail table.
//
// All yt-dlp dependencies are injectable via the constructor so
// tests can substitute mocks without spawning real processes.
// ============================================================

import { logger } from '../logger.js'

// English stopwords + a handful of YouTube-flavored noise words.
// Anything in this set is dropped during keyword distillation.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from',
  'has', 'have', 'he', 'her', 'him', 'his', 'how', 'i', 'in', 'into', 'is',
  'it', 'its', 'just', 'me', 'my', 'no', 'not', 'of', 'on', 'or', 'our',
  'out', 'over', 'part', 'so', 'than', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'to', 'too', 'up', 'us',
  'video', 'videos', 'was', 'we', 'what', 'when', 'where', 'who', 'why',
  'will', 'with', 'would', 'you', 'your', 'youre', 'shorts', 'short',
  'official', 'live', 'new', 'best', 'top', 'watch', 'full', 'episode',
  'ep', 'season', 'feat', 'feat.', 'ft', 'ft.', 'vs', 'vs.', 'episode',
])

// Pull 2-3 distinctive words from a title, biasing towards words that
// appear in the seed's tag list (those are the words YouTube itself
// chose to surface, so they're high-signal).
export function distillKeywords(title, tags = []) {
  if (!title || typeof title !== 'string') return ''
  const tagSet = new Set(
    (Array.isArray(tags) ? tags : [])
      .filter((t) => typeof t === 'string')
      .map((t) => t.toLowerCase().trim())
      .filter(Boolean),
  )

  const words = title
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => w.length >= 3)
    .filter((w) => !STOPWORDS.has(w))
    .filter((w) => !/^\d+$/.test(w))

  if (!words.length) return ''

  // Score each unique word: tag overlap counts double, then length bonus.
  const seen = new Map()
  for (const w of words) {
    if (!seen.has(w)) {
      const tagBonus = tagSet.has(w) ? 5 : 0
      seen.set(w, w.length + tagBonus)
    }
  }
  const ranked = Array.from(seen.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w)
  return ranked.join(' ')
}

// Build a YouTube channel-videos URL from a seed item. Returns null
// when there's nothing actionable (no creator info, non-YouTube source).
export function extractCreatorUrl(seed) {
  if (!seed) return null
  const direct = seed.channel_url || seed.channelUrl || seed.uploader_url
  if (direct && /^https?:\/\//.test(direct)) {
    return direct.endsWith('/videos') ? direct : `${direct.replace(/\/$/, '')}/videos`
  }
  // Synthesize from a YouTube handle if we have one.
  const handle = seed.uploader_id || seed.handle
  if (handle && typeof handle === 'string') {
    const clean = handle.startsWith('@') ? handle : `@${handle}`
    return `https://www.youtube.com/${clean}/videos`
  }
  return null
}

// Normalize a yt-dlp video record to the trail's denormalized shape.
function toTrailRow(v, seedVideoUrl, source, mode, baseScore) {
  const url = v.url || v.webpage_url || v.video_url
  if (!url) return null
  return {
    video_url: url,
    seed_video_url: seedVideoUrl,
    source,
    score: baseScore,
    mode,
    title: v.title || '',
    thumbnail: v.thumbnail || v.thumbnails?.[0]?.url || '',
    duration: Number.isFinite(v.duration) ? Math.floor(v.duration) : 0,
    uploader: v.uploader || v.channel || '',
    tags: Array.isArray(v.tags) ? JSON.stringify(v.tags) : '[]',
  }
}

// ----------------------------------------------------------------
// Runner. Inject the yt-dlp adapter so tests can substitute a mock.
// ----------------------------------------------------------------
export function createTrailRunner({ ytdlpAdapter, options = {} } = {}) {
  if (!ytdlpAdapter) throw new Error('ytdlpAdapter required')
  const perCallLimit = options.perCallLimit || 12
  const creatorScore = options.creatorScore ?? 2.0
  const keywordScore = options.keywordScore ?? 1.0

  // Single-flight: a request keyed by `${mode}:${videoUrl}` is suppressed
  // if it's been started in the last `singleFlightTtlMs` (default 12h).
  const inFlight = new Map() // key -> Promise
  const recent = new Map()   // key -> startedAtMs
  const singleFlightTtlMs = options.singleFlightTtlMs ?? 12 * 60 * 60 * 1000

  // Concurrency cap so the whole server can't fire dozens of yt-dlp at once.
  const maxConcurrent = options.maxConcurrent || 2
  const queue = []
  let active = 0
  function enqueue(fn) {
    return new Promise((resolve, reject) => {
      const run = async () => {
        active++
        try { resolve(await fn()) } catch (err) { reject(err) }
        finally {
          active--
          const next = queue.shift()
          if (next) next()
        }
      }
      if (active < maxConcurrent) run()
      else queue.push(run)
    })
  }

  async function fetchCreator(creatorUrl) {
    if (!creatorUrl) return []
    try {
      return await ytdlpAdapter._fetchPlaylist(creatorUrl, perCallLimit)
    } catch (err) {
      logger.warn('trail: creator fetch failed', { creatorUrl, error: err.message })
      return []
    }
  }

  function fetchKeyword(keyword, mode) {
    if (!keyword) return Promise.resolve([])
    return new Promise((resolve) => {
      const collected = []
      let stream
      try {
        stream = ytdlpAdapter.streamSearch(keyword, { limit: perCallLimit, mode })
      } catch (err) {
        logger.warn('trail: keyword search failed to start', { keyword, error: err.message })
        return resolve([])
      }
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        try { stream.kill?.() } catch { /* ignore */ }
        resolve(collected)
      }
      stream.onVideo?.((v) => collected.push(v))
      stream.onDone?.(finish)
      stream.onError?.((err) => {
        logger.warn('trail: keyword search error', { keyword, error: err?.message || err })
        finish()
      })
      // Hard timeout fallback so a stuck stream doesn't pin the runner.
      // Cold yt-dlp searches against YouTube can take 20-30s when cookies
      // need refreshing, so be generous.
      setTimeout(finish, options.searchTimeoutMs ?? 45_000)
    })
  }

  async function runOnce({ seed, mode }) {
    const seedUrl = seed?.url || seed?.webpage_url
    if (!seedUrl) throw new Error('seed.url required')
    const creatorUrl = extractCreatorUrl(seed)
    const keyword = distillKeywords(seed.title, seed.tags)

    const [creatorRaw, keywordRaw] = await Promise.all([
      enqueue(() => fetchCreator(creatorUrl)),
      enqueue(() => fetchKeyword(keyword, mode)),
    ])

    // Normalize + dedupe (within this single run; persistence layer will
    // also dedupe against existing rows).
    const out = []
    const seen = new Set([seedUrl])
    function consider(arr, source, baseScore) {
      for (const v of arr || []) {
        const row = toTrailRow(v, seedUrl, source, mode, baseScore)
        if (!row) continue
        if (seen.has(row.video_url)) continue
        seen.add(row.video_url)
        out.push(row)
      }
    }
    consider(creatorRaw, 'creator', creatorScore)
    consider(keywordRaw, 'keyword', keywordScore)
    return out
  }

  // Single-flight wrapper.
  function runForSeed({ seed, mode }) {
    const seedUrl = seed?.url || seed?.webpage_url
    if (!seedUrl) return Promise.reject(new Error('seed.url required'))
    const key = `${mode}:${seedUrl}`
    const now = Date.now()

    // Already in flight? Return that promise.
    if (inFlight.has(key)) return inFlight.get(key)

    // Recently completed? Suppress.
    const recentAt = recent.get(key)
    if (recentAt && (now - recentAt) < singleFlightTtlMs) {
      return Promise.resolve({ suppressed: true, rows: [] })
    }

    const p = runOnce({ seed, mode })
      .then((rows) => {
        recent.set(key, Date.now())
        return { suppressed: false, rows }
      })
      .finally(() => {
        inFlight.delete(key)
      })
    inFlight.set(key, p)
    return p
  }

  // Test-only helper to clear single-flight state.
  function _resetState() {
    inFlight.clear()
    recent.clear()
    queue.length = 0
    active = 0
  }

  return { runForSeed, runOnce, _resetState }
}
