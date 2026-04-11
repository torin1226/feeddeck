import { Router } from 'express'
import express from 'express'
import { existsSync, writeFileSync, unlinkSync, statSync, readFileSync } from 'fs'
import { db } from '../database.js'
import { MODE_COOKIE_FILES, LEGACY_COOKIE_FILE } from '../cookies.js'
import { logger } from '../logger.js'
import { getMode, formatDuration } from '../utils.js'

const router = Router()

// -----------------------------------------------------------
// GET /api/videos
// Return all videos from database
// -----------------------------------------------------------
router.get('/api/videos', (req, res) => {
  try {
    const mode = getMode(req)
    const rows = db.prepare('SELECT * FROM videos WHERE mode = ? ORDER BY added_at DESC').all(mode)
    const videos = rows.map((row) => ({
      ...row,
      tags: row.tags ? JSON.parse(row.tags) : [],
      durationFormatted: formatDuration(row.duration),
    }))
    res.json({ videos })
  } catch (err) {
    logger.error('DB read error:', { error: err.message })
    res.json({ videos: [] })
  }
})

// -----------------------------------------------------------
// PUT /api/videos/:id/favorite — toggle favorite
// -----------------------------------------------------------
router.put('/api/videos/:id/favorite', (req, res) => {
  try {
    const row = db.prepare('SELECT favorite FROM videos WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: 'Video not found' })
    const newVal = row.favorite ? 0 : 1
    db.prepare('UPDATE videos SET favorite = ? WHERE id = ?').run(newVal, req.params.id)
    res.json({ id: req.params.id, favorite: newVal })
  } catch (err) {
    logger.error('Toggle favorite error', { error: err.message })
    res.status(500).json({ error: 'Failed to toggle favorite' })
  }
})

// -----------------------------------------------------------
// PUT /api/videos/:id/rating — set rating (1-5 or null to clear)
// -----------------------------------------------------------
router.put('/api/videos/:id/rating', express.json(), (req, res) => {
  const { rating } = req.body || {}
  if (rating !== null && (rating < 1 || rating > 5)) {
    return res.status(400).json({ error: 'Rating must be 1-5 or null' })
  }
  try {
    const row = db.prepare('SELECT id FROM videos WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: 'Video not found' })
    db.prepare('UPDATE videos SET rating = ? WHERE id = ?').run(rating, req.params.id)
    res.json({ id: req.params.id, rating })
  } catch (err) {
    logger.error('Set rating error', { error: err.message })
    res.status(500).json({ error: 'Failed to set rating' })
  }
})

// -----------------------------------------------------------
// PUT /api/videos/:id/watch-later — toggle watch later
// -----------------------------------------------------------
router.put('/api/videos/:id/watch-later', (req, res) => {
  try {
    const row = db.prepare('SELECT watch_later FROM videos WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: 'Video not found' })
    const newVal = row.watch_later ? 0 : 1
    db.prepare('UPDATE videos SET watch_later = ? WHERE id = ?').run(newVal, req.params.id)
    res.json({ id: req.params.id, watch_later: newVal })
  } catch (err) {
    logger.error('Toggle watch later error', { error: err.message })
    res.status(500).json({ error: 'Failed to toggle watch later' })
  }
})

// -----------------------------------------------------------
// GET /api/videos/favorites — return all favorited videos
// -----------------------------------------------------------
router.get('/api/videos/favorites', (req, res) => {
  try {
    const mode = getMode(req)
    const rows = db.prepare('SELECT * FROM videos WHERE favorite = 1 AND mode = ? ORDER BY added_at DESC').all(mode)
    const videos = rows.map(row => ({ ...row, tags: row.tags ? JSON.parse(row.tags) : [], durationFormatted: formatDuration(row.duration) }))
    res.json({ videos })
  } catch (err) {
    logger.error('Favorites fetch error', { error: err.message })
    res.json({ videos: [] })
  }
})

// -----------------------------------------------------------
// GET /api/videos/watch-later — return watch later list
// -----------------------------------------------------------
router.get('/api/videos/watch-later', (req, res) => {
  try {
    const mode = getMode(req)
    const rows = db.prepare('SELECT * FROM videos WHERE watch_later = 1 AND mode = ? ORDER BY added_at DESC').all(mode)
    const videos = rows.map(row => ({ ...row, tags: row.tags ? JSON.parse(row.tags) : [], durationFormatted: formatDuration(row.duration) }))
    res.json({ videos })
  } catch (err) {
    logger.error('Watch later fetch error', { error: err.message })
    res.json({ videos: [] })
  }
})

// -----------------------------------------------------------
// Cookie Auth (3.4) — import browser cookies for yt-dlp
// -----------------------------------------------------------

const VALID_COOKIE_MODES = new Set(['social', 'nsfw'])

// Helper: get cookie file path for a mode. Returns null for invalid modes.
function _cookiePath(mode) {
  if (!mode) return LEGACY_COOKIE_FILE
  if (VALID_COOKIE_MODES.has(mode)) return MODE_COOKIE_FILES[mode]
  return null // invalid mode
}

function _countCookies(content) {
  return content.split('\n').filter(l => !l.startsWith('#') && l.trim() && l.split('\t').length >= 7).length
}

function _cookieFileStatus(filePath) {
  if (!existsSync(filePath)) return null
  const stat = statSync(filePath)
  const content = readFileSync(filePath, 'utf8')
  return { installed: true, cookies: _countCookies(content), size: stat.size, modified: stat.mtime.toISOString() }
}

// POST /api/cookies — upload cookies.txt content
// Query param: ?mode=social|nsfw (defaults to legacy combined file)
router.post('/api/cookies', express.text({ limit: '5mb' }), (req, res) => {
  const content = req.body
  if (!content || typeof content !== 'string') return res.status(400).json({ error: 'Cookie content required (text/plain)' })

  // Basic validation: Netscape cookie format starts with # or domain lines
  const lines = content.trim().split('\n')
  const hasHeader = lines.some(l => l.startsWith('# Netscape') || l.startsWith('# HTTP Cookie'))
  const hasCookies = lines.some(l => !l.startsWith('#') && l.split('\t').length >= 7)

  if (!hasHeader && !hasCookies) {
    return res.status(400).json({ error: 'Invalid cookie format. Expected Netscape/Mozilla cookie.txt format.' })
  }

  const mode = req.query.mode // social | nsfw | undefined (legacy)
  const filePath = _cookiePath(mode)
  if (!filePath) return res.status(400).json({ error: `Invalid mode: ${mode}. Use "social" or "nsfw".` })

  try {
    writeFileSync(filePath, content, 'utf8')
    const cookieCount = _countCookies(content)
    logger.info('Cookies imported', { mode: mode || 'legacy', cookies: cookieCount })
    res.json({ ok: true, mode: mode || 'legacy', cookies: cookieCount })
  } catch (err) {
    logger.error('Cookie import error', { error: err.message })
    res.status(500).json({ error: 'Failed to save cookies' })
  }
})

// GET /api/cookies/status — check if cookies are installed
// Returns status for all cookie files (social, nsfw, legacy)
router.get('/api/cookies/status', (req, res) => {
  try {
    const social = _cookieFileStatus(MODE_COOKIE_FILES.social)
    const nsfw = _cookieFileStatus(MODE_COOKIE_FILES.nsfw)
    const legacy = _cookieFileStatus(LEGACY_COOKIE_FILE)

    // Backward compat: top-level installed/cookies for clients that expect the old shape
    const anyInstalled = !!(social || nsfw || legacy)
    const totalCookies = (social?.cookies || 0) + (nsfw?.cookies || 0) + (legacy?.cookies || 0)

    res.json({
      installed: anyInstalled,
      cookies: totalCookies,
      modified: social?.modified || nsfw?.modified || legacy?.modified || null,
      social: social || { installed: false },
      nsfw: nsfw || { installed: false },
      legacy: legacy || { installed: false },
    })
  } catch (err) {
    res.json({ installed: false, error: err.message })
  }
})

// DELETE /api/cookies — remove cookies file
// Query param: ?mode=social|nsfw (defaults to legacy)
router.delete('/api/cookies', (req, res) => {
  const mode = req.query.mode
  const filePath = _cookiePath(mode)
  if (!filePath) return res.status(400).json({ error: `Invalid mode: ${mode}. Use "social" or "nsfw".` })

  try {
    if (existsSync(filePath)) unlinkSync(filePath)
    logger.info('Cookies deleted', { mode: mode || 'legacy' })
    res.json({ ok: true })
  } catch (err) {
    logger.error('Cookie delete error', { error: err.message })
    res.status(500).json({ error: 'Failed to delete cookies' })
  }
})

export default router
