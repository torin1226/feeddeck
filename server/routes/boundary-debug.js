import express from 'express'
import { snapshot, resetTally } from '../boundary/sink.js'

// ============================================================
// Boundary debug routes
// Read-only audit surface for the snitch wrapper. Mirrors the
// pattern in routes/debug.js (mode-leaks). Internal-facing —
// the deploy target is a single Beelink box on Torin's home
// network, so no auth gate. If this milestone ever ships to
// public infra, gate this router behind a check.
//
// GET    /api/debug/boundary-stats    -> { boundaries: {...} }
// DELETE /api/debug/boundary-stats    -> { ok: true }
// ============================================================

const router = express.Router()

router.get('/api/debug/boundary-stats', (_req, res) => {
  res.json({ boundaries: snapshot() })
})

router.delete('/api/debug/boundary-stats', (_req, res) => {
  resetTally()
  res.json({ ok: true })
})

export default router
