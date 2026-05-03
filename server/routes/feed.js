import { Router } from 'express'
import express from 'express'
import { db } from '../database.js'
import { logger } from '../logger.js'
import { formatDuration, inferMode, getMode } from '../utils.js'
import { scoreVideos, MIN_VISIBLE_SCORE } from '../scoring.js'

const router = Router()

let _feedUnwatchedCountStmt
function getFeedUnwatchedCountStmt() {
  if (!_feedUnwatchedCountStmt) {
    _feedUnwatchedCountStmt = db.prepare(
      'SELECT COUNT(*) as n FROM feed_cache WHERE mode = ? AND watched = 0'
    )
  }
  return _feedUnwatchedCountStmt
}

let _stmts
function getStmts() {
  if (!_stmts) {
    _stmts = {
      markWatched: db.prepare('UPDATE feed_cache SET watched = 1 WHERE id = ?'),
      hideSource: db.prepare('UPDATE sources SET active = 0 WHERE domain = ?'),
      boostSource: db.prepare('UPDATE sources SET weight = MIN(weight + 0.3, 3.0) WHERE domain = ?'),
      // Queue queries are always mode-scoped: a queue entry's mode is fixed
      // at insert time via inferMode(video_url). Cross-mode queue items
      // are invisible to the opposite mode.
      getQueueByMode: db.prepare(
        `SELECT id, position, video_url, title, thumbnail, duration, duration_formatted, added_at, mode
         FROM queue WHERE mode = ? OR (mode IS NULL AND video_url IS NOT NULL)
         ORDER BY position ASC`
      ),
      getQueueIdsByMode: db.prepare('SELECT id FROM queue WHERE mode = ? ORDER BY position ASC'),
      updateQueuePos: db.prepare('UPDATE queue SET position = ? WHERE id = ?'),
      maxQueuePosByMode: db.prepare('SELECT COALESCE(MAX(position), -1) as maxPos FROM queue WHERE mode = ?'),
      shiftQueueByMode: db.prepare('UPDATE queue SET position = position + 1 WHERE position >= ? AND mode = ?'),
      insertQueue: db.prepare(
        `INSERT INTO queue (id, position, video_url, title, thumbnail, duration, duration_formatted, mode)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?)`
      ),
      deleteQueueItem: db.prepare('DELETE FROM queue WHERE id = ?'),
      clearQueueByMode: db.prepare('DELETE FROM queue WHERE mode = ?'),
      // Set mode on legacy NULL-mode rows lazily on first read
      backfillQueueMode: db.prepare('UPDATE queue SET mode = ? WHERE id = ?'),
    }
  }
  return _stmts
}

// -----------------------------------------------------------
// GET /api/feed/next?mode=social|nsfw&count=10
// Return next unwatched videos from feed cache, weighted by
// source preferences. Triggers async refill if cache is low.
// -----------------------------------------------------------
router.get('/api/feed/next', (req, res) => {
  const mode = req.query.mode === 'nsfw' ? 'nsfw' : 'social'
  const count = Math.min(parseInt(req.query.count, 10) || 10, 30)

  // Optional filters
  const sourcesParam = req.query.sources // comma-separated domains
  const tagsParam = req.query.tags // comma-separated tags

  try {
    // Build dynamic WHERE clause based on filters
    let whereExtra = ''
    const params = [mode]

    if (sourcesParam) {
      const domains = sourcesParam.split(',').map(s => s.trim()).filter(Boolean)
      if (domains.length > 0) {
        whereExtra += ` AND fc.source_domain IN (${domains.map(() => '?').join(',')})`
        params.push(...domains)
      }
    }

    // Pull the full unwatched pool (capped) and score every row, so the top-N
    // by taste score reflects the actual cache contents -- not a random window
    // of it. Cap at 500 so a runaway cache can't blow up memory; prefer the
    // freshest rows when over the cap.
    // The SQL exposes:
    //   - is_subscribed: row's creator is in subscription_backups
    //   - from_saved_search: source's query matches a system_searches entry
    // These flags feed scoreVideos() so the additive points stack correctly.
    const CANDIDATE_CAP = 500
    const perSourceLimit = Math.max(2, Math.ceil(count / 5))
    const rawUnwatched = db.prepare(`
      SELECT fc.id, fc.url, fc.stream_url AS streamUrl, fc.title, fc.creator AS uploader, fc.thumbnail,
             fc.duration, fc.orientation, fc.source_domain AS source, fc.tags,
             fc.upload_date, fc.like_count, fc.view_count, fc.subscriber_count,
             CASE WHEN sb.id IS NOT NULL THEN 1 ELSE 0 END AS is_subscribed,
             CASE WHEN ss.id IS NOT NULL THEN 1 ELSE 0 END AS from_saved_search
      FROM feed_cache fc
      LEFT JOIN sources s ON fc.source_domain = s.domain
      LEFT JOIN subscription_backups sb ON fc.creator IS NOT NULL
        AND (sb.handle = fc.creator OR sb.display_name = fc.creator)
      LEFT JOIN system_searches ss ON s.query IS NOT NULL AND ss.query = s.query AND ss.active = 1
      WHERE fc.mode = ? AND fc.watched = 0${whereExtra}
      ORDER BY fc.fetched_at DESC
      LIMIT ${CANDIDATE_CAP}
    `).all(...params)

    // scoreVideos() loads the taste profile once, filters downvoted/blocked,
    // attaches _score, and sorts DESC. Carry the per-row SQL flags through.
    const allUnwatched = scoreVideos(rawUnwatched, 'feed', {
      mode,
      optsFor: v => ({
        isSubscribed: !!v.is_subscribed,
        fromSavedSearch: !!v.from_saved_search,
      }),
    })

    // Drop low-quality content (per user spec: "don't show low scores, that is bad content").
    // Only filter when we have temporal or quality metadata to judge by.
    // view_count alone is not enough -- scraper content always has view_count but no
    // upload_date or like_count, so we can't tell if low views means "bad" or "just new".
    // Without upload_date we can't contextualize view count, so treat as unknown quality.
    const visible = allUnwatched.filter(v => {
      const hasData = v.upload_date != null || v.like_count != null
      if (hasData && v._score < MIN_VISIBLE_SCORE) return false
      return true
    })

    // Round-robin first pass for source diversity, then fill by score DESC.
    const bySource = {}
    for (const v of visible) {
      if (!bySource[v.source]) bySource[v.source] = []
      bySource[v.source].push(v)
    }
    // Within each source, prefer highest-scored first
    for (const arr of Object.values(bySource)) arr.sort((a, b) => b._score - a._score)

    const videos = []
    const used = new Set()
    for (const vids of Object.values(bySource)) {
      for (const v of vids.slice(0, perSourceLimit)) {
        if (videos.length >= count) break
        videos.push(v)
        used.add(v.id)
      }
    }
    if (videos.length < count) {
      const remaining = visible.filter(v => !used.has(v.id)).sort((a, b) => b._score - a._score)
      for (const v of remaining) {
        if (videos.length >= count) break
        videos.push(v)
      }
    }
    // Final order: by score DESC so highest priority surfaces first
    videos.sort((a, b) => b._score - a._score)

    // Apply tag filter (tags stored as JSON array in feed_cache)
    // Also matches against title as fallback for videos without tags
    let filtered = videos
    if (tagsParam) {
      const filterTags = tagsParam.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
      if (filterTags.length > 0) {
        filtered = videos.filter(v => {
          try {
            const videoTags = JSON.parse(v.tags || '[]').map(t => t.toLowerCase())
            const titleLower = (v.title || '').toLowerCase()
            return filterTags.some(ft => videoTags.includes(ft) || titleLower.includes(ft))
          } catch (e) {
            logger.warn('Malformed tags JSON in feed filter', { url: v.url, tags: v.tags?.slice(0, 100), error: e.message })
            return false
          }
        })
      }
    }

    // Format for client (hls.js handles HLS URLs on non-Safari browsers)
    const formatted = filtered.map(v => ({
      ...v,
      tags: undefined, // Don't send raw tags JSON to client
      is_subscribed: undefined,
      from_saved_search: undefined,
      _score: undefined,
      durationFormatted: formatDuration(v.duration),
    }))

    const unviewedCount = getFeedUnwatchedCountStmt().get(mode)

    if (unviewedCount.n < 20) {
      // Import refillFeedCache lazily to avoid circular dependency
      // The function is set by index.js at startup
      if (_refillFeedCache) {
        _refillFeedCache(mode).catch(err =>
          logger.error('Feed refill error:', { error: err.message })
        )
      }
    }

    res.json({ videos: formatted })
  } catch (err) {
    logger.error('Feed next error:', { error: err.message })
    res.status(500).json({ error: 'Failed to load feed', videos: [] })
  }
})

// -----------------------------------------------------------
// POST /api/feed/watched?id=...
// Mark a feed video as watched
// -----------------------------------------------------------
router.post('/api/feed/watched', (req, res) => {
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'Video ID required' })

  try {
    getStmts().markWatched.run(id)
    res.json({ ok: true })
  } catch (err) {
    logger.error('Feed watched error:', { error: err.message })
    res.status(500).json({ error: 'Failed to mark watched' })
  }
})

// -----------------------------------------------------------
// POST /api/feed/source-feedback
// Adjust source weight: { domain, action: 'boost' | 'hide' }
// -----------------------------------------------------------
router.post('/api/feed/source-feedback', (req, res) => {
  const { domain, action } = req.body || {}
  if (!domain || !action) return res.status(400).json({ error: 'domain and action required' })

  try {
    const s = getStmts()
    if (action === 'hide') {
      s.hideSource.run(domain)
    } else if (action === 'boost') {
      s.boostSource.run(domain)
    }
    res.json({ ok: true })
  } catch (err) {
    logger.error('Source feedback error:', { error: err.message })
    res.status(500).json({ error: 'Failed to update source' })
  }
})

// -----------------------------------------------------------
// Queue CRUD (3.1 Queue Sync)
// All mutations return the full updated queue so clients stay in sync.
// -----------------------------------------------------------

function reindexQueue(mode) {
  const s = getStmts()
  const items = s.getQueueIdsByMode.all(mode)
  items.forEach((item, i) => s.updateQueuePos.run(i, item.id))
}

/** Mode-scoped fetch with lazy backfill of legacy NULL-mode rows. */
function getQueueForMode(mode) {
  const s = getStmts()
  const rows = s.getQueueByMode.all(mode)
  // Lazy backfill: classify legacy NULL-mode rows by URL on read.
  // Drop ones whose inferred mode != requested mode.
  const result = []
  for (const r of rows) {
    if (r.mode === mode) {
      result.push(r)
      continue
    }
    if (r.mode == null && r.video_url) {
      const inferred = inferMode(r.video_url)
      s.backfillQueueMode.run(inferred, r.id)
      if (inferred === mode) {
        result.push({ ...r, mode: inferred })
      }
    }
  }
  return result
}

// GET /api/queue — return ordered queue for the current mode
router.get('/api/queue', (req, res) => {
  const mode = getMode(req)
  try {
    res.json({ queue: getQueueForMode(mode) })
  } catch (err) {
    logger.error('Queue fetch error', { error: err.message })
    res.status(500).json({ error: 'Failed to fetch queue' })
  }
})

// POST /api/queue — add video to end (or at a specific position).
// Mode is derived from the URL itself, not from the request -- a pornhub URL
// always lands in the nsfw queue regardless of which mode the client claims.
router.post('/api/queue', express.json(), (req, res) => {
  const { video_url, title, thumbnail, duration, duration_formatted, position } = req.body || {}
  if (!video_url) return res.status(400).json({ error: 'video_url required' })

  // Source-of-truth mode. The response queue is also filtered by this mode.
  const itemMode = inferMode(video_url)

  try {
    const s = getStmts()
    const maxPos = s.maxQueuePosByMode.get(itemMode).maxPos
    const insertPos = position !== undefined ? position : maxPos + 1

    if (position !== undefined) {
      s.shiftQueueByMode.run(insertPos, itemMode)
    }

    s.insertQueue.run(insertPos, video_url, title || '', thumbnail || '', duration || 0, duration_formatted || '0:00', itemMode)

    res.json({ queue: getQueueForMode(itemMode) })
  } catch (err) {
    logger.error('Queue add error', { error: err.message })
    res.status(500).json({ error: 'Failed to add to queue' })
  }
})

// PUT /api/queue — full reorder from ordered array of IDs
router.put('/api/queue', express.json(), (req, res) => {
  const { order } = req.body || {}
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' })
  const mode = getMode(req)

  try {
    order.forEach((id, i) => getStmts().updateQueuePos.run(i, id))
    res.json({ queue: getQueueForMode(mode) })
  } catch (err) {
    logger.error('Queue reorder error', { error: err.message })
    res.status(500).json({ error: 'Failed to reorder queue' })
  }
})

// DELETE /api/queue/:id — remove single item, reindex
router.delete('/api/queue/:id', (req, res) => {
  const mode = getMode(req)
  try {
    getStmts().deleteQueueItem.run(req.params.id)
    reindexQueue(mode)
    res.json({ queue: getQueueForMode(mode) })
  } catch (err) {
    logger.error('Queue remove error', { error: err.message })
    res.status(500).json({ error: 'Failed to remove from queue' })
  }
})

// DELETE /api/queue — clear queue for current mode only.
// Cross-mode queue items survive an explicit clear in one mode.
router.delete('/api/queue', (req, res) => {
  const mode = getMode(req)
  try {
    getStmts().clearQueueByMode.run(mode)
    res.json({ queue: [] })
  } catch (err) {
    logger.error('Queue clear error', { error: err.message })
    res.status(500).json({ error: 'Failed to clear queue' })
  }
})

// Allow index.js to inject the refillFeedCache function to avoid circular imports
let _refillFeedCache = null
export function setRefillFeedCache(fn) {
  _refillFeedCache = fn
}

export default router
