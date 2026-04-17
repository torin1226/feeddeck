import { Router } from 'express'
import express from 'express'
import { db } from '../database.js'
import { logger } from '../logger.js'
import { formatDuration } from '../utils.js'
import { scoreVideo, isDownvoted } from '../scoring.js'

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

    // Get unwatched videos using a two-pass approach for source diversity:
    // 1. Pick up to 2 videos per source (round-robin fairness)
    // 2. Fill remaining slots with weighted random from all sources
    //
    // Weight logic: base weight from sources table, then 5x boost if the
    // video's creator is in subscription_backups (user's followed accounts).
    const perSourceLimit = Math.max(2, Math.ceil(count / 5))
    const rawUnwatched = db.prepare(`
      SELECT fc.id, fc.url, fc.stream_url AS streamUrl, fc.title, fc.creator AS uploader, fc.thumbnail,
             fc.duration, fc.orientation, fc.source_domain AS source, fc.tags,
             COALESCE(s.weight, 1.0) * CASE WHEN sb.id IS NOT NULL THEN 5.0 ELSE 1.0 END AS weight
      FROM feed_cache fc
      LEFT JOIN sources s ON fc.source_domain = s.domain
      LEFT JOIN subscription_backups sb ON fc.creator IS NOT NULL
        AND (sb.handle = fc.creator OR sb.display_name = fc.creator)
      WHERE fc.mode = ? AND fc.watched = 0${whereExtra}
      ORDER BY RANDOM()
      LIMIT ${count * 10}
    `).all(...params)

    // Unified taste profile scoring (3.12): replaces old tag_preferences multiplier.
    // Uses multi-signal taste_profile + creator_boosts + decay for weights.
    // Also excludes downvoted videos from results.
    const allUnwatched = rawUnwatched.filter(v => !isDownvoted(v.url))
    for (const v of allUnwatched) {
      const tasteScore = scoreVideo(v, 'feed', null)
      // Blend taste score with existing source/subscription weight
      v.weight = v.weight * (0.5 + tasteScore)
    }

    // Round-robin: take perSourceLimit from each source
    const bySource = {}
    for (const v of allUnwatched) {
      if (!bySource[v.source]) bySource[v.source] = []
      bySource[v.source].push(v)
    }

    const videos = []
    const used = new Set()
    // First pass: round-robin
    for (const [_src, vids] of Object.entries(bySource)) {
      for (const v of vids.slice(0, perSourceLimit)) {
        if (videos.length >= count) break
        videos.push(v)
        used.add(v.id)
      }
    }
    // Second pass: fill remaining slots with weighted random sampling
    if (videos.length < count) {
      const remaining = allUnwatched.filter(v => !used.has(v.id))
      // Weighted shuffle: items with higher weight are more likely to appear first
      remaining.sort((a, b) => (Math.random() ** (1 / (b.weight || 1))) - (Math.random() ** (1 / (a.weight || 1))))
      for (const v of remaining) {
        if (videos.length >= count) break
        videos.push(v)
      }
    }
    // Final shuffle so sources are interleaved, not grouped
    videos.sort(() => Math.random() - 0.5)

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
    db.prepare('UPDATE feed_cache SET watched = 1 WHERE id = ?').run(id)
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
    if (action === 'hide') {
      db.prepare('UPDATE sources SET active = 0 WHERE domain = ?').run(domain)
    } else if (action === 'boost') {
      db.prepare('UPDATE sources SET weight = MIN(weight + 0.3, 3.0) WHERE domain = ?').run(domain)
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

function getFullQueue() {
  return db.prepare('SELECT id, position, video_url, title, thumbnail, duration, duration_formatted, added_at FROM queue ORDER BY position ASC').all()
}

function reindexQueue() {
  const items = db.prepare('SELECT id FROM queue ORDER BY position ASC').all()
  const update = db.prepare('UPDATE queue SET position = ? WHERE id = ?')
  items.forEach((item, i) => update.run(i, item.id))
}

// GET /api/queue — return ordered queue
router.get('/api/queue', (req, res) => {
  try {
    res.json({ queue: getFullQueue() })
  } catch (err) {
    logger.error('Queue fetch error', { error: err.message })
    res.status(500).json({ error: 'Failed to fetch queue' })
  }
})

// POST /api/queue — add video to end (or at a specific position)
router.post('/api/queue', express.json(), (req, res) => {
  const { video_url, title, thumbnail, duration, duration_formatted, position } = req.body || {}
  if (!video_url) return res.status(400).json({ error: 'video_url required' })

  try {
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) as maxPos FROM queue').get().maxPos
    const insertPos = position !== undefined ? position : maxPos + 1

    // If inserting at a specific position, shift items down
    if (position !== undefined) {
      db.prepare('UPDATE queue SET position = position + 1 WHERE position >= ?').run(insertPos)
    }

    db.prepare(
      'INSERT INTO queue (id, position, video_url, title, thumbnail, duration, duration_formatted) VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?)'
    ).run(insertPos, video_url, title || '', thumbnail || '', duration || 0, duration_formatted || '0:00')

    res.json({ queue: getFullQueue() })
  } catch (err) {
    logger.error('Queue add error', { error: err.message })
    res.status(500).json({ error: 'Failed to add to queue' })
  }
})

// PUT /api/queue — full reorder from ordered array of IDs
router.put('/api/queue', express.json(), (req, res) => {
  const { order } = req.body || {}
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' })

  try {
    const update = db.prepare('UPDATE queue SET position = ? WHERE id = ?')
    order.forEach((id, i) => update.run(i, id))
    res.json({ queue: getFullQueue() })
  } catch (err) {
    logger.error('Queue reorder error', { error: err.message })
    res.status(500).json({ error: 'Failed to reorder queue' })
  }
})

// DELETE /api/queue/:id — remove single item, reindex
router.delete('/api/queue/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM queue WHERE id = ?').run(req.params.id)
    reindexQueue()
    res.json({ queue: getFullQueue() })
  } catch (err) {
    logger.error('Queue remove error', { error: err.message })
    res.status(500).json({ error: 'Failed to remove from queue' })
  }
})

// DELETE /api/queue — clear all
router.delete('/api/queue', (req, res) => {
  try {
    db.prepare('DELETE FROM queue').run()
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
