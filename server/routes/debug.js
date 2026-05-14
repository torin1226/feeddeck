import express from 'express'
import { getModeLeaks, clearModeLeaks } from '../utils.js'

// ============================================================
// Debug routes
// Internal-facing audit endpoints. Not user-visible.
//
// /api/debug/mode-leaks  GET    -> { count, events }
// /api/debug/mode-leaks  DELETE -> { ok: true }
//
// The mode-leak ring buffer captures every getMode(req) call
// arriving without ?mode=. See server/utils.js for the recorder.
// Filed 2026-05-14 (Resilience-lens director) to make the class
// of bug 07a9e52 surfaced (19-day silent dead code on
// homeStore.js tag-preferences) detectable in seconds via
// runtime audit instead of code archaeology.
// ============================================================

const router = express.Router()

router.get('/api/debug/mode-leaks', (_req, res) => {
  const events = getModeLeaks()
  res.json({ count: events.length, events })
})

router.delete('/api/debug/mode-leaks', (_req, res) => {
  clearModeLeaks()
  res.json({ ok: true })
})

export default router
