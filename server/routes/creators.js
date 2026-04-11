// ============================================================
// Creator CRUD API
// Manage followed creators/subreddits for the multi-source feed.
// ============================================================

import { Router } from 'express'
import { db } from '../database.js'

const router = Router()

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

  const cleanHandle = handle.trim().replace(/^[@\/r\/]+/, '')
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
    const h = String(raw).trim().replace(/^[@\/r\/]+/, '')
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
    const cleanHandle = handle.trim().replace(/^[@\/r\/]+/, '')
    const urlGen = URL_GENERATORS[existing.platform]
    db.prepare('UPDATE creators SET handle = ?, url = ?, label = ? WHERE id = ?')
      .run(cleanHandle, urlGen(cleanHandle), cleanHandle, req.params.id)
  }

  const updated = db.prepare('SELECT * FROM creators WHERE id = ?').get(req.params.id)
  res.json(updated)
})

export default router
