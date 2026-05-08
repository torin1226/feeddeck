// ============================================================
// Creator CRUD API
// Manage followed creators/subreddits for the multi-source feed.
// ============================================================

import { Router } from 'express'
import { db } from '../database.js'
import { invalidateProfileCache } from '../scoring.js'

const router = Router()

const REVIEW_DOWN_THRESHOLD = 4
const VALID_MODES = ['social', 'nsfw']

// URL generators per platform
const URL_GENERATORS = {
  reddit:    (handle) => `https://www.reddit.com/r/${handle}/hot.json?limit=15`,
  tiktok:    (handle) => `https://www.tiktok.com/@${handle.replace(/^@/, '')}`,
  instagram: (handle) => `https://www.instagram.com/${handle.replace(/^@/, '')}/reels/`,
  twitter:   (handle) => `https://x.com/${handle.replace(/^@/, '')}/media`,
}

const VALID_PLATFORMS = Object.keys(URL_GENERATORS)

// GET /api/creators?platform=reddit
router.get('/api/creators', (req, res) => {
  const { platform } = req.query
  let rows
  if (platform && VALID_PLATFORMS.includes(platform)) {
    rows = db.prepare('SELECT * FROM creators WHERE platform = ? ORDER BY added_at DESC').all(platform)
  } else {
    rows = db.prepare('SELECT * FROM creators ORDER BY platform, added_at DESC').all()
  }
  res.json({ creators: rows })
})

// POST /api/creators  { platform, handle, label? }
router.post('/api/creators', (req, res) => {
  const { platform, handle, label } = req.body || {}

  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: `Invalid platform. Use: ${VALID_PLATFORMS.join(', ')}` })
  }
  if (!handle || typeof handle !== 'string' || !handle.trim()) {
    return res.status(400).json({ error: 'handle is required' })
  }

  const cleanHandle = handle.trim().replace(/^[@/r/]+/, '')
  if (!cleanHandle) {
    return res.status(400).json({ error: 'handle is empty after normalization' })
  }
  const urlGen = URL_GENERATORS[platform]
  const url = urlGen(cleanHandle)

  try {
    const result = db.prepare(
      'INSERT INTO creators (platform, handle, url, label) VALUES (?, ?, ?, ?)'
    ).run(platform, cleanHandle, url, label || cleanHandle)

    // Auto-enable the platform source if it was inactive
    db.prepare("UPDATE sources SET active = 1 WHERE domain = ? AND query = '__creators__'")
      .run(platform === 'twitter' ? 'twitter.com' : `${platform}.com`)

    res.json({
      id: result.lastInsertRowid,
      platform,
      handle: cleanHandle,
      url,
      label: label || cleanHandle,
    })
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: `Already following ${platform}/${cleanHandle}` })
    }
    res.status(500).json({ error: err.message })
  }
})

// POST /api/creators/import  { platform, handles: ['handle1', 'handle2', ...] }
router.post('/api/creators/import', (req, res) => {
  const { platform, handles } = req.body || {}

  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: `Invalid platform. Use: ${VALID_PLATFORMS.join(', ')}` })
  }
  if (!Array.isArray(handles) || handles.length === 0) {
    return res.status(400).json({ error: 'handles must be a non-empty array' })
  }

  const urlGen = URL_GENERATORS[platform]
  const insert = db.prepare(
    'INSERT OR IGNORE INTO creators (platform, handle, url, label) VALUES (?, ?, ?, ?)'
  )

  let added = 0
  for (const raw of handles) {
    const h = String(raw).trim().replace(/^[@/r/]+/, '')
    if (!h) continue
    const result = insert.run(platform, h, urlGen(h), h)
    if (result.changes > 0) added++
  }

  // Auto-enable the platform source
  db.prepare("UPDATE sources SET active = 1 WHERE domain = ? AND query = '__creators__'")
    .run(platform === 'twitter' ? 'twitter.com' : `${platform}.com`)

  res.json({ added, total: handles.length })
})

// DELETE /api/creators/:id
router.delete('/api/creators/:id', (req, res) => {
  const result = db.prepare('DELETE FROM creators WHERE id = ?').run(req.params.id)
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Creator not found' })
  }
  res.json({ deleted: true })
})

// PUT /api/creators/:id  { active?, handle? }
router.put('/api/creators/:id', (req, res) => {
  const { active, handle } = req.body || {}
  const existing = db.prepare('SELECT * FROM creators WHERE id = ?').get(req.params.id)
  if (!existing) {
    return res.status(404).json({ error: 'Creator not found' })
  }

  if (typeof active === 'number' || typeof active === 'boolean') {
    db.prepare('UPDATE creators SET active = ?, fetch_failures = 0 WHERE id = ?')
      .run(active ? 1 : 0, req.params.id)
  }

  if (handle && typeof handle === 'string') {
    const cleanHandle = handle.trim().replace(/^[@/r/]+/, '')
    const urlGen = URL_GENERATORS[existing.platform]
    db.prepare('UPDATE creators SET handle = ?, url = ?, label = ? WHERE id = ?')
      .run(cleanHandle, urlGen(cleanHandle), cleanHandle, req.params.id)
  }

  const updated = db.prepare('SELECT * FROM creators WHERE id = ?').get(req.params.id)
  res.json(updated)
})

// GET /api/creators/needs-review?mode=social
// Lists creators with ≥REVIEW_DOWN_THRESHOLD thumbs-downs that the user
// hasn't yet acted on (block or dismiss). Drives the Settings pruning UI.
router.get('/api/creators/needs-review', (req, res) => {
  const mode = VALID_MODES.includes(req.query.mode) ? req.query.mode : 'social'
  try {
    const rows = db.prepare(`
      SELECT vr.creator, COUNT(*) AS down_count, MAX(vr.rated_at) AS last_down,
             (SELECT title FROM video_ratings
                WHERE creator = vr.creator AND mode = vr.mode AND rating = 'down'
                ORDER BY rated_at DESC LIMIT 1) AS sample_title
      FROM video_ratings vr
      WHERE vr.rating = 'down'
        AND vr.mode = ?
        AND vr.creator IS NOT NULL AND vr.creator != ''
        AND NOT EXISTS (
          SELECT 1 FROM blocked_creators bc
          WHERE bc.creator = vr.creator AND bc.mode = vr.mode
        )
      GROUP BY vr.creator
      HAVING COUNT(*) >= ?
      ORDER BY down_count DESC, last_down DESC
    `).all(mode, REVIEW_DOWN_THRESHOLD)
    res.json({ creators: rows, threshold: REVIEW_DOWN_THRESHOLD })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

function recordReview(action) {
  return (req, res) => {
    const { creator, mode } = req.body || {}
    if (!creator || typeof creator !== 'string') {
      return res.status(400).json({ error: 'creator required' })
    }
    if (!VALID_MODES.includes(mode)) {
      return res.status(400).json({ error: `mode must be one of ${VALID_MODES.join(', ')}` })
    }
    try {
      db.prepare(
        `INSERT INTO blocked_creators (creator, mode, action, reviewed_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(creator, mode) DO UPDATE SET
           action = excluded.action,
           reviewed_at = excluded.reviewed_at`
      ).run(creator.trim(), mode, action)
      invalidateProfileCache()
      res.json({ ok: true, creator, mode, action })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
}

router.post('/api/creators/block', recordReview('blocked'))
router.post('/api/creators/dismiss', recordReview('dismissed'))

router.post('/api/creators/unblock', (req, res) => {
  const { creator, mode } = req.body || {}
  if (!creator || !VALID_MODES.includes(mode)) {
    return res.status(400).json({ error: 'creator and valid mode required' })
  }
  try {
    const result = db.prepare(
      'DELETE FROM blocked_creators WHERE creator = ? AND mode = ?'
    ).run(creator.trim(), mode)
    invalidateProfileCache()
    res.json({ ok: true, deleted: result.changes })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
