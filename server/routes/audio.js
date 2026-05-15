// ============================================================
// Audio API routes
// Separate from the video feed routes because audio is evergreen,
// taste-ordered (not fetched_at DESC), and has its own scoring path.
// See plan: generic-exploring-lampson.md.
// ============================================================

import { Router } from 'express'
import express from 'express'
import { db } from '../database.js'
import { logger } from '../logger.js'
import {
  audioScore,
  recomputeAudioScores,
  invalidateAudioProfileCache,
} from '../scoring.js'

const router = Router()

// -----------------------------------------------------------
// GET /api/audio/feed?limit=50
// Returns audio items ordered by taste_score DESC, with rated-down items
// excluded. Stable random tiebreak so the head of the list doesn't reorder
// on every refresh (using id-based deterministic-random via SQL).
// -----------------------------------------------------------
router.get('/api/audio/feed', (req, res) => {
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50))
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0)
  const creator = req.query.creator ? String(req.query.creator) : null
  const source = req.query.source ? String(req.query.source) : null
  const q = req.query.q ? String(req.query.q).trim() : null

  try {
    const where = ['rated >= 0']
    const params = []
    if (creator) { where.push('creator = ?'); params.push(creator) }
    if (source) { where.push('source_domain = ?'); params.push(source) }
    // Free-text search across title, creator, and the JSON-encoded tags
    // column. tags is stored as `["f4m","incest",...]` so a LIKE on the
    // serialized string matches tag substrings cheaply without needing a
    // JSON1-table join. Case-insensitive via COLLATE NOCASE.
    if (q) {
      where.push('(title LIKE ? COLLATE NOCASE OR creator LIKE ? COLLATE NOCASE OR tags LIKE ? COLLATE NOCASE)')
      const pat = `%${q}%`
      params.push(pat, pat, pat)
    }

    const rows = db.prepare(
      `SELECT id, source_domain, url, audio_url, title, creator, creator_handle,
              tags, duration_sec, length_label, fetched_at, played_at, watched,
              rated, taste_score
         FROM audio_cache
        WHERE ${where.join(' AND ')}
        ORDER BY taste_score DESC, watched ASC, rated ASC,
                 (rowid * 2654435761) % 1000 ASC
        LIMIT ? OFFSET ?`
    ).all(...params, limit, offset)

    // Parse tags from JSON; pass to client as array.
    const items = rows.map(r => ({
      ...r,
      tags: (() => { try { return JSON.parse(r.tags || '[]') } catch { return [] } })(),
      watched: !!r.watched,
      rated: r.rated,
    }))

    res.json({ items, count: items.length })
  } catch (err) {
    logger.error('GET /api/audio/feed failed', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// -----------------------------------------------------------
// POST /api/audio/:id/rate
// body: { rating: 'up' | 'down' }
// Writes to video_ratings (surface_type='audio'), updates taste_profile
// + creator_boosts (surface_key='audio', mode='nsfw'), and recomputes
// taste_score for the affected creator.
// -----------------------------------------------------------
router.post('/api/audio/:id/rate', express.json(), (req, res) => {
  const id = req.params.id
  const rating = req.body?.rating

  if (!['up', 'down'].includes(rating)) {
    return res.status(400).json({ error: 'rating must be up or down' })
  }

  const item = db.prepare(
    'SELECT id, url, title, creator, tags FROM audio_cache WHERE id = ?'
  ).get(id)
  if (!item) return res.status(404).json({ error: 'audio not found' })

  let parsedTags = []
  try { parsedTags = JSON.parse(item.tags || '[]') } catch {}

  const tagsJson = JSON.stringify(parsedTags)
  const tagWeight = rating === 'up' ? 0.3 : -0.3
  const boostDelta = rating === 'up' ? 0.25 : -0.25

  try {
    db.exec('BEGIN')

    // Record the rating (using existing video_ratings table for audit/library).
    db.prepare(
      `INSERT INTO video_ratings
       (video_url, surface_type, surface_key, rating, tags, creator, title, mode, rated_at)
       VALUES (?, 'audio', 'audio', ?, ?, ?, ?, 'nsfw', datetime('now'))`
    ).run(item.url, rating, tagsJson, item.creator, item.title)

    // Update audio_cache row (rated: 1=up, -1=down, 0=unrated)
    db.prepare(
      'UPDATE audio_cache SET rated = ? WHERE id = ?'
    ).run(rating === 'up' ? 1 : -1, id)

    // Per-tag taste signals scoped to the audio surface.
    for (const tag of parsedTags) {
      if (typeof tag !== 'string') continue
      const t = tag.toLowerCase().trim()
      if (!t) continue

      const existing = db.prepare(
        `SELECT id, weight FROM taste_profile
         WHERE signal_type = 'tag' AND signal_value = ?
           AND surface_key = 'audio' AND mode = 'nsfw'`
      ).get(t)

      if (existing) {
        const newWeight = Math.max(-1, Math.min(1, existing.weight + tagWeight))
        db.prepare(
          "UPDATE taste_profile SET weight = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(newWeight, existing.id)
      } else {
        db.prepare(
          `INSERT INTO taste_profile (signal_type, signal_value, weight, surface_key, mode, updated_at)
           VALUES ('tag', ?, ?, 'audio', 'nsfw', datetime('now'))`
        ).run(t, tagWeight)
      }
    }

    // Creator-level signal scoped to audio. taste_profile gets a creator row
    // (used for direct creator-tag scoring) AND creator_boosts.surface_boosts.audio
    // gets the cumulative score (used for the boosted multiplier).
    if (item.creator) {
      const c = item.creator.trim()
      if (c) {
        const existingCreatorSig = db.prepare(
          `SELECT id, weight FROM taste_profile
           WHERE signal_type = 'creator' AND signal_value = ?
             AND surface_key = 'audio' AND mode = 'nsfw'`
        ).get(c.toLowerCase())

        if (existingCreatorSig) {
          const w = Math.max(-2, Math.min(2, existingCreatorSig.weight + boostDelta))
          db.prepare(
            "UPDATE taste_profile SET weight = ?, updated_at = datetime('now') WHERE id = ?"
          ).run(w, existingCreatorSig.id)
        } else {
          db.prepare(
            `INSERT INTO taste_profile (signal_type, signal_value, weight, surface_key, mode, updated_at)
             VALUES ('creator', ?, ?, 'audio', 'nsfw', datetime('now'))`
          ).run(c.toLowerCase(), boostDelta)
        }

        // creator_boosts.surface_boosts.audio
        const existingBoost = db.prepare(
          'SELECT creator, boost_score, surface_boosts FROM creator_boosts WHERE creator = ?'
        ).get(c)

        if (existingBoost) {
          let sb = {}
          try { sb = JSON.parse(existingBoost.surface_boosts || '{}') } catch {}
          sb.audio = Math.max(-2, Math.min(2, (sb.audio || 0) + boostDelta))
          db.prepare(
            "UPDATE creator_boosts SET surface_boosts = ?, last_updated = datetime('now') WHERE creator = ?"
          ).run(JSON.stringify(sb), c)
        } else {
          db.prepare(
            "INSERT INTO creator_boosts (creator, boost_score, surface_boosts, last_updated) VALUES (?, 0, ?, datetime('now'))"
          ).run(c, JSON.stringify({ audio: boostDelta }))
        }
      }
    }

    db.exec('COMMIT')
  } catch (err) {
    try { db.exec('ROLLBACK') } catch {}
    logger.error('POST /api/audio/:id/rate failed', { error: err.message })
    return res.status(500).json({ error: err.message })
  }

  // Invalidate cache + recompute scores so the next /feed call sees the
  // new ordering. recomputeAudioScores updates audio_cache.taste_score in
  // place for the affected creator + a 200-row random batch.
  invalidateAudioProfileCache()
  const touched = recomputeAudioScores(item.creator)
  res.json({ ok: true, rating, touched })
})

// -----------------------------------------------------------
// POST /api/audio/:id/play
// Marks played_at to now. Used by the client when the user presses play
// so we can show a "recently played" affordance later.
// -----------------------------------------------------------
router.post('/api/audio/:id/play', express.json(), (req, res) => {
  const id = req.params.id
  try {
    const result = db.prepare(
      "UPDATE audio_cache SET played_at = datetime('now') WHERE id = ?"
    ).run(id)
    if (result.changes === 0) return res.status(404).json({ error: 'audio not found' })
    res.json({ ok: true })
  } catch (err) {
    logger.error('POST /api/audio/:id/play failed', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// -----------------------------------------------------------
// POST /api/audio/:id/complete
// Sets watched=1. Triggered by the client when the audio element fires
// 'ended'. Watched items sink in ordering but aren't deleted (you can
// always rate them later).
// -----------------------------------------------------------
router.post('/api/audio/:id/complete', express.json(), (req, res) => {
  const id = req.params.id
  try {
    const result = db.prepare(
      'UPDATE audio_cache SET watched = 1 WHERE id = ?'
    ).run(id)
    if (result.changes === 0) return res.status(404).json({ error: 'audio not found' })
    res.json({ ok: true })
  } catch (err) {
    logger.error('POST /api/audio/:id/complete failed', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// -----------------------------------------------------------
// GET /api/audio/stats
// Diagnostic: counts by creator + source, used by the health endpoint and
// by the audio page's empty state to show "you've got N items".
// -----------------------------------------------------------
router.get('/api/audio/stats', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) AS n FROM audio_cache').get().n
    const byCreator = db.prepare(
      `SELECT creator, COUNT(*) AS n FROM audio_cache
        WHERE rated >= 0 GROUP BY creator ORDER BY n DESC LIMIT 20`
    ).all()
    const bySource = db.prepare(
      `SELECT source_domain, COUNT(*) AS n FROM audio_cache
        WHERE rated >= 0 GROUP BY source_domain ORDER BY n DESC`
    ).all()
    const unrated = db.prepare(
      "SELECT COUNT(*) AS n FROM audio_cache WHERE rated = 0"
    ).get().n
    res.json({ total, unrated, byCreator, bySource })
  } catch (err) {
    logger.error('GET /api/audio/stats failed', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

export default router
