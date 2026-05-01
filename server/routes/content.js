import { Router } from 'express'
import express from 'express'
import { randomBytes } from 'crypto'
import { db } from '../database.js'
import { registry, ytdlp as ytdlpAdapter, scraper as scraperAdapter } from '../sources/index.js'
import { logger } from '../logger.js'
import { getMode, formatDuration } from '../utils.js'
import { scoreVideos } from '../scoring.js'
import { resolveTopics, recordDiscoveredCreators } from '../topics.js'

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
  const mode = getMode(req)

  // NSFW: scraper adapter has no native streaming search, so we await the
  // batched result and emit each video as an SSE event with a setImmediate
  // yield so the client can render progressively.
  if (mode === 'nsfw') {
    // Flush headers immediately as text/event-stream. Without this, a slow
    // (e.g. cold-start Puppeteer) or rejected scraperAdapter.searchAll would
    // let Express finalize the response with default 500/text-plain headers.
    res.write(': searching\n\n')
    if (typeof res.flush === 'function') res.flush()

    let cancelled = false
    req.on('close', () => { cancelled = true })

    const closeWithError = (err) => {
      if (cancelled || res.writableEnded) return
      logger.error('Search error (nsfw):', { error: err?.message || String(err) })
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err?.message || 'Search failed' })}\n\n`)
        res.write('data: [done]\n\n')
      } catch {}
      try { res.end() } catch {}
    }

    ;(async () => {
      try {
        const videos = await scraperAdapter.searchAll(q, { limit })
        for (const v of videos) {
          if (cancelled || res.writableEnded) return
          res.write(`data: ${JSON.stringify({ ...v, durationFormatted: formatDuration(v.duration) })}\n\n`)
          await new Promise(r => setImmediate(r))
        }
        if (!cancelled && !res.writableEnded) {
          res.write('data: [done]\n\n')
          res.end()
        }
      } catch (err) {
        closeWithError(err)
      }
    })().catch(closeWithError)

    return
  }

  // SFW: yt-dlp adapter's streaming search for SSE
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
  const finalLimit = parseInt(limit, 10)
  if (!q) return res.status(400).json({ error: 'Search query required' })

  try {
    // Fan out to every relevant search-capable adapter for the current mode,
    // in parallel, tolerating individual source failures.
    // Each source over-fetches modestly so the reranker has a richer pool.
    const sourceCalls = []
    if (mode === 'nsfw') {
      // All NSFW scraper sites in parallel (each gets a healthy pool of its own)
      sourceCalls.push(
        scraperAdapter.searchAll(q, { limit: Math.max(finalLimit, 10) })
          .then(vs => ({ source: 'scraper', videos: vs }))
          .catch(err => ({ source: 'scraper', videos: [], error: err.message }))
      )
    } else {
      // SFW: yt-dlp YouTube search (only keyword-search-capable SFW adapter today)
      sourceCalls.push(
        registry.search(q, { adapter: 'yt-dlp', limit: finalLimit })
          .then(vs => ({ source: 'yt-dlp', videos: vs }))
          .catch(err => ({ source: 'yt-dlp', videos: [], error: err.message }))
      )
    }

    const settled = await Promise.all(sourceCalls)

    // Merge, dedupe by URL (keep first occurrence)
    const seen = new Set()
    const merged = []
    const errors = []
    for (const r of settled) {
      if (r.error) errors.push(`${r.source}: ${r.error}`)
      for (const v of r.videos) {
        if (!v?.url || seen.has(v.url)) continue
        seen.add(v.url)
        merged.push(v)
      }
    }

    if (merged.length === 0 && errors.length > 0) {
      logger.error('Multi-site search: all sources failed', { errors })
      return res.status(502).json({ error: `All sources failed: ${errors.join('; ')}` })
    }

    // Rerank by taste: liked tags, subscriptions, recency, etc.
    // excludeDownvoted is on by default — never surface downvoted items.
    const ranked = scoreVideos(merged, 'search').slice(0, finalLimit)

    res.json({
      query: q,
      count: ranked.length,
      videos: ranked.map(v => ({
        ...v,
        durationFormatted: formatDuration(v.duration),
      })),
      ...(errors.length > 0 ? { partialErrors: errors } : {}),
    })
  } catch (err) {
    logger.error('Multi-site search error:', { error: err.message })
    res.status(500).json({ error: err.message || 'Multi-site search failed' })
  }
})

// -----------------------------------------------------------
// Search history
// Records every completed search; powers the empty-state fallback
// and feeds future taste-profile signals.
// -----------------------------------------------------------

function normalizeQuery(q) {
  return String(q).trim().toLowerCase().replace(/\s+/g, ' ')
}

router.post('/api/search/history', express.json(), (req, res) => {
  const { query, mode, result_count } = req.body || {}
  if (!query?.trim()) return res.status(400).json({ error: 'query required' })
  const m = mode === 'nsfw' ? 'nsfw' : 'social'
  try {
    const result = db.prepare(
      `INSERT INTO search_history (query, query_normalized, mode, result_count, source)
       VALUES (?, ?, ?, ?, 'manual')`
    ).run(query.trim(), normalizeQuery(query), m, parseInt(result_count, 10) || 0)
    res.json({ id: result.lastInsertRowid })
  } catch (err) {
    logger.error('Search history insert error', { error: err.message })
    res.status(500).json({ error: 'Failed to record search' })
  }
})

router.patch('/api/search/history/:id/click', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
    db.prepare('UPDATE search_history SET clicked_count = clicked_count + 1 WHERE id = ?').run(id)
    res.status(204).end()
  } catch (err) {
    logger.error('Search history click error', { error: err.message })
    res.status(500).json({ error: 'Failed to record click' })
  }
})

router.get('/api/search/history', (req, res) => {
  const mode = getMode(req)
  const limit = Math.min(parseInt(req.query.limit, 10) || 5, 50)
  const hasResults = req.query.has_results === 'true'
  try {
    const sql = hasResults
      ? 'SELECT id, query, mode, result_count, clicked_count, searched_at FROM search_history WHERE mode = ? AND result_count > 0 ORDER BY searched_at DESC LIMIT ?'
      : 'SELECT id, query, mode, result_count, clicked_count, searched_at FROM search_history WHERE mode = ? ORDER BY searched_at DESC LIMIT ?'
    const rows = db.prepare(sql).all(mode, limit)
    res.json({ history: rows })
  } catch (err) {
    logger.error('Search history fetch error', { error: err.message })
    res.json({ history: [] })
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

    // Attach feed_cache entry counts and creator counts for each source
    const feedCounts = db.prepare(`
      SELECT source_domain, COUNT(*) as entry_count
      FROM feed_cache
      WHERE watched = 0 AND (expires_at IS NULL OR expires_at > datetime('now'))
      GROUP BY source_domain
    `).all()
    const feedCountMap = Object.fromEntries(feedCounts.map(r => [r.source_domain, r.entry_count]))

    const creatorCounts = db.prepare(`
      SELECT platform || '.com' as domain, COUNT(*) as creator_count
      FROM creators
      WHERE active = 1
      GROUP BY platform
    `).all()
    const creatorCountMap = Object.fromEntries(creatorCounts.map(r => [r.domain, r.creator_count]))

    const enriched = sources.map(s => ({
      ...s,
      feed_entry_count: feedCountMap[s.domain] ?? 0,
      // Only relevant for __creators__ sources
      creator_count: s.query === '__creators__' ? (creatorCountMap[s.domain] ?? 0) : null,
    }))

    res.json({ sources: enriched })
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
let _homepageCategoriesStmt, _homepageVideosStmt, _homepageVideosFallbackStmt
let _persistentRowsStmt, _persistentItemsStmt
function getHomepageStmts() {
  if (!_homepageCategoriesStmt) {
    _homepageCategoriesStmt = db.prepare(
      'SELECT key, label, query FROM categories WHERE mode = ? ORDER BY sort_order'
    )
    // Primary: fresh AND unviewed. Filtering viewed=0 here is what
    // makes Settings → Shuffle actually hide watched items.
    _homepageVideosStmt = db.prepare(
      `SELECT id, url, title, thumbnail, duration, source, uploader, view_count, like_count, subscriber_count, upload_date, fetched_at, tags, viewed
       FROM homepage_cache
       WHERE category_key = ? AND viewed = 0 AND expires_at > datetime('now')
       ORDER BY fetched_at DESC
       LIMIT 20`
    )
    // Fallback: unviewed but possibly expired. Serves stale entries
    // when warm-cache hasn't run yet or every fresh entry was just
    // marked viewed (e.g. immediately after a shuffle).
    _homepageVideosFallbackStmt = db.prepare(
      `SELECT id, url, title, thumbnail, duration, source, uploader, view_count, like_count, subscriber_count, upload_date, fetched_at, tags, viewed
       FROM homepage_cache
       WHERE category_key = ? AND viewed = 0
       ORDER BY fetched_at DESC
       LIMIT 20`
    )
    _persistentRowsStmt = db.prepare(
      `SELECT key, label FROM persistent_rows
       WHERE mode = ? AND active = 1
       ORDER BY sort_order`
    )
    _persistentItemsStmt = db.prepare(
      `SELECT video_url AS url, title, thumbnail, duration, uploader,
              view_count, like_count, upload_date, tags, liked_at, added_at
       FROM persistent_row_items
       WHERE row_key = ?
       ORDER BY COALESCE(liked_at, added_at) DESC
       LIMIT 30`
    )
  }
  return {
    categories: _homepageCategoriesStmt,
    videos: _homepageVideosStmt,
    videosFallback: _homepageVideosFallbackStmt,
    persistentRows: _persistentRowsStmt,
    persistentItems: _persistentItemsStmt,
  }
}

router.get('/api/homepage', (req, res) => {
  const mode = req.query.mode === 'nsfw' ? 'nsfw' : 'social'

  try {
    const stmts = getHomepageStmts()

    // Persistent rows (sticky shelves like "My PornHub Likes") lead the response.
    // Empty rows are dropped so we don't render placeholder shelves.
    let persistent = []
    try {
      const prRows = stmts.persistentRows.all(mode)
      persistent = prRows
        .map(pr => {
          const rawItems = stmts.persistentItems.all(pr.key)
          if (rawItems.length === 0) return null
          // Apply mode-aware scoring: hard-excludes downvoted, re-sorts by score.
          // For NSFW persistent rows, this surfaces likes-pool / subscribed-models
          // matches even within already-curated lists.
          const items = scoreVideos(rawItems, pr.label, { mode })
          if (items.length === 0) return null
          return {
            key: pr.key,
            label: pr.label,
            pinned: true,
            videos: items.map(v => ({
              id: v.url,
              url: v.url,
              title: v.title,
              thumbnail: v.thumbnail,
              duration: v.duration,
              source: 'pornhub.com',
              uploader: v.uploader,
              view_count: v.view_count,
              like_count: v.like_count,
              subscriber_count: null,
              upload_date: v.upload_date,
              tags: v.tags ? JSON.parse(v.tags) : [],
              durationFormatted: formatDuration(v.duration),
              viewed: 0,
              _score: v._score,
            })),
          }
        })
        .filter(Boolean)
    } catch (err) {
      // Non-fatal: persistent_rows table may not exist on older DBs
      logger.warn(`Homepage: persistent rows lookup failed: ${err.message}`)
    }

    const categories = stmts.categories.all(mode)
    const categoryRows = categories.map(cat => {
      let videos = stmts.videos.all(cat.key)
      if (videos.length === 0) {
        videos = stmts.videosFallback.all(cat.key)
      }

      // Apply mode-aware scoring: hard-excludes downvoted URLs, re-sorts by
      // score so liked-tag matches and boosted creators float to the top
      // and disliked-tag matches sink. Up Next inherits the order via _score.
      // Subscription rows get the +subscriber bonus by definition (every video
      // in this row is from a creator the user actively subscribes to).
      const isSubsRow = cat.key === 'social_subscriptions' || cat.key === 'ph_subs'
      const scored = scoreVideos(videos, cat.label, {
        mode,
        optsFor: isSubsRow ? () => ({ isSubscribed: true }) : undefined,
      })

      return {
        key: cat.key,
        label: cat.label,
        videos: scored.map(v => ({
          ...v,
          tags: v.tags ? (typeof v.tags === 'string' ? JSON.parse(v.tags) : v.tags) : [],
          durationFormatted: formatDuration(v.duration),
        })),
      }
    })

    // Deduplicate: same video URL can land in multiple categories via
    // different search queries. First category (higher sort_order priority) wins.
    // Persistent rows are exempt — they're user-curated and take priority.
    const claimedUrls = new Set()
    for (const row of persistent) {
      for (const v of row.videos) {
        claimedUrls.add(v.url || v.id)
      }
    }
    for (const row of categoryRows) {
      row.videos = row.videos.filter(v => {
        const key = v.url || v.id
        if (claimedUrls.has(key)) return false
        claimedUrls.add(key)
        return true
      })
    }

    const result = [...persistent, ...categoryRows.filter(r => r.videos.length > 0)]

    // Check if any category needs refill (below 8 videos). Persistent rows
    // refill on a different schedule (warm-cache Phase 1.5) and aren't included.
    // A single sessionCache Map is shared across all refills triggered by this
    // request so a topic appearing in multiple rows runs yt-dlp once.
    const needsRefill = categoryRows.some(cat => cat.videos.length < 8)
    if (needsRefill) {
      const sharedCache = new Map()
      for (const cat of categoryRows) {
        if (cat.videos.length < 8) {
          refillCategory(cat.key, sharedCache).catch(err =>
            logger.error('Refill error:', { error: err.message })
          )
        }
      }
    }

    // `state` is the self-describing signal the client uses to decide
    // whether to render skeletons + retry vs. render content. Without
    // this, the client can't distinguish "cache empty, refill running"
    // from "no content exists" — a distinction that turned every cold
    // boot into a "show fake dogs" event.
    const totalVideos = result.reduce((sum, r) => sum + r.videos.length, 0)
    const state = totalVideos === 0 ? 'warming' : 'ready'

    res.json({ categories: result, needsRefill, state })
  } catch (err) {
    logger.error('Homepage error:', { error: err.message })
    res.status(500).json({ error: 'Failed to load homepage' })
  }
})

// -----------------------------------------------------------
// GET /api/homepage/status?mode=social|nsfw
// Per-category hydration counts. fresh_unviewed mirrors what
// GET /api/homepage actually surfaces; the other counts help
// distinguish "nothing cached" from "everything is stale" or
// "everything is marked viewed".
// -----------------------------------------------------------
let _homepageStatusStmt
function getHomepageStatusStmt() {
  if (!_homepageStatusStmt) {
    _homepageStatusStmt = db.prepare(`
      SELECT
        c.key,
        c.label,
        COALESCE(SUM(CASE WHEN hc.viewed = 0 AND hc.expires_at > datetime('now') THEN 1 ELSE 0 END), 0) AS fresh_unviewed,
        COALESCE(SUM(CASE WHEN hc.viewed = 0 THEN 1 ELSE 0 END), 0) AS unviewed_total,
        COUNT(hc.id) AS total
      FROM categories c
      LEFT JOIN homepage_cache hc ON hc.category_key = c.key
      WHERE c.mode = ?
      GROUP BY c.key, c.label
      ORDER BY c.sort_order
    `)
  }
  return _homepageStatusStmt
}

router.get('/api/homepage/status', (req, res) => {
  const mode = req.query.mode === 'nsfw' ? 'nsfw' : 'social'
  try {
    const rows = getHomepageStatusStmt().all(mode)
    res.json({
      mode,
      categories: rows.map(r => ({
        key: r.key,
        label: r.label,
        fresh_unviewed: r.fresh_unviewed,
        unviewed_total: r.unviewed_total,
        total: r.total,
      })),
    })
  } catch (err) {
    logger.error('Homepage status error:', { error: err.message })
    res.status(500).json({ error: 'Failed to load homepage status' })
  }
})

// -----------------------------------------------------------
// POST /api/homepage/viewed
// Marks a homepage_cache video as viewed. Triggers async refill
// if the category drops below the threshold.
// -----------------------------------------------------------
let _markViewedStmt, _getCategoryStmt, _unviewedCountStmt
function getViewedStmts() {
  if (!_markViewedStmt) {
    _markViewedStmt = db.prepare('UPDATE homepage_cache SET viewed = 1 WHERE id = ?')
    _getCategoryStmt = db.prepare('SELECT category_key FROM homepage_cache WHERE id = ?')
    _unviewedCountStmt = db.prepare(
      `SELECT COUNT(*) as n FROM homepage_cache
       WHERE category_key = ? AND viewed = 0 AND expires_at > datetime('now')`
    )
  }
  return { markViewed: _markViewedStmt, getCategory: _getCategoryStmt, unviewedCount: _unviewedCountStmt }
}

router.post('/api/homepage/viewed', (req, res) => {
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'Video ID required' })

  try {
    const stmts = getViewedStmts()
    stmts.markViewed.run(id)

    const video = stmts.getCategory.get(id)
    if (video) {
      const unviewed = stmts.unviewedCount.get(video.category_key)

      if (unviewed.n < 8) {
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
// POST /api/homepage/warm
// Manually trigger a full warm-cache pass (subscription fetchers
// across all sources). Single-flight: returns 429 if a pass is
// already in progress. Runs in-process (externalDb: true) because
// multi-process SQLite writes corrupt the db on Windows.
// -----------------------------------------------------------
let _warmInFlight = false
router.post('/api/homepage/warm', async (req, res) => {
  const mode = req.query.mode === 'nsfw' ? 'nsfw' : req.query.mode === 'social' ? 'social' : 'all'
  // Lazy import to avoid circular dependency at module load time.
  const { getHomepageCooldownStatus, scheduleOneShotWarm } = await import('../index.js')
  if (_warmInFlight) {
    return res.status(429).json({
      error: 'Warm-cache pass already in progress',
      cooldown: getHomepageCooldownStatus(mode),
    })
  }
  _warmInFlight = true
  try {
    const { runWarmCache } = await import('../scripts/warm-cache.js')
    const stats = await runWarmCache({ mode, externalDb: true })
    const cooldown = getHomepageCooldownStatus(mode)
    // If the warm produced nothing and rows are still cooling, schedule a
    // one-shot warm for the soonest cooldown expiry so the user's intent is
    // honored before the next 60s scheduler tick.
    if ((stats.added || 0) === 0 && cooldown.nextEligibleAt) {
      const ms = new Date(cooldown.nextEligibleAt).getTime() - Date.now()
      scheduleOneShotWarm(mode, ms)
    }
    res.json({ ok: true, stats, cooldown })
  } catch (err) {
    logger.error('Manual warm-cache failed:', { error: err.message })
    res.status(500).json({ error: 'Warm-cache failed', detail: err.message })
  } finally {
    _warmInFlight = false
  }
})

// -----------------------------------------------------------
// Async refill: fetch new videos for a category via yt-dlp
// -----------------------------------------------------------
let _refillStmts
function getRefillStmts() {
  if (!_refillStmts) {
    _refillStmts = {
      getCat: db.prepare('SELECT key, label, query, mode, topic_sources, fallback_queries FROM categories WHERE key = ?'),
      countUnviewed: db.prepare('SELECT COUNT(*) as n FROM homepage_cache WHERE category_key = ? AND viewed = 0'),
      purgeViewed: db.prepare('DELETE FROM homepage_cache WHERE category_key = ? AND viewed = 1'),
      insert: db.prepare(`
        INSERT OR IGNORE INTO homepage_cache (id, category_key, url, title, thumbnail, duration, source, uploader, view_count, like_count, subscriber_count, upload_date, tags, fetched_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+7 days'))
      `),
    }
  }
  return _refillStmts
}

function _parseJsonArray(s) {
  if (!s) return []
  try { const r = JSON.parse(s); return Array.isArray(r) ? r : [] } catch { return [] }
}

function _hashId(s) {
  // Deterministic short hash for synthetic IDs when the source video doesn't have one.
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h).toString(36)
}

/**
 * Refill a homepage category using the topic pipeline.
 *
 * sessionCache is an optional Map shared across multiple refillCategory
 * calls in the same warm-cache run. It deduplicates yt-dlp searches when
 * the same topic or creator URL appears in multiple rows' resolved sets.
 */
async function refillCategory(categoryKey, sessionCache = new Map()) {
  const stmts = getRefillStmts()
  const cat = stmts.getCat.get(categoryKey)
  if (!cat) return

  // Purge viewed entries so stable search queries can re-insert the
  // same composite IDs with fresh metadata.
  const { n: unviewed } = stmts.countUnviewed.get(categoryKey)
  if (unviewed < 8) {
    const purged = stmts.purgeViewed.run(categoryKey)
    if (purged.changes > 0) {
      logger.info(`  🧹 Purged ${purged.changes} viewed entries from ${categoryKey}`)
    }
  }

  const sources = _parseJsonArray(cat.topic_sources)
  const fallbacks = _parseJsonArray(cat.fallback_queries)

  // Legacy path: rows without topic_sources keep using the single-query
  // refill until they're migrated. social_subscriptions, social_reddit_unexp,
  // social_reddit_nfl, and any nsfw row still on the old layout fall here.
  if (sources.length === 0) {
    return _refillLegacy(cat, stmts)
  }

  logger.info(`  🔄 Topic-pipeline refill: ${categoryKey} (sources: ${sources.join(', ')})`)

  // -------- Resolve topics + creators + direct videos --------
  let resolved = { topics: [], creators: [], directVideos: [] }
  try {
    resolved = await resolveTopics(sources, { rowKey: categoryKey, mode: cat.mode })
  } catch (err) {
    logger.warn(`  ⚠️ resolveTopics failed for ${categoryKey}`, { error: err.message })
  }

  const collected = [...(resolved.directVideos || [])]

  // -------- Fan-out: topic searches (capped, deduped via sessionCache) --------
  for (const topic of (resolved.topics || []).slice(0, 6)) {
    const cacheKey = `ytsearch5:${topic}`
    if (sessionCache.has(cacheKey)) {
      collected.push(...sessionCache.get(cacheKey))
      continue
    }
    try {
      const r = await registry.search(cacheKey, { adapter: 'yt-dlp', limit: 5 })
      const vids = Array.isArray(r) ? r : (r?.videos || [])
      sessionCache.set(cacheKey, vids)
      collected.push(...vids)
    } catch (err) {
      logger.debug(`topic search failed: ${topic}`, { error: err.message })
    }
  }

  // -------- Fan-out: creator searches --------
  for (const c of (resolved.creators || []).slice(0, 5)) {
    const target = c.channel_url || `https://www.youtube.com/${c.handle}/videos`
    if (sessionCache.has(target)) {
      collected.push(...sessionCache.get(target))
      continue
    }
    try {
      const r = await registry.search(target, { adapter: 'yt-dlp', limit: 2 })
      const vids = Array.isArray(r) ? r : (r?.videos || [])
      sessionCache.set(target, vids)
      collected.push(...vids)
    } catch (err) {
      logger.debug(`creator search failed: ${c.handle}`, { error: err.message })
    }
  }

  // -------- Legacy fallback ytsearches when collected is sparse --------
  if (collected.length < 8 && fallbacks.length > 0) {
    for (const q of fallbacks.slice(0, 3)) {
      if (sessionCache.has(q)) { collected.push(...sessionCache.get(q)); continue }
      try {
        const r = await registry.search(q, { adapter: 'yt-dlp', limit: 5 })
        const vids = Array.isArray(r) ? r : (r?.videos || [])
        sessionCache.set(q, vids)
        collected.push(...vids)
      } catch { /* swallow */ }
    }
  }

  // -------- Discovered-creators fallback (DB-only) --------
  if (collected.length < 5) {
    try {
      const top = db.prepare(
        `SELECT creator, channel_url FROM discovered_creators
         WHERE row_key = ? ORDER BY times_seen DESC, last_seen_at DESC LIMIT 5`
      ).all(categoryKey)
      for (const c of top) {
        const target = c.channel_url ||
          `https://www.youtube.com/results?search_query=${encodeURIComponent(c.creator)}`
        if (sessionCache.has(target)) { collected.push(...sessionCache.get(target)); continue }
        try {
          const r = await registry.search(target, { adapter: 'yt-dlp', limit: 2 })
          const vids = Array.isArray(r) ? r : (r?.videos || [])
          sessionCache.set(target, vids)
          collected.push(...vids)
        } catch { /* swallow */ }
      }
    } catch { /* swallow */ }
  }

  // -------- Dedup, score, persist --------
  const seen = new Set()
  const deduped = collected.filter(v => v?.url && !seen.has(v.url) && (seen.add(v.url), true))

  // Fire-and-forget creator recording — keeps DB writes off the critical path.
  setImmediate(() => recordDiscoveredCreators(categoryKey, deduped, sources))

  const scored = scoreVideos(deduped, cat.label, { mode: cat.mode }).slice(0, 30)

  let added = 0
  for (const v of scored) {
    try {
      const id = v.id || `${categoryKey}_${_hashId(v.url)}`
      const compositeId = id.startsWith(categoryKey) ? id : `${categoryKey}_${id}`
      const result = stmts.insert.run(
        compositeId, categoryKey, v.url, v.title, v.thumbnail, v.duration ?? 0,
        v.source || null, v.uploader || null,
        v.view_count ?? null, v.like_count ?? null, v.subscriber_count ?? null,
        v.upload_date ?? null,
        Array.isArray(v.tags) ? JSON.stringify(v.tags) : (typeof v.tags === 'string' ? v.tags : '[]')
      )
      if (result.changes > 0) added++
    } catch (err) {
      logger.warn(`  ⚠️ Insert failed for ${categoryKey}`, { error: err.message })
    }
  }
  logger.info(`  ✅ Topic-pipeline added ${added} videos to ${categoryKey}`)
}

/**
 * Legacy single-query refill — preserves the prior behaviour for rows
 * that haven't been migrated to topic_sources yet (subscriptions, reddit
 * subreddit URLs, untouched nsfw categories).
 */
async function _refillLegacy(cat, stmts) {
  const query = cat.query
  if (!query) return
  logger.info(`  🔄 Legacy refill: ${cat.key} (query: "${query}")`)
  try {
    let result
    if (cat.mode === 'nsfw' && query.startsWith('http')) {
      try {
        const domain = new URL(query).hostname.replace(/^www\./, '')
        result = await registry.search(query, { site: domain, limit: 12 })
      } catch {
        result = await registry.search(query, { adapter: 'yt-dlp', limit: 12 })
      }
    } else {
      result = await registry.search(query, { adapter: 'yt-dlp', limit: 12 })
    }
    const videos = Array.isArray(result) ? result : (result?.videos || [])

    let added = 0
    for (const v of videos) {
      try {
        const compositeId = `${cat.key}_${v.id}`
        const r = stmts.insert.run(
          compositeId, cat.key, v.url, v.title, v.thumbnail, v.duration,
          v.source, v.uploader, v.view_count, v.like_count ?? null,
          v.subscriber_count ?? null, v.upload_date ?? null, JSON.stringify(v.tags || [])
        )
        if (r.changes > 0) added++
      } catch (err) {
        logger.warn(`  ⚠️ Insert failed for ${v.id} in ${cat.key}:`, { error: err.message })
      }
    }
    logger.info(`  ✅ Legacy added ${added} videos to ${cat.key}`)
  } catch (err) {
    logger.error(`  ❌ Legacy refill failed for ${cat.key}:`, { error: err.message })
  }
}

// Export refillCategory for use by index.js background tasks
export { refillCategory }

export default router
