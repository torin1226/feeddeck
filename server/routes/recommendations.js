import { Router } from 'express'
import express from 'express'
import { db } from '../database.js'
import { getCookieArgs } from '../cookies.js'
import { registry } from '../sources/index.js'
import { logger } from '../logger.js'
import { getMode, inferMode, formatDuration } from '../utils.js'

const router = Router()

// -----------------------------------------------------------
// Tag Preferences (3.2)
// -----------------------------------------------------------

// GET /api/tags/preferences — list all tag preferences
router.get('/api/tags/preferences', (req, res) => {
  try {
    const prefs = db.prepare('SELECT tag, preference FROM tag_preferences ORDER BY tag').all()
    res.json({ preferences: prefs })
  } catch (err) {
    logger.error('Tag preferences fetch error', { error: err.message })
    res.json({ preferences: [] })
  }
})

// PUT /api/tags/preferences — set preference for a tag (liked/disliked)
router.put('/api/tags/preferences', express.json(), (req, res) => {
  const { tag, preference } = req.body || {}
  if (!tag?.trim()) return res.status(400).json({ error: 'tag required' })
  if (!['liked', 'disliked'].includes(preference)) return res.status(400).json({ error: 'preference must be liked or disliked' })
  try {
    db.prepare('INSERT OR REPLACE INTO tag_preferences (tag, preference, updated_at) VALUES (?, ?, datetime(\'now\'))').run(tag.trim().toLowerCase(), preference)
    res.json({ ok: true })
  } catch (err) {
    logger.error('Tag preference set error', { error: err.message })
    res.status(500).json({ error: 'Failed to set preference' })
  }
})

// DELETE /api/tags/preferences/:tag — remove a tag preference
router.delete('/api/tags/preferences/:tag', (req, res) => {
  try {
    db.prepare('DELETE FROM tag_preferences WHERE tag = ?').run(req.params.tag)
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

  send({ type: 'status', message: `Starting ${platform} import for user "${username}"...`, sources: urls.map(u => u.label) })

  // Phase 1: Collect video URLs from all sources via flat-playlist
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const execFileP = promisify(execFile)
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

      const meta = JSON.parse(stdout)
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

export default router
