import { Router } from 'express'
import express from 'express'
import { db } from '../database.js'
import { logger } from '../logger.js'
import { invalidateProfileCache, scoreVideos, getScoreBreakdown } from '../scoring.js'
import { inferMode, getMode } from '../utils.js'

const router = Router()

// -----------------------------------------------------------
// POST /api/ratings — Record a thumbs up/down rating
// Updates: video_ratings, taste_profile, creator_boosts
// -----------------------------------------------------------
router.post('/api/ratings', express.json(), (req, res) => {
  const { videoUrl, surfaceType, surfaceKey, rating, tags, creator } = req.body || {}

  if (!videoUrl) return res.status(400).json({ error: 'videoUrl required' })
  if (!['up', 'down'].includes(rating)) return res.status(400).json({ error: 'rating must be up or down' })

  // Mode firewall: derive from URL (source of truth), not request context.
  // A pornhub.com URL is always nsfw regardless of which mode the client claims.
  const videoMode = inferMode(videoUrl)

  try {
    // 1. Check for existing rating on this video (idempotency guard)
    const existing = db.prepare(
      'SELECT id, rating FROM video_ratings WHERE video_url = ? ORDER BY rated_at DESC LIMIT 1'
    ).get(videoUrl)

    if (existing && existing.rating === rating) {
      // Already rated the same way — no-op
      return res.json({ ok: true, rating, duplicate: true })
    }

    const tagsJson = JSON.stringify(tags || [])

    // Wrap all writes in a transaction for atomicity + performance
    db.exec('BEGIN')

    try {
    // Record the individual rating (includes title+thumbnail for Liked section display)
    db.prepare(
      `INSERT INTO video_ratings (video_url, surface_type, surface_key, rating, tags, creator, title, thumbnail, mode, rated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(videoUrl, surfaceType || 'home_row', surfaceKey || null, rating, tagsJson, creator || null, req.body.title || null, req.body.thumbnail || null, videoMode)

    // 2. Update taste_profile for each tag
    const videoTags = Array.isArray(tags) ? tags : []
    const tagWeight = rating === 'up' ? 0.3 : -0.3
    for (const tag of videoTags) {
      const t = tag.toLowerCase().trim()
      if (!t) continue

      // Try global update first (mode-scoped to prevent cross-mode taste pollution)
      const existing = db.prepare(
        'SELECT id, weight FROM taste_profile WHERE signal_type = ? AND signal_value = ? AND surface_key IS NULL AND mode = ?'
      ).get('tag', t, videoMode)

      if (existing) {
        const newWeight = Math.max(-1, Math.min(1, existing.weight + tagWeight))
        db.prepare('UPDATE taste_profile SET weight = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newWeight, existing.id)
      } else {
        db.prepare(
          `INSERT INTO taste_profile (signal_type, signal_value, weight, surface_key, mode, updated_at)
           VALUES ('tag', ?, ?, NULL, ?, datetime('now'))`
        ).run(t, tagWeight, videoMode)
      }

      // Surface-specific update
      if (surfaceKey) {
        const existingSurface = db.prepare(
          'SELECT id, weight FROM taste_profile WHERE signal_type = ? AND signal_value = ? AND surface_key = ? AND mode = ?'
        ).get('tag', t, surfaceKey, videoMode)

        if (existingSurface) {
          const newWeight = Math.max(-1, Math.min(1, existingSurface.weight + tagWeight))
          db.prepare('UPDATE taste_profile SET weight = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newWeight, existingSurface.id)
        } else {
          db.prepare(
            `INSERT INTO taste_profile (signal_type, signal_value, weight, surface_key, mode, updated_at)
             VALUES ('tag', ?, ?, ?, ?, datetime('now'))`
          ).run(t, tagWeight, surfaceKey, videoMode)
        }
      }
    }

    // 3. Update creator_boosts (mode-scoped)
    // creator_boosts.creator was the PK so existing schemas can't add a (creator, mode) composite key
    // without a table rebuild. Workaround: scope the lookup by mode and use the first match;
    // creators with the same name across modes will be rare but tracked separately on next write.
    if (creator) {
      const creatorKey = creator.trim()
      if (creatorKey) {
        const boostDelta = rating === 'up' ? 0.25 : -0.15
        const existing = db.prepare(
          'SELECT creator, boost_score, surface_boosts FROM creator_boosts WHERE creator = ? AND (mode IS NULL OR mode = ?)'
        ).get(creatorKey, videoMode)

        if (existing) {
          const newScore = Math.max(-1, existing.boost_score + boostDelta)
          let surfaceBoosts = {}
          try { surfaceBoosts = JSON.parse(existing.surface_boosts || '{}') } catch {}
          if (surfaceKey) {
            surfaceBoosts[surfaceKey] = (surfaceBoosts[surfaceKey] || 0) + boostDelta
          }
          db.prepare(
            'UPDATE creator_boosts SET boost_score = ?, surface_boosts = ?, mode = ?, last_updated = datetime(\'now\') WHERE creator = ?'
          ).run(newScore, JSON.stringify(surfaceBoosts), videoMode, creatorKey)
        } else {
          const surfaceBoosts = surfaceKey ? { [surfaceKey]: boostDelta } : {}
          db.prepare(
            'INSERT INTO creator_boosts (creator, boost_score, surface_boosts, mode, last_updated) VALUES (?, ?, ?, ?, datetime(\'now\'))'
          ).run(creatorKey, Math.max(-1, boostDelta), JSON.stringify(surfaceBoosts), videoMode)
        }
      }
    }

    // 4. If thumbs-up, also add to library as liked.
    // Mode is derived from the URL itself (videoMode), NOT hardcoded.
    // This was the smoking-gun cross-mode leak: every liked video used to be
    // inserted as 'nsfw' regardless of source, so YouTube likes appeared in
    // NSFW library and vice versa.
    if (rating === 'up') {
      db.prepare(
        `INSERT OR IGNORE INTO videos (url, title, thumbnail, duration, source, tags, mode, favorite, added_at)
         VALUES (?, ?, ?, 0, ?, ?, ?, 1, datetime('now'))`
      ).run(videoUrl, req.body.title || '', req.body.thumbnail || '', req.body.source || '', tagsJson, videoMode)
      // If already exists, just mark as favorite (don't change mode -- inferMode is authoritative)
      db.prepare('UPDATE videos SET favorite = 1 WHERE url = ?').run(videoUrl)
    }

    db.exec('COMMIT')
    } catch (txErr) {
      try { db.exec('ROLLBACK') } catch { /* ignore rollback errors */ }
      throw txErr
    }

    invalidateProfileCache()

    res.json({ ok: true, rating })
  } catch (err) {
    logger.error('Rating save error:', { error: err.message })
    res.status(500).json({ error: 'Failed to save rating' })
  }
})

// -----------------------------------------------------------
// POST /api/ratings/row-refresh — Get fresh videos for a row
// Called after 4+ consecutive thumbs-down on a row
// -----------------------------------------------------------
router.post('/api/ratings/row-refresh', express.json(), (req, res) => {
  const { surfaceKey, count = 12 } = req.body || {}
  if (!surfaceKey) return res.status(400).json({ error: 'surfaceKey required' })

  try {
    // Get unviewed videos from homepage_cache for this category, excluding downvoted
    const candidates = db.prepare(`
      SELECT id, url, title, thumbnail, duration, source, uploader, view_count, like_count, subscriber_count, upload_date, tags, fetched_at
      FROM homepage_cache
      WHERE category_key = ? AND viewed = 0
      ORDER BY fetched_at DESC
      LIMIT ?
    `).all(surfaceKey, count * 3)

    // Score and sort them using the taste profile
    const scored = scoreVideos(candidates, surfaceKey, { excludeDownvoted: true })
    const fresh = scored.slice(0, count)

    res.json({ videos: fresh })
  } catch (err) {
    logger.error('Row refresh error:', { error: err.message })
    res.status(500).json({ error: 'Failed to refresh row', videos: [] })
  }
})

// -----------------------------------------------------------
// POST /api/ratings/row-preferences — Save keyword overrides
// for a specific row (Step 2 enhanced feedback)
// -----------------------------------------------------------
router.post('/api/ratings/row-preferences', express.json(), (req, res) => {
  const { surfaceKey, keywords } = req.body || {}
  if (!surfaceKey || !Array.isArray(keywords)) return res.status(400).json({ error: 'surfaceKey and keywords array required' })

  try {
    for (const kw of keywords.slice(0, 5)) {
      const k = kw.trim().toLowerCase()
      if (!k) continue

      const existing = db.prepare(
        'SELECT id, weight FROM taste_profile WHERE signal_type = ? AND signal_value = ? AND surface_key = ?'
      ).get('tag', k, surfaceKey)

      if (existing) {
        const newWeight = Math.min(1, existing.weight + 0.5)
        db.prepare('UPDATE taste_profile SET weight = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newWeight, existing.id)
      } else {
        db.prepare(
          `INSERT INTO taste_profile (signal_type, signal_value, weight, surface_key, updated_at)
           VALUES ('tag', ?, 0.5, ?, datetime('now'))`
        ).run(k, surfaceKey)
      }
    }

    invalidateProfileCache()
    res.json({ ok: true })
  } catch (err) {
    logger.error('Row preferences error:', { error: err.message })
    res.status(500).json({ error: 'Failed to save preferences' })
  }
})

// -----------------------------------------------------------
// GET /api/ratings/history — Rating history for the user
// -----------------------------------------------------------
router.get('/api/ratings/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200)
  const ratingFilter = req.query.rating // optional: 'up' or 'down'
  const mode = getMode(req)

  try {
    // Filter by mode: only return ratings whose mode matches request OR
    // legacy ratings (mode IS NULL) whose URL infers to the requested mode.
    // This prevents cross-mode liked videos from leaking into the wrong shelf.
    const conditions = ['(mode = ? OR (mode IS NULL AND video_url IS NOT NULL))']
    const params = [mode]
    if (ratingFilter && ['up', 'down'].includes(ratingFilter)) {
      conditions.push('rating = ?')
      params.push(ratingFilter)
    }
    const query = `SELECT * FROM video_ratings WHERE ${conditions.join(' AND ')} ORDER BY rated_at DESC LIMIT ?`
    params.push(limit)

    const rows = db.prepare(query).all(...params)
    // Final guard: filter legacy NULL-mode rows whose URL doesn't infer to the requested mode.
    // The firewall middleware also catches this, but we filter here for correct count semantics.
    const ratings = rows.filter(r => {
      if (r.mode === mode) return true
      if (r.mode == null && r.video_url) {
        return inferMode(r.video_url) === mode
      }
      return false
    })
    res.json({ ratings })
  } catch (err) {
    logger.error('Rating history error:', { error: err.message })
    res.json({ ratings: [] })
  }
})

// -----------------------------------------------------------
// GET /api/ratings/score-debug?url=...&surface=...
// Dev-only: get score breakdown for a video
// -----------------------------------------------------------
router.get('/api/ratings/score-debug', (req, res) => {
  const { url, surface } = req.query
  if (!url) return res.status(400).json({ error: 'url required' })

  try {
    // Try to find the video in homepage_cache or feed_cache
    let video = db.prepare('SELECT * FROM homepage_cache WHERE url = ?').get(url)
    if (!video) video = db.prepare('SELECT * FROM feed_cache WHERE url = ?').get(url)
    if (!video) return res.status(404).json({ error: 'Video not found in cache' })

    const breakdown = getScoreBreakdown(video, surface || null)
    res.json(breakdown)
  } catch (err) {
    logger.error('Score debug error:', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

export default router
