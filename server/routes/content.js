import { Router } from 'express'
import express from 'express'
import { randomBytes } from 'crypto'
import { db } from '../database.js'
import { registry, ytdlp as ytdlpAdapter, scraper as scraperAdapter } from '../sources/index.js'
import { logger } from '../logger.js'
import { getMode, formatDuration } from '../utils.js'

const router = Router()

// -----------------------------------------------------------
// Playlist CRUD
// -----------------------------------------------------------

// GET /api/playlists — list all playlists with item counts
router.get('/api/playlists', (req, res) => {
  try {
    const playlists = db.prepare(`
      SELECT p.*, COUNT(pi.id) as item_count
      FROM playlists p LEFT JOIN playlist_items pi ON p.id = pi.playlist_id
      GROUP BY p.id ORDER BY p.updated_at DESC
    `).all()
    res.json({ playlists })
  } catch (err) {
    logger.error('Playlists fetch error', { error: err.message })
    res.json({ playlists: [] })
  }
})

// POST /api/playlists — create playlist
router.post('/api/playlists', express.json(), (req, res) => {
  const { name } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'name required' })
  try {
    const id = randomBytes(16).toString('hex')
    db.prepare('INSERT INTO playlists (id, name) VALUES (?, ?)').run(id, name.trim())
    res.json({ playlist: { id, name: name.trim(), item_count: 0 } })
  } catch (err) {
    logger.error('Playlist create error', { error: err.message })
    res.status(500).json({ error: 'Failed to create playlist' })
  }
})

// DELETE /api/playlists/:id — delete playlist and its items
router.delete('/api/playlists/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(req.params.id)
    db.prepare('DELETE FROM playlists WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    logger.error('Playlist delete error', { error: err.message })
    res.status(500).json({ error: 'Failed to delete playlist' })
  }
})

// GET /api/playlists/:id/items — get playlist items with video details
router.get('/api/playlists/:id/items', (req, res) => {
  try {
    const items = db.prepare(`
      SELECT pi.id as item_id, pi.position, pi.added_at as item_added_at,
             v.id, v.url, v.title, v.thumbnail, v.duration, v.source, v.favorite, v.rating
      FROM playlist_items pi
      JOIN videos v ON pi.video_id = v.id
      WHERE pi.playlist_id = ?
      ORDER BY pi.position ASC
    `).all(req.params.id)
    const videos = items.map(row => ({ ...row, durationFormatted: formatDuration(row.duration) }))
    res.json({ videos })
  } catch (err) {
    logger.error('Playlist items fetch error', { error: err.message })
    res.json({ videos: [] })
  }
})

// POST /api/playlists/:id/items — add video to playlist
router.post('/api/playlists/:id/items', express.json(), (req, res) => {
  const { video_id } = req.body || {}
  if (!video_id) return res.status(400).json({ error: 'video_id required' })
  try {
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) as p FROM playlist_items WHERE playlist_id = ?').get(req.params.id).p
    const itemId = randomBytes(16).toString('hex')
    db.prepare('INSERT INTO playlist_items (id, playlist_id, video_id, position) VALUES (?, ?, ?, ?)').run(itemId, req.params.id, video_id, maxPos + 1)
    db.prepare('UPDATE playlists SET updated_at = datetime(\'now\') WHERE id = ?').run(req.params.id)
    res.json({ ok: true, item_id: itemId })
  } catch (err) {
    logger.error('Playlist add item error', { error: err.message })
    res.status(500).json({ error: 'Failed to add to playlist' })
  }
})

// DELETE /api/playlists/:id/items/:itemId — remove item from playlist
router.delete('/api/playlists/:id/items/:itemId', (req, res) => {
  try {
    db.prepare('DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?').run(req.params.itemId, req.params.id)
    // Reindex positions
    const items = db.prepare('SELECT id FROM playlist_items WHERE playlist_id = ? ORDER BY position').all(req.params.id)
    const update = db.prepare('UPDATE playlist_items SET position = ? WHERE id = ?')
    items.forEach((item, i) => update.run(i, item.id))
    db.prepare('UPDATE playlists SET updated_at = datetime(\'now\') WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    logger.error('Playlist remove item error', { error: err.message })
    res.status(500).json({ error: 'Failed to remove from playlist' })
  }
})

// -----------------------------------------------------------
// GET /api/search?q=...&count=12
// SSE stream — emits one JSON video object per event as yt-dlp
// fetches full metadata for each result. Client gets real
// thumbnails/duration immediately without waiting for all results.
// -----------------------------------------------------------
router.get('/api/search', (req, res) => {
  const { q, count = 12, site } = req.query
  if (!q) return res.status(400).json({ error: 'Search query required' })

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const limit = parseInt(count, 10)

  // Use the yt-dlp adapter's streaming search for SSE
  const stream = ytdlpAdapter.streamSearch(q, { site, limit })

  stream.onVideo((video) => {
    res.write(`data: ${JSON.stringify({ ...video, durationFormatted: formatDuration(video.duration) })}\n\n`)
  })

  stream.onDone(() => {
    res.write('data: [done]\n\n')
    res.end()
  })

  stream.onError((err) => {
    logger.error('Search error:', { error: err.message })
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`)
    res.end()
  })

  // Kill if client disconnects
  req.on('close', () => stream.kill())
})

// -----------------------------------------------------------
// GET /api/search/multi?q=...&limit=10
// Multi-site search — hits all configured scraper sites in
// parallel and returns combined results. Great for NSFW
// discovery where the same query may yield different results
// on different sites.
// -----------------------------------------------------------
router.get('/api/search/multi', async (req, res) => {
  const { q, limit = 10 } = req.query
  const mode = getMode(req)
  if (!q) return res.status(400).json({ error: 'Search query required' })

  try {
    let videos
    if (mode === 'nsfw') {
      // NSFW: hit all scraper sites in parallel
      videos = await scraperAdapter.searchAll(q, { limit: parseInt(limit, 10) })
    } else {
      // Social: use yt-dlp YouTube search (scraper only has NSFW sites)
      videos = await registry.search(q, { site: 'youtube.com', limit: parseInt(limit, 10) })
    }
    res.json({
      query: q,
      count: videos.length,
      videos: videos.map(v => ({
        ...v,
        durationFormatted: formatDuration(v.duration),
      })),
    })
  } catch (err) {
    logger.error('Multi-site search error:', { error: err.message })
    res.status(500).json({ error: 'Multi-site search failed' })
  }
})

// -----------------------------------------------------------
// GET /api/trending?site=pornhub.com&limit=20
// Returns trending videos from a specific site.
// Supported sites: pornhub.com, xvideos.com, spankbang.com
// -----------------------------------------------------------
router.get('/api/trending', async (req, res) => {
  const { site = 'pornhub.com', limit = 20 } = req.query

  try {
    const videos = await scraperAdapter.fetchTrending({
      site,
      limit: parseInt(limit, 10),
    })
    res.json({
      site,
      count: videos.length,
      videos: videos.map(v => ({
        ...v,
        durationFormatted: formatDuration(v.duration),
      })),
    })
  } catch (err) {
    logger.error('Trending fetch error:', { error: err.message })
    res.status(500).json({ error: `Failed to fetch trending for ${site}` })
  }
})

// -----------------------------------------------------------
// GET /api/categories?site=pornhub.com&url=...&limit=20
// Fetches videos from a specific category page URL.
// -----------------------------------------------------------
router.get('/api/categories', async (req, res) => {
  const { url, limit = 20 } = req.query
  if (!url) return res.status(400).json({ error: 'Category URL required' })

  try {
    const videos = await scraperAdapter.fetchCategory(url, {
      limit: parseInt(limit, 10),
    })
    res.json({
      url,
      count: videos.length,
      videos: videos.map(v => ({
        ...v,
        durationFormatted: formatDuration(v.duration),
      })),
    })
  } catch (err) {
    logger.error('Category fetch error:', { error: err.message })
    res.status(500).json({ error: 'Failed to fetch category' })
  }
})

// -----------------------------------------------------------
// GET /api/sources/health
// Reports status of all registered source adapters.
// -----------------------------------------------------------
router.get('/api/sources/health', (req, res) => {
  const stats = registry.getStats()
  const adapters = registry.listAdapters().map(adapter => ({
    name: adapter.name,
    available: typeof adapter.isAvailable === 'function' ? adapter.isAvailable() : true,
    disabled: registry.isDisabled(adapter.name),
    capabilities: adapter.capabilities,
    supportedDomains: adapter.supportedDomains || [],
    version: adapter.version || null,
    stats: stats[adapter.name] || null,
  }))

  const allHealthy = adapters.every(a => a.available && !a.disabled)

  res.json({
    status: allHealthy ? 'healthy' : 'degraded',
    adapters,
  })
})

// -----------------------------------------------------------
// POST /api/sources/:name/reenable
// Manually re-enable a disabled adapter after consecutive failures.
// -----------------------------------------------------------
router.post('/api/sources/:name/reenable', (req, res) => {
  const { name } = req.params
  const success = registry.reenableAdapter(name)
  if (success) {
    res.json({ message: `${name} re-enabled` })
  } else {
    res.status(404).json({ error: `Adapter '${name}' not found` })
  }
})

// -----------------------------------------------------------
// GET /api/sources/list?mode=social|nsfw
// List all feed sources, optionally filtered by mode.
// -----------------------------------------------------------
router.get('/api/sources/list', (req, res) => {
  try {
    const { mode } = req.query
    let sources
    if (mode) {
      sources = db.prepare('SELECT * FROM sources WHERE mode = ? ORDER BY weight DESC').all(mode)
    } else {
      sources = db.prepare('SELECT * FROM sources ORDER BY mode, weight DESC').all()
    }
    res.json({ sources })
  } catch (err) {
    logger.error('List sources error', { error: err.message })
    res.status(500).json({ error: 'Failed to list sources' })
  }
})

// -----------------------------------------------------------
// POST /api/sources
// Add a new feed source. Body: { domain, mode, label, query, weight? }
// Tests the source with yt-dlp before activating.
// -----------------------------------------------------------
router.post('/api/sources', express.json(), async (req, res) => {
  const { domain, mode, label, query, weight = 1.0 } = req.body
  if (!domain || !mode || !label || !query) {
    return res.status(400).json({ error: 'Required: domain, mode, label, query' })
  }
  if (!['social', 'nsfw'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be social or nsfw' })
  }

  // Check if already exists
  const existing = db.prepare('SELECT domain FROM sources WHERE domain = ?').get(domain)
  if (existing) {
    return res.status(409).json({ error: `Source ${domain} already exists` })
  }

  // Test the source with a quick search to verify it works
  try {
    logger.info(`Testing new source: ${domain}`, { query })
    const testResults = await registry.search(query, { site: domain, limit: 3 })
    if (testResults.length === 0) {
      return res.status(422).json({ error: `Source test returned 0 results for "${query}" on ${domain}` })
    }

    // Insert into database
    db.prepare(
      'INSERT INTO sources (domain, mode, label, query, weight, active) VALUES (?, ?, ?, ?, ?, 1)'
    ).run(domain, mode, label, query, weight)

    logger.info(`Added new source: ${label} (${domain})`)
    res.json({
      source: { domain, mode, label, query, weight, active: 1 },
      testResults: testResults.length,
    })
  } catch (err) {
    logger.error('Add source error', { error: err.message, domain })
    res.status(500).json({ error: `Source test failed: ${err.message}` })
  }
})

// -----------------------------------------------------------
// PUT /api/sources/:domain
// Update a source's settings. Body: { label?, query?, weight?, active?, fetch_interval? }
// -----------------------------------------------------------
router.put('/api/sources/:domain', express.json(), (req, res) => {
  const { domain } = req.params
  const existing = db.prepare('SELECT * FROM sources WHERE domain = ?').get(domain)
  if (!existing) {
    return res.status(404).json({ error: `Source ${domain} not found` })
  }

  const { label, query, weight, active, fetch_interval } = req.body
  const updates = []
  const values = []

  if (label !== undefined) { updates.push('label = ?'); values.push(label) }
  if (query !== undefined) { updates.push('query = ?'); values.push(query) }
  if (weight !== undefined) { updates.push('weight = ?'); values.push(weight) }
  if (active !== undefined) { updates.push('active = ?'); values.push(active ? 1 : 0) }
  if (fetch_interval !== undefined) { updates.push('fetch_interval = ?'); values.push(fetch_interval) }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' })
  }

  values.push(domain)
  db.prepare(`UPDATE sources SET ${updates.join(', ')} WHERE domain = ?`).run(...values)

  const updated = db.prepare('SELECT * FROM sources WHERE domain = ?').get(domain)
  res.json({ source: updated })
})

// -----------------------------------------------------------
// DELETE /api/sources/:domain
// Remove a feed source. Also cleans up its feed_cache entries.
// -----------------------------------------------------------
router.delete('/api/sources/:domain', (req, res) => {
  const { domain } = req.params
  const existing = db.prepare('SELECT * FROM sources WHERE domain = ?').get(domain)
  if (!existing) {
    return res.status(404).json({ error: `Source ${domain} not found` })
  }

  db.prepare('DELETE FROM feed_cache WHERE source_domain = ?').run(domain)
  db.prepare('DELETE FROM sources WHERE domain = ?').run(domain)

  logger.info(`Deleted source: ${existing.label} (${domain})`)
  res.json({ deleted: domain })
})

// -----------------------------------------------------------
// GET /api/homepage?mode=social|nsfw
// Returns cached videos grouped by category.
// Falls back to placeholder data if cache is empty.
// -----------------------------------------------------------
router.get('/api/homepage', (req, res) => {
  const mode = req.query.mode === 'nsfw' ? 'nsfw' : 'social'

  try {
    // Get categories for this mode
    const categories = db.prepare(
      'SELECT key, label, query FROM categories WHERE mode = ? ORDER BY sort_order'
    ).all(mode)

    // Get cached videos for each category
    const result = categories.map(cat => {
      const videos = db.prepare(
        `SELECT id, url, title, thumbnail, duration, source, uploader, view_count, tags, viewed
         FROM homepage_cache
         WHERE category_key = ? AND expires_at > datetime('now')
         ORDER BY fetched_at DESC
         LIMIT 20`
      ).all(cat.key)

      return {
        key: cat.key,
        label: cat.label,
        videos: videos.map(v => ({
          ...v,
          tags: v.tags ? JSON.parse(v.tags) : [],
          durationFormatted: formatDuration(v.duration),
        })),
      }
    })

    // Check if any category needs refill (below 8 videos)
    const needsRefill = result.some(cat => cat.videos.length < 8)

    // Trigger async refill for any sparse categories (fire-and-forget)
    if (needsRefill) {
      for (const cat of result) {
        if (cat.videos.length < 8) {
          refillCategory(cat.key).catch(err =>
            logger.error('Refill error:', { error: err.message })
          )
        }
      }
    }

    res.json({ categories: result, needsRefill })
  } catch (err) {
    logger.error('Homepage error:', { error: err.message })
    res.status(500).json({ error: 'Failed to load homepage' })
  }
})

// -----------------------------------------------------------
// POST /api/homepage/viewed
// Marks a homepage_cache video as viewed. Triggers async refill
// if the category drops below the threshold.
// -----------------------------------------------------------
router.post('/api/homepage/viewed', (req, res) => {
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'Video ID required' })

  try {
    db.prepare('UPDATE homepage_cache SET viewed = 1 WHERE id = ?').run(id)

    // Check if the category needs refill
    const video = db.prepare('SELECT category_key FROM homepage_cache WHERE id = ?').get(id)
    if (video) {
      const unviewed = db.prepare(
        `SELECT COUNT(*) as n FROM homepage_cache
         WHERE category_key = ? AND viewed = 0 AND expires_at > datetime('now')`
      ).get(video.category_key)

      if (unviewed.n < 8) {
        // Trigger async refill (fire-and-forget)
        refillCategory(video.category_key).catch(err =>
          logger.error('Refill error:', { error: err.message })
        )
      }
    }

    res.json({ ok: true })
  } catch (err) {
    logger.error('Mark viewed error:', { error: err.message })
    res.status(500).json({ error: 'Failed to mark as viewed' })
  }
})

// -----------------------------------------------------------
// Async refill: fetch new videos for a category via yt-dlp
// -----------------------------------------------------------
async function refillCategory(categoryKey) {
  const cat = db.prepare('SELECT query, mode FROM categories WHERE key = ?').get(categoryKey)
  if (!cat) return

  let query = cat.query

  // For yt-dlp search strings (not URLs), append personalization tags
  if (!query.startsWith('http')) {
    try {
      const likedTags = db.prepare(
        "SELECT tag FROM tag_preferences WHERE preference = 'liked' ORDER BY RANDOM() LIMIT 2"
      ).all().map(r => r.tag)
      if (likedTags.length > 0) {
        query = `${query} ${likedTags.join(' ')}`
        logger.info(`  🎯 Personalized query for ${categoryKey}: "${query}" (tags: ${likedTags.join(', ')})`)
      }
    } catch { /* tag_preferences may not exist yet — use base query */ }
  }

  logger.info(`  🔄 Refilling category: ${categoryKey} (query: "${query}")`)

  try {
    // Use yt-dlp for YouTube/search queries. For NSFW site URLs, use the
    // registry fallback chain (scraper → yt-dlp) since yt-dlp can't always
    // extract from NSFW sites directly.
    let videos
    if (cat.mode === 'nsfw' && query.startsWith('http')) {
      // Extract domain from URL for site-specific routing
      try {
        const domain = new URL(query).hostname.replace(/^www\./, '')
        videos = await registry.search(query, { site: domain, limit: 12 })
      } catch {
        videos = await registry.search(query, { adapter: 'yt-dlp', limit: 12 })
      }
    } else {
      videos = await registry.search(query, { adapter: 'yt-dlp', limit: 12 })
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO homepage_cache (id, category_key, url, title, thumbnail, duration, source, uploader, view_count, tags, fetched_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+7 days'))
    `)

    let added = 0
    for (const v of videos) {
      try {
        insert.run(v.id, categoryKey, v.url, v.title, v.thumbnail, v.duration, v.source, v.uploader, v.view_count, JSON.stringify(v.tags || []))
        added++
      } catch { /* skip duplicates */ }
    }

    logger.info(`  ✅ Added ${added} videos to ${categoryKey}`)
  } catch (err) {
    logger.error(`  ❌ Refill failed for ${categoryKey}:`, { error: err.message })
  }
}

// Export refillCategory for use by index.js background tasks
export { refillCategory }

export default router
