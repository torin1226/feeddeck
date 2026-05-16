// ============================================================
// Boundary sink — two layers
// 1. Failure log: append-only JSON-line file. Rolled daily.
//    Pruned at 7 days. Failures only (non-ok outcomes).
// 2. In-memory tally: Map<name, { ok, empty, wrong_shape, ... }>
//    Reset every 24h via resetTally(). Snapshot() returns a copy.
// ============================================================

import { mkdirSync, appendFileSync, renameSync, existsSync, readdirSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { logger } from '../logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_LOG_DIR = join(__dirname, '..', '..', 'data')
const LOG_FILENAME = 'boundary-failures.log'

function logDir() {
  return process.env.BOUNDARY_LOG_DIR || DEFAULT_LOG_DIR
}
function logPath() {
  return join(logDir(), LOG_FILENAME)
}

// Single-process assumption: tally and lastWriteDate are NOT synchronized.
// Safe for the current single-Node-process Beelink deploy. If this ever
// moves to a clustered setup, both need to migrate to a shared store
// or process-per-shard layout.
let tally = new Map()
let lastWriteDate = null

// All date math in this module is UTC to match todayIso(). Rotation
// boundaries fire on UTC midnight, NOT local midnight.
function todayIso(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

export function record(name, outcome, durationMs, _extras) {
  // Tally bump
  let bucket = tally.get(name)
  if (!bucket) {
    bucket = {
      ok: 0, empty: 0, wrong_shape: 0, auth_failed: 0,
      rate_limited: 0, timeout: 0, blocked: 0, unknown_error: 0,
      lastFailureAt: null,
    }
    tally.set(name, bucket)
  }
  bucket[outcome] = (bucket[outcome] || 0) + 1
  if (outcome !== 'ok') bucket.lastFailureAt = new Date().toISOString()

  // File write — failures only. NEVER include URL or response body.
  if (outcome === 'ok') return
  try {
    mkdirSync(logDir(), { recursive: true })
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      name,
      outcome,
      durationMs,
    }) + '\n'
    appendFileSync(logPath(), entry)
    // Set-once today: preserves _setLastWriteDateForTest pinning across the
    // test's own record() call. After the first failure of the day in
    // production, lastWriteDate == today anyway so subsequent writes are
    // no-ops on this field.
    if (lastWriteDate == null) lastWriteDate = todayIso()
  } catch (err) {
    // Fail-safe: do not let logging break the request path.
    logger.warn('boundary.sink: failed to append failure log', { err: err.message })
  }
}

export function snapshot() {
  const out = {}
  for (const [name, bucket] of tally) {
    out[name] = { ...bucket }
  }
  return out
}

export function resetTally() {
  tally = new Map()
}

export function rotateIfStale(forceTodayIso) {
  const today = forceTodayIso || todayIso()
  if (!lastWriteDate || lastWriteDate === today) return
  const src = logPath()
  if (!existsSync(src)) {
    lastWriteDate = today
    return
  }
  const dest = `${src}.${lastWriteDate}`
  try {
    renameSync(src, dest)
    lastWriteDate = today
  } catch (err) {
    logger.warn('boundary.sink: rotate failed', { err: err.message })
  }
}

export function pruneOlderThan(days, forceTodayIso) {
  const today = forceTodayIso || todayIso()
  const cutoff = new Date(today)
  cutoff.setUTCDate(cutoff.getUTCDate() - days)
  let dir
  try {
    dir = readdirSync(logDir())
  } catch (err) {
    logger.warn('boundary.sink: pruneOlderThan readdir failed', { err: err.message })
    return
  }
  for (const file of dir) {
    if (!file.startsWith(`${LOG_FILENAME}.`)) continue
    const stamp = file.slice(`${LOG_FILENAME}.`.length)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp)) continue
    if (new Date(stamp) < cutoff) {
      try { unlinkSync(join(logDir(), file)) } catch (err) {
        logger.warn('boundary.sink: pruneOlderThan unlink failed', { file, err: err.message })
      }
    }
  }
}

// Test-only: reset module state without re-importing.
export function resetForTest() {
  tally = new Map()
  lastWriteDate = null
}

// Test-only: pin the "last write date" so rotation tests are not
// date-fragile. Production code must NEVER call this.
export function _setLastWriteDateForTest(iso) {
  lastWriteDate = iso
}
