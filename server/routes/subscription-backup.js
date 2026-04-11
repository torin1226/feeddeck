// ============================================================
// Subscription Backup API Routes
// ============================================================

import { Router } from 'express'
import {
  backupPlatform,
  backupAll,
  getBackupStatus,
  getBackedUpSubscriptions,
  syncToCreators,
} from '../subscription-backup.js'

const router = Router()

// GET /api/subscriptions — list backed-up subscriptions
router.get('/api/subscriptions', (req, res) => {
  const { platform } = req.query
  const subs = getBackedUpSubscriptions(platform)
  res.json({ subscriptions: subs, count: subs.length })
})

// GET /api/subscriptions/status — which platforms have auth
router.get('/api/subscriptions/status', (req, res) => {
  res.json(getBackupStatus())
})

// POST /api/subscriptions/backup — backup all platforms
router.post('/api/subscriptions/backup', async (req, res) => {
  try {
    const results = await backupAll(req.body || {})
    res.json(results)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/subscriptions/backup/:platform — backup one platform
router.post('/api/subscriptions/backup/:platform', async (req, res) => {
  try {
    const result = await backupPlatform(req.params.platform, req.body || {})
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/subscriptions/sync-creators — copy to creators table
router.post('/api/subscriptions/sync-creators', (req, res) => {
  const { platform } = req.body || {}
  const result = syncToCreators(platform)
  res.json(result)
})

export default router
