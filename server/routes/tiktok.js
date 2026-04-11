import { Router } from 'express'
import { db } from '../database.js'
import { logger } from '../logger.js'

const router = Router()

// -----------------------------------------------------------
// TikTok Import API
// -----------------------------------------------------------

// Status of TikTok imports (pending/done/failed counts)
router.get('/api/tiktok/status', (req, res) => {
  try {
    const counts = db.prepare(`
      SELECT status, COUNT(*) as count FROM tiktok_imports GROUP BY status
    `).all()
    const byMode = db.prepare(`
      SELECT mode, status, COUNT(*) as count FROM tiktok_imports GROUP BY mode, status
    `).all()
    const watchHistory = db.prepare(`
      SELECT mode, COUNT(*) as count FROM tiktok_watch_history GROUP BY mode
    `).all()

    const summary = { pending: 0, done: 0, failed: 0 }
    for (const row of counts) summary[row.status] = row.count

    res.json({ summary, byMode, watchHistory })
  } catch (err) {
    // Tables may not exist yet
    res.json({ summary: { pending: 0, done: 0, failed: 0 }, byMode: [], watchHistory: [] })
  }
})

// Recent imports (processed videos)
router.get('/api/tiktok/recent', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    const mode = req.query.mode
    const whereMode = mode ? 'AND ti.mode = ?' : ''
    const params = mode ? ['done', limit, mode] : ['done', limit]

    // Reorder params for the query
    const rows = db.prepare(`
      SELECT ti.url, ti.source, ti.tiktok_date, ti.mode, ti.processed_at,
             v.title, v.thumbnail, v.duration, v.tags
      FROM tiktok_imports ti
      LEFT JOIN videos v ON v.url = ti.url
      WHERE ti.status = ? ${whereMode}
      ORDER BY ti.processed_at DESC
      LIMIT ?
    `).all(...(mode ? ['done', mode, limit] : ['done', limit]))

    res.json(rows)
  } catch (err) {
    res.json([])
  }
})

// Failed imports
router.get('/api/tiktok/failed', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    const rows = db.prepare(`
      SELECT url, source, mode, error, processed_at
      FROM tiktok_imports WHERE status = 'failed'
      ORDER BY processed_at DESC LIMIT ?
    `).all(limit)
    res.json(rows)
  } catch (err) {
    res.json([])
  }
})

// Watch history
router.get('/api/tiktok/watch-history', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500)
    const mode = req.query.mode
    const rows = mode
      ? db.prepare('SELECT * FROM tiktok_watch_history WHERE mode = ? ORDER BY watched_at DESC LIMIT ?').all(mode, limit)
      : db.prepare('SELECT * FROM tiktok_watch_history ORDER BY watched_at DESC LIMIT ?').all(limit)
    res.json(rows)
  } catch (err) {
    res.json([])
  }
})

export default router
