import { Router } from 'express'
import express from 'express'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { db } from '../database.js'
import { getCookieArgs } from '../cookies.js'
import { logger } from '../logger.js'
import { getMode, inferMode, formatDuration, safeParse } from '../utils.js'
import { invalidateProfileCache, getRelevanceThreshold } from '../scoring.js'
import { ytdlp as ytdlpAdapter } from '../sources/index.js'
import { createTrailRunner } from '../recommendations/searchSimilar.js'

const execFileP = promisify(execFile)

const router = Router()

// -----------------------------------------------------------
// Tag Preferences (3.2)
// -----------------------------------------------------------

// GET /api/tags/preferences — list tag preferences for the current mode.
// Mode-scoped to prevent NSFW tag preferences from polluting social feed scoring.
router.get('/api/tags/preferences', (req, res) => {
  const mode = getMode(req)
  try {
    // Return rows that match this mode OR are legacy NULL (pre-firewall).
    // Legacy NULL rows apply to both modes for backward compat.
    const prefs = db.prepare(
      'SELECT tag, preference FROM tag_preferences WHERE mode = ? OR mode IS NULL ORDER BY tag'
    ).all(mode)
    res.json({ preferences: prefs })
  } catch (err) {
    logger.error('Tag preferences fetch error', { error: err.message })
    res.json({ preferences: [] })
  }
})

// PUT /api/tags/preferences — set preference for a tag (liked/disliked) in current mode
router.put('/api/tags/preferences', express.json(), (req, res) => {
  const { tag, preference } = req.body || {}
  if (!tag?.trim()) return res.status(400).json({ error: 'tag required' })
  if (!['liked', 'disliked'].includes(preference)) return res.status(400).json({ error: 'preference must be liked or disliked' })
  const mode = getMode(req)
  try {
    const cleanTag = tag.trim().toLowerCase()
    const weight = preference === 'liked' ? 1.0 : -1.0
    // tag_preferences PK is `tag` so we can't have separate (tag, mode) rows
    // without a table rebuild. We update mode in place: a tag's preference is
    // tied to whichever mode set it most recently. The taste_profile table
    // (which actually drives scoring) IS mode-scoped.
    db.prepare(
      `INSERT OR REPLACE INTO tag_preferences (tag, preference, mode, updated_at)
       VALUES (?, ?, ?, datetime('now'))`
    ).run(cleanTag, preference, mode)
    // Keep taste_profile in sync, mode-scoped
    const existing = db.prepare(
      'SELECT id FROM taste_profile WHERE signal_type = ? AND signal_value = ? AND surface_key IS NULL AND mode = ?'
    ).get('tag', cleanTag, mode)
    if (existing) {
      db.prepare('UPDATE taste_profile SET weight = ?, updated_at = datetime(\'now\') WHERE id = ?').run(weight, existing.id)
    } else {
      db.prepare(
        `INSERT INTO taste_profile (signal_type, signal_value, weight, surface_key, mode, updated_at)
         VALUES (?, ?, ?, NULL, ?, datetime('now'))`
      ).run('tag', cleanTag, weight, mode)
    }
    invalidateProfileCache()
    res.json({ ok: true })
  } catch (err) {
    logger.error('Tag preference set error', { error: err.message })
    res.status(500).json({ error: 'Failed to set preference' })
  }
})

// DELETE /api/tags/preferences/:tag — remove a tag preference (mode-scoped)
router.delete('/api/tags/preferences/:tag', (req, res) => {
  const mode = getMode(req)
  try {
    const cleanTag = req.params.tag.toLowerCase()
    // Only delete the row if it belongs to the requesting mode (or is legacy NULL)
    db.prepare('DELETE FROM tag_preferences WHERE tag = ? AND (mode = ? OR mode IS NULL)').run(cleanTag, mode)
    // Remove only this mode's taste_profile row
    db.prepare(
      'DELETE FROM taste_profile WHERE signal_type = ? AND signal_value = ? AND surface_key IS NULL AND mode = ?'
    ).run('tag', cleanTag, mode)
    invalidateProfileCache()
    res.json({ ok: true })
  } catch (err) {
    logger.error('Tag preference delete error', { error: err.message })
    res.status(500).json({ error: 'Failed to delete preference' })
  }
})

// GET /api/tags/popular — list most common tags across all videos
router.get('/api/tags/popular', (req, res) => {
  try {
    const mode = getMode(req)
    const rows = db.prepare('SELECT tags FROM videos WHERE tags IS NOT NULL AND tags != \'[]\' AND mode = ?').all(mode)
    const tagCounts = {}
    for (const row of rows) {
      try {
        const tags = JSON.parse(row.tags)
        for (const tag of tags) {
          const t = tag.toLowerCase().trim()
          if (t) tagCounts[t] = (tagCounts[t] || 0) + 1
        }
      } catch (e) {
        logger.warn('Malformed tags JSON in popular-tags', { tags: row.tags?.slice(0, 100), error: e.message })
      }
    }
    const popular = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([tag, count]) => ({ tag, count }))
    res.json({ tags: popular })
  } catch (err) {
    logger.error('Popular tags error', { error: err.message })
    res.json({ tags: [] })
  }
})

// -----------------------------------------------------------
// Seed Recommendations from History (3.3.1)
// Import watch history/favorites via yt-dlp, extract tags,
// auto-populate tag_preferences for personalization bootstrap.
// Uses SSE for real-time progress reporting.
// -----------------------------------------------------------

// Store PornHub username
router.put('/api/recommendations/username', express.json(), (req, res) => {
  const { platform, username } = req.body || {}
  if (!platform || !username?.trim()) return res.status(400).json({ error: 'platform and username required' })
  try {
    db.prepare("INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)").run(`${platform}_username`, username.trim())
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/api/recommendations/username', (req, res) => {
  try {
    const rows = db.prepare("SELECT key, value FROM preferences WHERE key LIKE '%_username'").all()
    const usernames = {}
    for (const r of rows) usernames[r.key.replace('_username', '')] = r.value
    res.json({ usernames })
  } catch { res.json({ usernames: {} }) }
})

// SSE endpoint: seed recommendations from platform history
router.get('/api/recommendations/seed', async (req, res) => {
  const platform = req.query.platform || 'pornhub'
  const maxVideos = Math.min(parseInt(req.query.max) || 200, 200)

  // SSE headers
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' })
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)

  // Check re-seed guard
  try {
    const lastSeed = db.prepare("SELECT value FROM preferences WHERE key = 'recommendation_seed_at'").get()
    if (lastSeed && !req.query.force) {
      const age = Date.now() - new Date(lastSeed.value).getTime()
      if (age < 24 * 60 * 60 * 1000) {
        send({ type: 'error', message: `Already seeded ${Math.round(age / 3600000)}h ago. Add ?force=1 to re-seed.` })
        return res.end()
      }
    }
  } catch { /* preferences table may not have the key */ }

  // Get username (not required for YouTube which uses cookie-based auth)
  let username
  try {
    const row = db.prepare("SELECT value FROM preferences WHERE key = ?").get(`${platform}_username`)
    username = row?.value
  } catch {}

  // Build URLs to scrape based on platform
  const urls = []
  if (platform === 'pornhub') {
    if (!username) { send({ type: 'error', message: 'PornHub username required. Set it in the field above.' }); return res.end() }
    urls.push(
      { label: 'Favorites', url: `https://www.pornhub.com/users/${username}/videos/favorites` },
      { label: 'Watched', url: `https://www.pornhub.com/users/${username}/videos/watched` },
      { label: 'Rated', url: `https://www.pornhub.com/users/${username}/videos/rated` },
    )
  } else if (platform === 'youtube') {
    // YouTube uses cookie auth, no username needed
    urls.push(
      { label: 'Liked Videos', url: 'https://www.youtube.com/playlist?list=LL' },
      { label: 'Watch History', url: 'https://www.youtube.com/feed/history' },
    )
  } else if (platform === 'tiktok') {
    if (!username) { send({ type: 'error', message: 'TikTok username required. Set it in the field above.' }); return res.end() }
    urls.push(
      { label: 'Liked Videos', url: `https://www.tiktok.com/@${username}/liked` },
    )
  }

  const userLabel = username ? `user "${username}"` : platform
  send({ type: 'status', message: `Starting ${platform} import for ${userLabel}...`, sources: urls.map(u => u.label) })

  // Phase 1: Collect video URLs from all sources via flat-playlist
  const allVideoUrls = []
  for (const src of urls) {
    send({ type: 'progress', phase: 'scan', source: src.label })
    try {
      const { stdout } = await execFileP('yt-dlp', [
        ...getCookieArgs(src.url), '--flat-playlist', '--dump-json', '--no-warnings',
        '--socket-timeout', '10', src.url
      ], { encoding: 'utf8', timeout: 60000, maxBuffer: 10 * 1024 * 1024, windowsHide: true })

      const entries = stdout.trim().split('\n').filter(Boolean)
      for (const line of entries) {
        try {
          const d = JSON.parse(line)
          const url = d.webpage_url || d.url
          if (url) allVideoUrls.push(url)
        } catch {}
      }
      send({ type: 'status', message: `${src.label}: found ${entries.length} videos` })
    } catch (err) {
      send({ type: 'status', message: `${src.label}: ${err.message?.includes('404') || err.message?.includes('Unable') ? 'not accessible (private or empty)' : 'error: ' + err.message?.substring(0, 60)}` })
    }
  }

  if (allVideoUrls.length === 0) {
    send({ type: 'error', message: 'No videos found across all sources. Check that cookies are valid and username is correct.' })
    return res.end()
  }

  // Cap at maxVideos
  const toProcess = allVideoUrls.slice(0, maxVideos)
  send({ type: 'status', message: `Found ${allVideoUrls.length} videos total. Processing ${toProcess.length} for tag extraction...` })

  // Phase 2: Extract full metadata for each video (tags, categories)
  const tagFreq = {}
  const categoryFreq = {}
  let processed = 0
  let failed = 0
  const importedVideos = []

  for (const url of toProcess) {
    processed++
    if (processed % 5 === 0 || processed === toProcess.length) {
      send({ type: 'progress', phase: 'extract', current: processed, total: toProcess.length })
    }
    try {
      const { stdout } = await execFileP('yt-dlp', [
        ...getCookieArgs(url), '--dump-json', '--skip-download', '--no-playlist', '--no-warnings',
        '--socket-timeout', '10', url
      ], { encoding: 'utf8', timeout: 30000, maxBuffer: 5 * 1024 * 1024, windowsHide: true })

      const meta = safeParse(stdout)
      if (!meta) { failed++; continue }
      const tags = meta.tags || []
      const categories = meta.categories || []

      for (const t of tags) {
        const key = t.toLowerCase().trim()
        if (key) tagFreq[key] = (tagFreq[key] || 0) + 1
      }
      for (const c of categories) {
        const key = c.toLowerCase().trim()
        if (key) categoryFreq[key] = (categoryFreq[key] || 0) + 1
      }

      // Import video into library
      importedVideos.push({
        url: meta.webpage_url || url,
        title: meta.title,
        thumbnail: meta.thumbnail,
        duration: meta.duration,
        source: meta.webpage_url_domain || platform,
        uploader: meta.uploader,
        view_count: meta.view_count,
        tags: [...tags, ...categories],
      })
    } catch {
      failed++
    }
  }

  send({ type: 'status', message: `Extracted tags from ${processed - failed}/${processed} videos (${failed} failed)` })

  // Phase 3: Auto-insert top tags into tag_preferences
  const existingPrefs = new Set()
  try {
    db.prepare('SELECT tag FROM tag_preferences').all().forEach(r => existingPrefs.add(r.tag))
  } catch {}

  // Tags that appear in 2+ videos (lower threshold since we might have few videos)
  const threshold = Math.max(2, Math.floor(toProcess.length * 0.1))
  const topTags = Object.entries(tagFreq)
    .filter(([, count]) => count >= Math.min(threshold, 2))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .filter(([tag]) => !existingPrefs.has(tag))

  const topCategories = Object.entries(categoryFreq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .filter(([tag]) => !existingPrefs.has(tag))

  const allNewTags = [...topTags, ...topCategories]
  let addedTags = 0
  const insertPref = db.prepare("INSERT OR IGNORE INTO tag_preferences (tag, preference, updated_at) VALUES (?, 'liked', datetime('now'))")
  for (const [tag] of allNewTags) {
    try {
      const result = insertPref.run(tag)
      if (result.changes > 0) addedTags++
    } catch {}
  }

  // Phase 4: Import videos into library (videos table)
  let addedVideos = 0
  const insertVideo = db.prepare(`
    INSERT OR IGNORE INTO videos (url, title, thumbnail, duration, source, tags, mode, added_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `)
  for (const v of importedVideos) {
    try {
      const result = insertVideo.run(v.url, v.title, v.thumbnail, v.duration, v.source, JSON.stringify(v.tags), inferMode(v.url || v.source))
      if (result.changes > 0) addedVideos++
    } catch {}
  }

  // Store seed metadata
  try {
    db.prepare("INSERT OR REPLACE INTO preferences (key, value) VALUES ('recommendation_seed_at', datetime('now'))").run()
    db.prepare("INSERT OR REPLACE INTO preferences (key, value) VALUES ('recommendation_seed_count', ?)").run(String(processed - failed))
  } catch {}

  const summary = {
    type: 'complete',
    videosScanned: processed,
    videosFailed: failed,
    videosImported: addedVideos,
    tagsFound: Object.keys(tagFreq).length,
    categoriesFound: Object.keys(categoryFreq).length,
    tagsAdded: addedTags,
    topTags: allNewTags.slice(0, 10).map(([tag, count]) => ({ tag, count })),
  }
  send(summary)
  res.end()
})

// -----------------------------------------------------------
// Basic Recommendations (3.3)
// Rule-based scoring: +2 liked tag, -5 disliked tag, +1 preferred source
// -----------------------------------------------------------

router.get('/api/discover', (req, res) => {
  const { limit = 20 } = req.query
  const mode = getMode(req)
  try {
    // Get tag preferences
    const prefs = db.prepare('SELECT tag, preference FROM tag_preferences').all()
    const liked = new Set(prefs.filter(p => p.preference === 'liked').map(p => p.tag))
    const disliked = new Set(prefs.filter(p => p.preference === 'disliked').map(p => p.tag))

    // Get all unwatched videos (filtered by mode)
    const videos = db.prepare('SELECT * FROM videos WHERE (watch_count = 0 OR watch_count IS NULL) AND mode = ? ORDER BY added_at DESC').all(mode)

    // Score each video
    const scored = videos.map(v => {
      let score = 0
      try {
        const tags = JSON.parse(v.tags || '[]')
        for (const tag of tags) {
          const t = tag.toLowerCase().trim()
          if (liked.has(t)) score += 2
          if (disliked.has(t)) score -= 5
        }
      } catch {}
      // Bonus for favorited
      if (v.favorite) score += 1
      // Bonus for highly rated
      if (v.rating >= 4) score += 1
      return { ...v, score, tags: v.tags ? JSON.parse(v.tags) : [], durationFormatted: formatDuration(v.duration) }
    })

    // Sort by score descending, then by added_at
    scored.sort((a, b) => b.score - a.score)

    res.json({ videos: scored.slice(0, parseInt(limit)) })
  } catch (err) {
    logger.error('Discover error', { error: err.message })
    res.json({ videos: [] })
  }
})

// ============================================================
// Recommendation Trail (per Recommendation Trail design)
// Persistent pool of videos pulled because the user watched X.
// Surfaces in: watch-page rail, homepage carousel, feed top.
// ============================================================

// Lazy-init shared runner so unit tests can construct their own.
let _trailRunner = null
function getTrailRunner() {
  if (!_trailRunner) {
    _trailRunner = createTrailRunner({ ytdlpAdapter })
  }
  return _trailRunner
}

// TTL: 14 days from created_at, OR watched.
const TRAIL_TTL_DAYS = 14
const TRAIL_HARD_CAP = 500
const TRAIL_DEMOTE_FACTOR = 0.3

function evictTrailExpired(mode) {
  try {
    // Remove watched OR aged-out rows.
    const purged = db.prepare(
      `DELETE FROM recommendation_trail
       WHERE mode = ?
         AND (watched_at IS NOT NULL
              OR datetime(created_at) < datetime('now', ?))`
    ).run(mode, `-${TRAIL_TTL_DAYS} days`)
    if (purged.changes > 0) {
      logger.info('trail: evicted rows', { mode, count: purged.changes })
    }
    // Enforce hard cap (FIFO oldest first).
    const total = db.prepare(
      'SELECT COUNT(*) AS n FROM recommendation_trail WHERE mode = ?'
    ).get(mode)?.n || 0
    if (total > TRAIL_HARD_CAP) {
      const overflow = total - TRAIL_HARD_CAP
      db.prepare(
        `DELETE FROM recommendation_trail
         WHERE id IN (
           SELECT id FROM recommendation_trail
           WHERE mode = ?
           ORDER BY created_at ASC
           LIMIT ?
         )`
      ).run(mode, overflow)
    }
  } catch (err) {
    logger.error('trail eviction failed', { error: err.message, mode })
  }
}

function persistTrailRows(rows) {
  if (!rows || !rows.length) return 0
  const insert = db.prepare(
    `INSERT INTO recommendation_trail
       (video_url, seed_video_url, source, score, mode,
        title, thumbnail, duration, uploader, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(mode, video_url) DO UPDATE SET
       score = MAX(recommendation_trail.score, excluded.score),
       seed_video_url = excluded.seed_video_url`
  )
  let inserted = 0
  let committed = false
  try {
    db.exec('BEGIN')
    for (const r of rows) {
      try {
        insert.run(
          r.video_url, r.seed_video_url, r.source, r.score, r.mode,
          r.title || '', r.thumbnail || '', r.duration || 0,
          r.uploader || '', r.tags || '[]'
        )
        inserted++
      } catch (err) {
        logger.warn('trail row insert failed', { error: err.message, url: r.video_url })
      }
    }
    db.exec('COMMIT')
    committed = true
  } finally {
    if (!committed) {
      try { db.exec('ROLLBACK') } catch { /* ignore */ }
    }
  }
  return inserted
}

// POST /api/recommendations/trail/seed
// Body: { videoUrl, title, tags, uploader, channelUrl }
router.post('/api/recommendations/trail/seed', express.json(), async (req, res) => {
  const { videoUrl, title, tags, uploader, channelUrl } = req.body || {}
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl required' })
  const mode = getMode(req)

  // Respond immediately with 202; the search runs in the background.
  res.status(202).json({ ok: true, queued: true })

  try {
    const runner = getTrailRunner()
    const result = await runner.runForSeed({
      seed: { url: videoUrl, title, tags, uploader, channel_url: channelUrl },
      mode,
    })
    if (result.suppressed) {
      logger.debug('trail: seed suppressed (single-flight cache hit)', { videoUrl, mode })
      return
    }
    const inserted = persistTrailRows(result.rows)
    logger.info('trail: seed run complete', {
      videoUrl: videoUrl.slice(0, 80),
      mode,
      pulled: result.rows.length,
      inserted,
    })
  } catch (err) {
    logger.warn('trail: seed run failed', { error: err.message, videoUrl: videoUrl?.slice(0, 80) })
  }
})

// GET /api/recommendations/trail?seedVideoUrl=...&limit=24
// Returns the ranked pool for the current mode. Optionally filter to
// rows pulled by a specific seed (for the watch-page rail).
router.get('/api/recommendations/trail', (req, res) => {
  const mode = getMode(req)
  const limit = Math.min(parseInt(req.query.limit, 10) || 24, 100)
  const seedVideoUrl = req.query.seedVideoUrl || null

  try {
    evictTrailExpired(mode)

    let rows
    if (seedVideoUrl) {
      rows = db.prepare(
        `SELECT * FROM recommendation_trail
         WHERE mode = ? AND seed_video_url = ? AND watched_at IS NULL
         ORDER BY score DESC, created_at DESC
         LIMIT ?`
      ).all(mode, seedVideoUrl, limit)
    } else {
      rows = db.prepare(
        `SELECT * FROM recommendation_trail
         WHERE mode = ? AND watched_at IS NULL
         ORDER BY score DESC, created_at DESC
         LIMIT ?`
      ).all(mode, limit)
    }

    const items = rows.map((r) => ({
      id: `trail-${r.id}`,
      url: r.video_url,
      seedVideoUrl: r.seed_video_url,
      source: r.source,
      score: r.score,
      title: r.title,
      thumbnail: r.thumbnail,
      duration: r.duration,
      durationFormatted: formatDuration(r.duration),
      uploader: r.uploader,
      tags: safeParse(r.tags) || [],
      createdAt: r.created_at,
    }))

    res.json({ items, count: items.length })
  } catch (err) {
    logger.error('trail GET failed', { error: err.message })
    res.json({ items: [], count: 0 })
  }
})

// POST /api/recommendations/trail/demote
// Body: { seedVideoUrl }
// Multiplies score by TRAIL_DEMOTE_FACTOR for entries pulled by the
// given seed. Called from the ratings endpoint when a watch-page
// thumbs-down lands.
router.post('/api/recommendations/trail/demote', express.json(), (req, res) => {
  const { seedVideoUrl } = req.body || {}
  if (!seedVideoUrl) return res.status(400).json({ error: 'seedVideoUrl required' })
  const mode = getMode(req)
  try {
    const result = db.prepare(
      `UPDATE recommendation_trail
       SET score = score * ?
       WHERE mode = ? AND seed_video_url = ?`
    ).run(TRAIL_DEMOTE_FACTOR, mode, seedVideoUrl)
    res.json({ ok: true, demoted: result.changes })
  } catch (err) {
    logger.error('trail demote failed', { error: err.message })
    res.status(500).json({ error: 'Failed to demote trail entries' })
  }
})

// GET /api/recommendations/trail/threshold
// Returns the current adaptive relevance threshold for the active mode.
router.get('/api/recommendations/trail/threshold', (req, res) => {
  const mode = getMode(req)
  try {
    res.json({ threshold: getRelevanceThreshold(mode) })
  } catch (err) {
    res.json({ threshold: 1 })
  }
})

// Test-only helpers (exported via the module, not routed). Kept here so
// the test suite can reset state between runs without re-creating runners.
export const _trail = {
  evictExpired: evictTrailExpired,
  persistRows: persistTrailRows,
  getRunner: getTrailRunner,
  // Allow tests to substitute a deterministic runner.
  setRunner: (r) => { _trailRunner = r },
  TTL_DAYS: TRAIL_TTL_DAYS,
  HARD_CAP: TRAIL_HARD_CAP,
  DEMOTE_FACTOR: TRAIL_DEMOTE_FACTOR,
}

export default router
