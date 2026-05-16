# Reliability Snitch Wrapper — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small wrapper around every server-side call that leaves the app, tag outcomes, and surface failures via a debug page so silent-degradation and external-brittleness bugs announce themselves instead of being discovered by Torin days later.

**Architecture:** A 4-piece subsystem under `server/boundary/`: pure outcome classifier, two-layer sink (rolling failure log + 24h in-memory tally), thin wrapper exposing `boundary.fetch / exec / readCookie / scrape`, and a debug route + frontend page. Sprint 1 builds the infra and pilots on yt-dlp; Sprint 2 wraps the rest of the external boundaries; Sprint 3 watches logs and ships data-driven fixes. A parallel pattern-audit track sweeps for known anti-patterns.

**Tech Stack:** Node 20+ (`node:fs/promises`, `node:child_process`, `node:test` not used — vitest), Express 4, vitest 3.2, React 18 + react-router 6 + Tailwind for the debug page.

**Spec:** `docs/superpowers/specs/2026-05-16-reliability-snitch-wrapper-design.md`

---

## File Structure

### Files to create

| File | Responsibility | LOC est. |
|------|----------------|----------|
| `server/boundary/outcomes.js` | Outcome enum + `classify(response\|error)` pure functions | ~80 |
| `server/boundary/sink.js` | Failure log writer (rolled, 7d retention) + 24h in-memory tally Map | ~120 |
| `server/boundary/wrap.js` | Public surface: `boundary.fetch / exec / readCookie / scrape`. Thin glue around outcomes + sink | ~100 |
| `server/boundary/index.js` | Re-exports `boundary` for ergonomic imports | ~5 |
| `server/boundary/__tests__/outcomes.test.js` | Classification edge-case suite | ~150 |
| `server/boundary/__tests__/sink.test.js` | Log rotation, tally daily reset, write fail-safe | ~120 |
| `server/boundary/__tests__/wrap.test.js` | End-to-end contract: timeout / abort / outcome propagation | ~150 |
| `server/routes/boundary-debug.js` | `GET /api/debug/boundary-stats`, `GET /api/debug/boundary-failures?n=50`, `DELETE /api/debug/boundary-stats` | ~60 |
| `server/__tests__/boundary-debug-route.test.js` | Route contract suite | ~100 |
| `src/pages/DebugBoundaryPage.jsx` | Read-only table of boundary tally + recent failures, refreshes every 10s | ~120 |

### Files to modify (Sprint 1 — pilot only)

| File | Change | Lines |
|------|--------|-------|
| `server/sources/ytdlp.js` | Wrap the two `execFileAsync('yt-dlp', ...)` calls inside `ytdlp()` (lines 93, 123) with `boundary.exec` | ~10 |
| `server/index.js` | `import boundaryDebugRoutes from './routes/boundary-debug.js'` and `app.use(boundaryDebugRoutes)` | 2 |
| `src/components/AppShell.jsx` | Add `const DebugBoundaryPage = lazy(() => import('../pages/DebugBoundaryPage'))` and a `<Route path="/debug/boundary-stats" element={<DebugBoundaryPage />} />` | 4 |

### Files to modify (Sprint 2 — apply the pattern)

See "Sprint 2 — Per-Call-Site Recipe" section below. Each call site is its own task following the same template.

### Files explicitly NOT touched

- `server/database.js` — SQLite calls already throw loudly; no silent degradation risk
- `server/scoring.js`, `server/topics.js` — pure functions, no I/O
- Test files — wrappers would distort coverage signal
- Client-side `src/**` other than the debug page — out of scope this milestone

---

## Sprint 1 — Infrastructure + Pilot

### Task 1: Outcome enum and classifier (`outcomes.js`)

**Files:**
- Create: `server/boundary/outcomes.js`
- Test: `server/boundary/__tests__/outcomes.test.js`

- [ ] **Step 1: Write the failing test file**

```js
// server/boundary/__tests__/outcomes.test.js
import { describe, it, expect } from 'vitest'
import { OUTCOMES, classifyHttp, classifyError } from '../outcomes.js'

describe('OUTCOMES enum', () => {
  it('exposes the eight expected tags', () => {
    expect(OUTCOMES).toEqual({
      OK: 'ok',
      EMPTY: 'empty',
      WRONG_SHAPE: 'wrong_shape',
      AUTH_FAILED: 'auth_failed',
      RATE_LIMITED: 'rate_limited',
      TIMEOUT: 'timeout',
      BLOCKED: 'blocked',
      UNKNOWN_ERROR: 'unknown_error',
    })
  })
})

describe('classifyHttp(response, body)', () => {
  it('returns ok for 2xx with non-empty body', () => {
    expect(classifyHttp({ status: 200 }, 'data')).toBe('ok')
    expect(classifyHttp({ status: 201 }, [{ a: 1 }])).toBe('ok')
  })
  it('returns empty for 2xx with empty body', () => {
    expect(classifyHttp({ status: 200 }, '')).toBe('empty')
    expect(classifyHttp({ status: 200 }, [])).toBe('empty')
    expect(classifyHttp({ status: 204 }, null)).toBe('empty')
  })
  it('returns auth_failed for 401 / 403', () => {
    expect(classifyHttp({ status: 401 }, '')).toBe('auth_failed')
    expect(classifyHttp({ status: 403 }, '')).toBe('auth_failed')
  })
  it('returns rate_limited for 429', () => {
    expect(classifyHttp({ status: 429 }, '')).toBe('rate_limited')
  })
  it('returns blocked for 451 or 403 with geo body fragment', () => {
    expect(classifyHttp({ status: 451 }, '')).toBe('blocked')
    expect(classifyHttp({ status: 403 }, 'not available in your region')).toBe('blocked')
  })
  it('returns wrong_shape for 2xx but body is the empty-on-purpose sentinel', () => {
    expect(classifyHttp({ status: 200 }, '<!doctype html>')).toBe('wrong_shape')
  })
  it('returns unknown_error for anything else', () => {
    expect(classifyHttp({ status: 500 }, '')).toBe('unknown_error')
    expect(classifyHttp({ status: 502 }, '')).toBe('unknown_error')
  })
})

describe('classifyError(err)', () => {
  it('returns timeout for AbortError / ETIMEDOUT / ECONNRESET-after-timeout', () => {
    expect(classifyError({ name: 'AbortError' })).toBe('timeout')
    expect(classifyError({ code: 'ETIMEDOUT' })).toBe('timeout')
    expect(classifyError({ code: 'ABORT_ERR' })).toBe('timeout')
  })
  it('returns auth_failed when stderr/message mentions cookies/login', () => {
    expect(classifyError({ stderr: 'cookies are no longer valid' })).toBe('auth_failed')
    expect(classifyError({ message: 'login required' })).toBe('auth_failed')
  })
  it('returns rate_limited when stderr/message mentions HTTP Error 429', () => {
    expect(classifyError({ stderr: 'HTTP Error 429: Too Many Requests' })).toBe('rate_limited')
  })
  it('returns blocked for geo / cloudflare fragments', () => {
    expect(classifyError({ stderr: 'Video unavailable in your country' })).toBe('blocked')
    expect(classifyError({ message: 'cloudflare challenge' })).toBe('blocked')
  })
  it('returns wrong_shape on JSON parse / shape errors', () => {
    expect(classifyError({ name: 'SyntaxError', message: 'Unexpected token' })).toBe('wrong_shape')
  })
  it('returns unknown_error as the default bucket', () => {
    expect(classifyError({ message: 'something exploded' })).toBe('unknown_error')
    expect(classifyError(new Error('?'))).toBe('unknown_error')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/boundary/__tests__/outcomes.test.js`
Expected: FAIL with "Cannot find module '../outcomes.js'"

- [ ] **Step 3: Implement `outcomes.js`**

```js
// server/boundary/outcomes.js
// ============================================================
// Boundary outcome classifier
// Pure functions that map an HTTP response or thrown error to
// one of eight outcome tags. No I/O, no side effects.
// ============================================================

export const OUTCOMES = Object.freeze({
  OK: 'ok',
  EMPTY: 'empty',
  WRONG_SHAPE: 'wrong_shape',
  AUTH_FAILED: 'auth_failed',
  RATE_LIMITED: 'rate_limited',
  TIMEOUT: 'timeout',
  BLOCKED: 'blocked',
  UNKNOWN_ERROR: 'unknown_error',
})

const GEO_BODY_FRAGMENTS = [
  'not available in your region',
  'not available in your country',
  'video unavailable in your country',
]

function isEmpty(body) {
  if (body == null) return true
  if (typeof body === 'string') return body.length === 0
  if (Array.isArray(body)) return body.length === 0
  if (typeof body === 'object') return Object.keys(body).length === 0
  return false
}

function bodyLooksLikeHtml(body) {
  if (typeof body !== 'string') return false
  const head = body.slice(0, 200).toLowerCase()
  return head.includes('<!doctype html') || head.includes('<html')
}

export function classifyHttp(response, body) {
  const status = response?.status ?? 0
  const bodyText = typeof body === 'string' ? body.toLowerCase() : ''

  if (status === 451) return OUTCOMES.BLOCKED
  if (status === 403 && GEO_BODY_FRAGMENTS.some(f => bodyText.includes(f))) {
    return OUTCOMES.BLOCKED
  }
  if (status === 401 || status === 403) return OUTCOMES.AUTH_FAILED
  if (status === 429) return OUTCOMES.RATE_LIMITED

  if (status >= 200 && status < 300) {
    if (isEmpty(body)) return OUTCOMES.EMPTY
    if (bodyLooksLikeHtml(body)) return OUTCOMES.WRONG_SHAPE
    return OUTCOMES.OK
  }

  return OUTCOMES.UNKNOWN_ERROR
}

export function classifyError(err) {
  if (!err) return OUTCOMES.UNKNOWN_ERROR
  const msg = (err.stderr || err.message || '').toLowerCase()
  const code = err.code || err.name || ''

  if (
    err.name === 'AbortError' ||
    code === 'ABORT_ERR' ||
    code === 'ETIMEDOUT' ||
    code === 'ESOCKETTIMEDOUT'
  ) {
    return OUTCOMES.TIMEOUT
  }

  if (msg.includes('cookies are no longer valid') || msg.includes('login required')) {
    return OUTCOMES.AUTH_FAILED
  }

  if (msg.includes('http error 429') || msg.includes('rate limit')) {
    return OUTCOMES.RATE_LIMITED
  }

  if (msg.includes('unavailable in your country') || msg.includes('cloudflare challenge')) {
    return OUTCOMES.BLOCKED
  }

  if (err.name === 'SyntaxError' || msg.includes('unexpected token')) {
    return OUTCOMES.WRONG_SHAPE
  }

  return OUTCOMES.UNKNOWN_ERROR
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/boundary/__tests__/outcomes.test.js`
Expected: PASS, all classifier tests green.

- [ ] **Step 5: Commit**

```bash
git add server/boundary/outcomes.js server/boundary/__tests__/outcomes.test.js
git commit -m "feat(boundary): outcome enum + classifier (M7.1)"
```

---

### Task 2: Sink — failure log writer + 24h tally (`sink.js`)

**Files:**
- Create: `server/boundary/sink.js`
- Test: `server/boundary/__tests__/sink.test.js`
- Failure log target: `data/boundary-failures.log` (rotated to `boundary-failures.log.<YYYY-MM-DD>` daily)

- [ ] **Step 1: Write the failing test**

```js
// server/boundary/__tests__/sink.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('../../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

let tmpDir
let sink

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'boundary-sink-'))
  vi.resetModules()
  process.env.BOUNDARY_LOG_DIR = tmpDir
  sink = await import('../sink.js?t=' + Date.now())
  sink.resetForTest()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  delete process.env.BOUNDARY_LOG_DIR
})

describe('record(name, outcome, durationMs)', () => {
  it('bumps the in-memory tally for the boundary + outcome', () => {
    sink.record('yt-dlp-stream-url', 'ok', 120)
    sink.record('yt-dlp-stream-url', 'ok', 80)
    sink.record('yt-dlp-stream-url', 'timeout', 30000)
    const stats = sink.snapshot()
    expect(stats['yt-dlp-stream-url']).toMatchObject({ ok: 2, timeout: 1 })
  })

  it('writes ONLY non-ok outcomes to the failure log file', () => {
    sink.record('reddit-creator', 'ok', 50)
    sink.record('reddit-creator', 'auth_failed', 120)
    const logPath = join(tmpDir, 'boundary-failures.log')
    expect(existsSync(logPath)).toBe(true)
    const lines = readFileSync(logPath, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0])
    expect(entry.name).toBe('reddit-creator')
    expect(entry.outcome).toBe('auth_failed')
    expect(entry.durationMs).toBe(120)
    expect(typeof entry.ts).toBe('string')
  })

  it('does NOT log URLs, response bodies, or any user data', () => {
    sink.record('proxy-stream', 'timeout', 15000, { url: 'https://secret.example/abc' })
    const logPath = join(tmpDir, 'boundary-failures.log')
    const content = readFileSync(logPath, 'utf8')
    expect(content).not.toContain('secret.example')
    expect(content).not.toContain('https://')
  })

  it('snapshot() returns a deep copy, not a live reference', () => {
    sink.record('a', 'ok', 1)
    const snap = sink.snapshot()
    sink.record('a', 'ok', 1)
    expect(snap.a.ok).toBe(1)
    expect(sink.snapshot().a.ok).toBe(2)
  })

  it('resetTally() clears the in-memory tally without touching the file', () => {
    sink.record('a', 'auth_failed', 5)
    expect(sink.snapshot().a.auth_failed).toBe(1)
    sink.resetTally()
    expect(sink.snapshot()).toEqual({})
    expect(existsSync(join(tmpDir, 'boundary-failures.log'))).toBe(true)
  })
})

describe('rotation', () => {
  it('rotateIfStale() renames the active file to .YYYY-MM-DD when the day changes', () => {
    // Inject the date the failure was "written" so the test is not date-fragile.
    sink._setLastWriteDateForTest('2026-05-16')
    sink.record('a', 'auth_failed', 1) // append happens; record() preserves injected date
    sink.rotateIfStale('2026-05-17')   // now pretend it is tomorrow
    const files = readdirSync(tmpDir)
    expect(files).toContain('boundary-failures.log.2026-05-16')
  })

  it('pruneOlderThan(days) deletes rotated files older than N days', () => {
    sink._setLastWriteDateForTest('2026-05-16')
    sink.record('a', 'auth_failed', 1)
    sink.rotateIfStale('2026-05-25') // 9 days later — produces .2026-05-16
    sink.pruneOlderThan(7, '2026-05-25')
    const files = readdirSync(tmpDir)
    expect(files).not.toContain('boundary-failures.log.2026-05-16')
  })
})

describe('write fail-safe', () => {
  it('does not throw when appendFileSync fails', async () => {
    // Mock appendFileSync to throw, simulating a read-only FS or quota error.
    // More portable than fabricating an invalid path (Windows vs POSIX rules differ).
    vi.resetModules()
    vi.doMock('fs', async () => {
      const real = await vi.importActual('fs')
      return {
        ...real,
        appendFileSync: () => { throw new Error('EACCES: read-only') },
      }
    })
    const failingSink = await import('../sink.js?t=fail-' + Date.now())
    expect(() => failingSink.record('a', 'auth_failed', 1)).not.toThrow()
    vi.doUnmock('fs')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/boundary/__tests__/sink.test.js`
Expected: FAIL with "Cannot find module '../sink.js'"

- [ ] **Step 3: Implement `sink.js`**

```js
// server/boundary/sink.js
// ============================================================
// Boundary sink — two layers
// 1. Failure log: append-only JSON-line file. Rolled daily.
//    Pruned at 7 days. Failures only (non-ok outcomes).
// 2. In-memory tally: Map<name, { ok, empty, wrong_shape, ... }>
//    Reset every 24h via resetTally(). Snapshot() returns a copy.
// ============================================================

import { mkdirSync, appendFileSync, renameSync, existsSync, readdirSync, unlinkSync, statSync } from 'fs'
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

let tally = new Map()
let lastWriteDate = null

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
    lastWriteDate = todayIso()
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
  } catch {
    return
  }
  for (const file of dir) {
    if (!file.startsWith(`${LOG_FILENAME}.`)) continue
    const stamp = file.slice(`${LOG_FILENAME}.`.length)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp)) continue
    if (new Date(stamp) < cutoff) {
      try { unlinkSync(join(logDir(), file)) } catch {}
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/boundary/__tests__/sink.test.js`
Expected: PASS, all sink tests green.

- [ ] **Step 5: Commit**

```bash
git add server/boundary/sink.js server/boundary/__tests__/sink.test.js
git commit -m "feat(boundary): failure log + 24h tally sink (M7.1)"
```

---

### Task 3: Wrapper surface (`wrap.js`)

**Files:**
- Create: `server/boundary/wrap.js`, `server/boundary/index.js`
- Test: `server/boundary/__tests__/wrap.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/boundary/__tests__/wrap.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

const sink = await import('../sink.js')
const { boundary } = await import('../wrap.js')

beforeEach(() => {
  sink.resetForTest()
})

describe('boundary.fetch(url, opts)', () => {
  it('returns { outcome: ok, value, durationMs } on a 2xx with body', async () => {
    const fakeFetch = vi.fn(async () => ({
      status: 200,
      text: async () => '{"items":[1,2,3]}',
    }))
    const r = await boundary.fetch('https://example.test/x', {
      name: 'test-fetch',
      fetchImpl: fakeFetch,
    })
    expect(r.outcome).toBe('ok')
    expect(r.value).toBe('{"items":[1,2,3]}')
    expect(typeof r.durationMs).toBe('number')
    expect(sink.snapshot()['test-fetch'].ok).toBe(1)
  })

  it('classifies a 401 as auth_failed and records to sink', async () => {
    const fakeFetch = vi.fn(async () => ({ status: 401, text: async () => '' }))
    const r = await boundary.fetch('https://example.test/x', {
      name: 'test-fetch',
      fetchImpl: fakeFetch,
    })
    expect(r.outcome).toBe('auth_failed')
    expect(sink.snapshot()['test-fetch'].auth_failed).toBe(1)
  })

  it('classifies an AbortError as timeout', async () => {
    const fakeFetch = vi.fn(async () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    })
    const r = await boundary.fetch('https://example.test/x', {
      name: 'test-fetch',
      timeoutMs: 100,
      fetchImpl: fakeFetch,
    })
    expect(r.outcome).toBe('timeout')
    expect(r.value).toBeNull()
  })

  it('passes the AbortSignal it created to the underlying fetch', async () => {
    const fakeFetch = vi.fn(async (_url, opts) => {
      expect(opts.signal).toBeInstanceOf(AbortSignal)
      return { status: 200, text: async () => 'ok' }
    })
    await boundary.fetch('https://x.test', {
      name: 'test-fetch',
      timeoutMs: 5000,
      fetchImpl: fakeFetch,
    })
    expect(fakeFetch).toHaveBeenCalledOnce()
  })
})

describe('boundary.exec(cmd, args, opts)', () => {
  it('returns ok with stdout when the command succeeds', async () => {
    const fakeExec = vi.fn(async () => ({ stdout: 'video-url-here', stderr: '' }))
    const r = await boundary.exec('yt-dlp', ['--get-url', 'x'], {
      name: 'yt-dlp-stream-url',
      execImpl: fakeExec,
    })
    expect(r.outcome).toBe('ok')
    expect(r.value).toBe('video-url-here')
  })

  it('classifies stderr "cookies are no longer valid" as auth_failed', async () => {
    const fakeExec = vi.fn(async () => {
      const err = new Error('exit 1')
      err.stderr = 'ERROR: cookies are no longer valid'
      throw err
    })
    const r = await boundary.exec('yt-dlp', ['x'], {
      name: 'yt-dlp-stream-url',
      execImpl: fakeExec,
    })
    expect(r.outcome).toBe('auth_failed')
  })

  it('classifies HTTP Error 429 in stderr as rate_limited', async () => {
    const fakeExec = vi.fn(async () => {
      const err = new Error('exit 1')
      err.stderr = 'HTTP Error 429: Too Many Requests'
      throw err
    })
    const r = await boundary.exec('yt-dlp', ['x'], {
      name: 'yt-dlp-stream-url',
      execImpl: fakeExec,
    })
    expect(r.outcome).toBe('rate_limited')
  })
})

describe('boundary.readCookie(path, opts)', () => {
  it('returns ok with file contents when readable and non-empty', async () => {
    const fakeRead = vi.fn(async () => '# Netscape\n.example\tTRUE\t/\tFALSE\t9999\tabc\tdef\n')
    const r = await boundary.readCookie('/tmp/cookies.txt', {
      name: 'cookie-test',
      readImpl: fakeRead,
    })
    expect(r.outcome).toBe('ok')
    expect(r.value).toContain('Netscape')
  })

  it('returns auth_failed when ENOENT or file is empty', async () => {
    const fakeRead = vi.fn(async () => {
      const err = new Error('ENOENT')
      err.code = 'ENOENT'
      throw err
    })
    const r = await boundary.readCookie('/tmp/missing.txt', {
      name: 'cookie-test',
      readImpl: fakeRead,
    })
    expect(r.outcome).toBe('auth_failed')
  })
})

describe('boundary.scrape(fn, opts)', () => {
  it('wraps an arbitrary scraper function and tags its outcome', async () => {
    const r = await boundary.scrape(async () => [{ id: 'a' }], {
      name: 'reddit-creator',
    })
    expect(r.outcome).toBe('ok')
    expect(r.value).toEqual([{ id: 'a' }])
  })

  it('returns empty when scraper returns []', async () => {
    const r = await boundary.scrape(async () => [], { name: 'reddit-creator' })
    expect(r.outcome).toBe('empty')
  })

  it('classifies thrown errors via classifyError', async () => {
    const r = await boundary.scrape(async () => {
      const err = new Error('login required')
      throw err
    }, { name: 'reddit-creator' })
    expect(r.outcome).toBe('auth_failed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/boundary/__tests__/wrap.test.js`
Expected: FAIL with "Cannot find module '../wrap.js'"

- [ ] **Step 3: Implement `wrap.js` and `index.js`**

```js
// server/boundary/wrap.js
// ============================================================
// Boundary wrapper — public surface
// Each call returns { outcome, value, durationMs }. The caller
// branches on outcome instead of try/catch + silent fallback.
//
// All four entry points accept an optional impl override for
// dependency injection in tests:
//   boundary.fetch    fetchImpl
//   boundary.exec     execImpl
//   boundary.readCookie readImpl
//   boundary.scrape   (no override needed — caller passes the fn)
// ============================================================

import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile } from 'fs/promises'
import { OUTCOMES, classifyHttp, classifyError } from './outcomes.js'
import { record } from './sink.js'

const execFileAsync = promisify(execFile)

const DEFAULT_FETCH_TIMEOUT_MS = 15_000
const DEFAULT_EXEC_TIMEOUT_MS = 30_000

async function timed(fn) {
  const start = Date.now()
  try {
    const value = await fn()
    return { value, durationMs: Date.now() - start, error: null }
  } catch (error) {
    return { value: null, durationMs: Date.now() - start, error }
  }
}

async function wrappedFetch(url, opts = {}) {
  const {
    name,
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
    ...rest
  } = opts
  if (!name) throw new Error('boundary.fetch requires opts.name')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const { value: response, durationMs, error } = await timed(() =>
    fetchImpl(url, { ...rest, signal: controller.signal })
  )
  clearTimeout(timer)

  if (error) {
    const outcome = classifyError(error)
    record(name, outcome, durationMs)
    return { outcome, value: null, durationMs, error }
  }

  let body = null
  try { body = await response.text() } catch {}
  const outcome = classifyHttp(response, body)
  record(name, outcome, durationMs)
  return { outcome, value: body, durationMs }
}

async function wrappedExec(cmd, args, opts = {}) {
  const {
    name,
    timeoutMs = DEFAULT_EXEC_TIMEOUT_MS,
    maxBuffer = 50 * 1024 * 1024,
    execImpl = execFileAsync,
    ...rest
  } = opts
  if (!name) throw new Error('boundary.exec requires opts.name')

  const { value, durationMs, error } = await timed(() =>
    execImpl(cmd, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer, windowsHide: true, ...rest })
  )

  if (error) {
    const outcome = classifyError(error)
    record(name, outcome, durationMs)
    return { outcome, value: null, durationMs, error }
  }
  const stdout = value?.stdout ?? ''
  const outcome = stdout.length === 0 ? OUTCOMES.EMPTY : OUTCOMES.OK
  record(name, outcome, durationMs)
  return { outcome, value: stdout, durationMs }
}

async function wrappedReadCookie(path, opts = {}) {
  const { name, readImpl = readFile } = opts
  if (!name) throw new Error('boundary.readCookie requires opts.name')

  const { value, durationMs, error } = await timed(() => readImpl(path, 'utf8'))

  if (error) {
    const outcome = error.code === 'ENOENT'
      ? OUTCOMES.AUTH_FAILED
      : classifyError(error)
    record(name, outcome, durationMs)
    return { outcome, value: null, durationMs, error }
  }
  if (!value || value.trim().length === 0) {
    record(name, OUTCOMES.AUTH_FAILED, durationMs)
    return { outcome: OUTCOMES.AUTH_FAILED, value: null, durationMs }
  }
  record(name, OUTCOMES.OK, durationMs)
  return { outcome: OUTCOMES.OK, value, durationMs }
}

async function wrappedScrape(fn, opts = {}) {
  const { name } = opts
  if (!name) throw new Error('boundary.scrape requires opts.name')

  const { value, durationMs, error } = await timed(fn)

  if (error) {
    const outcome = classifyError(error)
    record(name, outcome, durationMs)
    return { outcome, value: null, durationMs, error }
  }
  if (Array.isArray(value) && value.length === 0) {
    record(name, OUTCOMES.EMPTY, durationMs)
    return { outcome: OUTCOMES.EMPTY, value, durationMs }
  }
  record(name, OUTCOMES.OK, durationMs)
  return { outcome: OUTCOMES.OK, value, durationMs }
}

export const boundary = {
  fetch: wrappedFetch,
  exec: wrappedExec,
  readCookie: wrappedReadCookie,
  scrape: wrappedScrape,
}
```

```js
// server/boundary/index.js
export { boundary } from './wrap.js'
export { OUTCOMES } from './outcomes.js'
export { snapshot, rotateIfStale, pruneOlderThan, resetTally } from './sink.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/boundary/__tests__/wrap.test.js`
Expected: PASS, all wrapper contract tests green.

- [ ] **Step 5: Commit**

```bash
git add server/boundary/wrap.js server/boundary/index.js server/boundary/__tests__/wrap.test.js
git commit -m "feat(boundary): wrapper surface for fetch/exec/readCookie/scrape (M7.1)"
```

---

### Task 4: Debug route (`boundary-debug.js`)

**Files:**
- Create: `server/routes/boundary-debug.js`
- Test: `server/__tests__/boundary-debug-route.test.js`
- Modify: `server/index.js` (mount the route)

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/boundary-debug-route.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'

vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

const sink = await import('../boundary/sink.js')
const { default: boundaryDebugRouter } = await import('../routes/boundary-debug.js')

// Lifted from server/__tests__/mode-leaks.test.js — drives an Express
// router via an in-memory request/response pair without supertest.
function callApp(app, method, url) {
  return new Promise((resolve, reject) => {
    const req = {
      method, url,
      headers: {},
      query: Object.fromEntries(new URL('http://x' + url).searchParams),
      params: {},
      path: url.split('?')[0],
      on(event, cb) { if (event === 'end') queueMicrotask(cb) },
      pipe() {}, socket: { destroy() {} }, get() { return null },
    }
    let payload = null
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this },
      json(data) { payload = data; resolve({ status: this.statusCode, body: data }) },
      setHeader() {}, end() { resolve({ status: this.statusCode, body: payload }) },
      on() {},
    }
    try { app(req, res, (err) => { if (err) reject(err) }) } catch (err) { reject(err) }
  })
}

function buildApp() {
  const app = express()
  app.use(boundaryDebugRouter)
  return app
}

beforeEach(() => { sink.resetForTest() })

describe('GET /api/debug/boundary-stats', () => {
  it('returns empty object when no boundary calls have happened', async () => {
    const r = await callApp(buildApp(), 'GET', '/api/debug/boundary-stats')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ boundaries: {} })
  })

  it('returns the current tally as { boundaries: {...} }', async () => {
    sink.record('yt-dlp-stream-url', 'ok', 100)
    sink.record('yt-dlp-stream-url', 'timeout', 30000)
    sink.record('reddit-creator', 'auth_failed', 50)
    const r = await callApp(buildApp(), 'GET', '/api/debug/boundary-stats')
    expect(r.status).toBe(200)
    expect(r.body.boundaries['yt-dlp-stream-url']).toMatchObject({ ok: 1, timeout: 1 })
    expect(r.body.boundaries['reddit-creator']).toMatchObject({ auth_failed: 1 })
  })
})

describe('DELETE /api/debug/boundary-stats', () => {
  it('clears the in-memory tally', async () => {
    sink.record('a', 'ok', 1)
    const r = await callApp(buildApp(), 'DELETE', '/api/debug/boundary-stats')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true })
    const after = await callApp(buildApp(), 'GET', '/api/debug/boundary-stats')
    expect(after.body.boundaries).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/boundary-debug-route.test.js`
Expected: FAIL with "Cannot find module '../routes/boundary-debug.js'"

- [ ] **Step 3: Implement the route**

```js
// server/routes/boundary-debug.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/boundary-debug-route.test.js`
Expected: PASS.

- [ ] **Step 5: Mount the route in `server/index.js`**

Add to imports (with the other route imports near line 23):
```js
import boundaryDebugRoutes from './routes/boundary-debug.js'
```

Add to the `app.use(...)` block (just after `app.use(debugRoutes)`):
```js
app.use(boundaryDebugRoutes)
```

- [ ] **Step 6: Smoke test the route**

Run: `npm run dev:server` in one terminal, then `curl http://localhost:3001/api/debug/boundary-stats` in another.
Expected: `{"boundaries":{}}`. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add server/routes/boundary-debug.js server/__tests__/boundary-debug-route.test.js server/index.js
git commit -m "feat(boundary): debug-stats route + mount (M7.2)"
```

---

### Task 5: Daily rotation hook in server lifecycle

**Files:**
- Modify: `server/index.js` (call `rotateIfStale` + `pruneOlderThan` daily)

- [ ] **Step 1: Find a good interval hook**

In `server/index.js`, find the existing background scheduler block (search for `setInterval` or `fetchAudioCycle`). The audio fetcher runs every 30 minutes via `setInterval`. Add a parallel daily rotation tick.

- [ ] **Step 2: Add the rotation interval**

Near the bottom of `server/index.js`, after the existing `setInterval`s but before `app.listen(...)`:

```js
import { rotateIfStale, pruneOlderThan } from './boundary/sink.js'

// Daily boundary log rotation + 7-day pruning
const ONE_HOUR_MS = 60 * 60 * 1000
setInterval(() => {
  rotateIfStale()
  pruneOlderThan(7)
}, ONE_HOUR_MS)
// And once at startup
rotateIfStale()
pruneOlderThan(7)
```

- [ ] **Step 3: Smoke test**

Run: `npm run dev:server`. Confirm no errors at startup. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(boundary): hourly rotation + 7-day pruning (M7.2)"
```

---

### Task 6: Debug page (`DebugBoundaryPage.jsx`)

**Files:**
- Create: `src/pages/DebugBoundaryPage.jsx`
- Modify: `src/components/AppShell.jsx` (register lazy route)

- [ ] **Step 1: Implement the page**

```jsx
// src/pages/DebugBoundaryPage.jsx
import { useEffect, useState } from 'react'

// ============================================================
// Debug — Boundary Stats
// Read-only table of every wrapped external boundary and its
// outcome counts since the in-memory tally was last reset.
// Refreshes every 10s. Internal-only — the deploy target is a
// single Beelink box on Torin's home network.
// ============================================================

const OUTCOME_COLS = [
  'ok', 'empty', 'wrong_shape', 'auth_failed',
  'rate_limited', 'timeout', 'blocked', 'unknown_error',
]

export default function DebugBoundaryPage() {
  const [boundaries, setBoundaries] = useState({})
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const r = await fetch('/api/debug/boundary-stats')
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const json = await r.json()
        if (!cancelled) setBoundaries(json.boundaries || {})
      } catch (err) {
        if (!cancelled) setError(err.message)
      }
    }
    load()
    const id = setInterval(load, 10_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const rows = Object.entries(boundaries)
    .map(([name, bucket]) => ({
      name,
      ...bucket,
      total: OUTCOME_COLS.reduce((s, c) => s + (bucket[c] || 0), 0),
      failures: OUTCOME_COLS.filter(c => c !== 'ok').reduce((s, c) => s + (bucket[c] || 0), 0),
    }))
    .sort((a, b) => b.failures - a.failures)

  return (
    <div className="min-h-screen bg-surface text-text p-8">
      <h1 className="text-2xl font-bold mb-4">Boundary stats (last 24h)</h1>
      {error && <p className="text-red-500 mb-4">Error: {error}</p>}
      {rows.length === 0 && <p>No boundary calls recorded yet.</p>}
      {rows.length > 0 && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-text/20">
              <th className="text-left p-2">Boundary</th>
              <th className="text-right p-2">Total</th>
              <th className="text-right p-2">Failures</th>
              {OUTCOME_COLS.map(c => (
                <th key={c} className="text-right p-2">{c}</th>
              ))}
              <th className="text-left p-2">Last failure</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.name} className="border-b border-text/10">
                <td className="p-2 font-mono">{row.name}</td>
                <td className="text-right p-2">{row.total}</td>
                <td className={`text-right p-2 ${row.failures > 0 ? 'text-red-500' : ''}`}>
                  {row.failures}
                </td>
                {OUTCOME_COLS.map(c => (
                  <td key={c} className="text-right p-2">{row[c] || 0}</td>
                ))}
                <td className="p-2 text-text/60">{row.lastFailureAt || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Register the route in `AppShell.jsx`**

In `src/components/AppShell.jsx`, near the other `lazy(...)` declarations (around line 19):

```jsx
const DebugBoundaryPage = lazy(() => import('../pages/DebugBoundaryPage'))
```

Inside the `<Routes>` block, add:

```jsx
<Route path="/debug/boundary-stats" element={<DebugBoundaryPage />} />
```

- [ ] **Step 3: Smoke test**

Run: `npm run dev` (concurrent client + server). Open `http://localhost:5173/debug/boundary-stats`.
Expected: Page loads, shows "No boundary calls recorded yet" or an empty table.

- [ ] **Step 4: Commit**

```bash
git add src/pages/DebugBoundaryPage.jsx src/components/AppShell.jsx
git commit -m "feat(boundary): debug page at /debug/boundary-stats (M7.2)"
```

---

### Task 7: Pilot — wrap yt-dlp in `server/sources/ytdlp.js`

**Files:**
- Modify: `server/boundary/wrap.js` (extend `wrappedExec` return shape — MUST happen before ytdlp migration)
- Modify: `server/boundary/__tests__/wrap.test.js` (add stderr-on-success contract test)
- Modify: `server/sources/ytdlp.js` (lines 86–139, the `ytdlp()` function)

> **Why two phases:** the existing `ytdlp()` function reads `stderr` from the success branch to detect "cookies are no longer valid" warnings. `wrappedExec` as built in Task 3 only exposes `stdout`. Extend the wrapper FIRST so the ytdlp migration is a clean swap.

#### Phase A — Extend `wrappedExec` to return stderr on success

- [ ] **Step 1: Add the failing test in `wrap.test.js`**

Add this case to the existing `describe('boundary.exec ...')` block:

```js
it('returns stderr alongside stdout on success', async () => {
  const fakeExec = vi.fn(async () => ({ stdout: 'url', stderr: 'WARNING: cookies are no longer valid' }))
  const r = await boundary.exec('yt-dlp', ['x'], {
    name: 'yt-dlp-stream-url',
    execImpl: fakeExec,
  })
  expect(r.outcome).toBe('ok')
  expect(r.stderr).toContain('cookies are no longer valid')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/boundary/__tests__/wrap.test.js`
Expected: FAIL — `r.stderr` is undefined.

- [ ] **Step 3: Update `wrappedExec` success branch in `wrap.js`**

Find the success branch in `wrappedExec` (after `if (error) {...}`):

```js
const stdout = value?.stdout ?? ''
const outcome = stdout.length === 0 ? OUTCOMES.EMPTY : OUTCOMES.OK
record(name, outcome, durationMs)
return { outcome, value: stdout, stderr: value?.stderr ?? '', durationMs }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/boundary/__tests__/wrap.test.js`
Expected: PASS, all wrap.js tests still green.

- [ ] **Step 5: Commit Phase A**

```bash
git add server/boundary/wrap.js server/boundary/__tests__/wrap.test.js
git commit -m "feat(boundary): wrappedExec returns stderr on success (M7.3a)"
```

#### Phase B — Migrate `ytdlp.js` to use the wrapper

- [ ] **Step 6: Read the current implementation**

Open `server/sources/ytdlp.js` and locate the `ytdlp()` function (starts ~line 86). Two `execFileAsync('yt-dlp', ...)` calls live inside, both wrapped in shared cookie/error logic. Confirm the boundary endpoint name `/api/stream-url` (or whatever route invokes `ytdlp()`) by grepping `server/routes/` for `ytdlp(` callers — use that endpoint for the smoke test below.

- [ ] **Step 7: Add the import**

At the top of `server/sources/ytdlp.js` (with the other imports):

```js
import { boundary } from '../boundary/index.js'
```

- [ ] **Step 8: Replace the primary `execFileAsync` call (currently ~lines 92–105)**

Replace the body of the first `try` block:

```js
const { outcome, value: stdout, stderr } = await boundary.exec(
  'yt-dlp', finalArgs, {
    name: 'yt-dlp-stream-url',
    timeoutMs: options.timeout || YTDLP_TIMEOUT,
    maxBuffer: options.maxBuffer || MAX_BUFFER,
  }
)
if (outcome === 'ok') {
  if (stderr?.includes('cookies are no longer valid') && domain) {
    _verifyAndMarkExpired(domain)
  }
  return stdout
}
// outcome !== 'ok' — fall through to the existing retry / error logic.
// Preserve the partial-success path (--ignore-errors with stdout) — if the
// current code returned err.stdout on partial success, replicate that by
// inspecting `stdout` here before throwing.
if (args.includes('--ignore-errors') && stdout?.trim()) {
  if (stderr?.includes('cookies are no longer valid') && domain) {
    _verifyAndMarkExpired(domain)
  }
  return stdout
}
// Otherwise fall through to existing cookie-expired retry logic — synthesize
// an err-like object the rest of the function can branch on.
const err = { stderr, message: `yt-dlp ${outcome}` }
```

- [ ] **Step 9: Replace the no-cookie retry `execFileAsync` (currently ~lines 122–129)**

Replace with the same wrapper pattern (boundary name stays the same — it's still a yt-dlp stream URL fetch):

```js
const { outcome: retryOutcome, value: retryStdout } = await boundary.exec(
  'yt-dlp', noCookieArgs, {
    name: 'yt-dlp-stream-url',
    timeoutMs: options.timeout || YTDLP_TIMEOUT,
    maxBuffer: options.maxBuffer || MAX_BUFFER,
  }
)
if (retryOutcome === 'ok') return retryStdout
if (args.includes('--ignore-errors') && retryStdout?.trim()) return retryStdout
throw new Error(`yt-dlp retry failed: ${retryOutcome}`)
```

- [ ] **Step 10: Run all boundary + sources tests**

Run: `npx vitest run server/boundary/ server/__tests__/`
Expected: PASS, no regressions.

- [ ] **Step 11: Manual end-to-end smoke test**

1. Start the dev server: `npm run dev:server`
2. Identify the yt-dlp endpoint by grepping for `ytdlp(` callers (likely in `server/routes/stream.js` or `server/routes/content.js`). Trigger one call via curl.
3. Open `http://localhost:5173/debug/boundary-stats` and confirm `yt-dlp-stream-url` appears with at least one `ok` entry.
4. Induce a failure: kill your network OR use an invalid URL. Confirm the failure outcome appears.
5. Check `data/boundary-failures.log` exists and has the failure line.

- [ ] **Step 12: Commit Phase B**

```bash
git add server/sources/ytdlp.js
git commit -m "feat(boundary): pilot wrap yt-dlp via boundary.exec (M7.3b)"
```

---

### Task 8: Sprint 1 sign-off

- [ ] **Step 1: Update BACKLOG.md**

In the vault root `BACKLOG.md`, mark M7 Sprint 1 tasks done:

```
- [x] **7.1 Build wrapper core** — `server/boundary/{wrap,outcomes,sink,index}.js` shipped + ~50 tests
- [x] **7.2 Build debug surface** — `/api/debug/boundary-stats` route + `/debug/boundary-stats` page
- [x] **7.3 Pilot wrap on yt-dlp** — `server/sources/ytdlp.js` routed through `boundary.exec`
```

Move them under `## Completed (Recent)` with today's date prepended.

- [ ] **Step 2: Write a session log**

Create `_memory/sessions/2026-05-16-m7-sprint-1.md` from `_memory/sessions/_TEMPLATE.md`. Fill all sections.

- [ ] **Step 3: Sprint 1 commit**

```bash
git commit --allow-empty -m "chore(M7): Sprint 1 closed — wrapper infra + yt-dlp pilot live"
```

---

## Sprint 2 — Per-Call-Site Recipe

Each of the 7 wrap tasks below follows the **same template**. They are independent and can be parallelized across multiple subagents.

### Generic per-site task template

**For each call site:**

- [ ] **Step 1:** Read the current implementation, find every external call (HTTP fetch, scrape, cookie read).
- [ ] **Step 2:** For each, write a contract test that mocks the underlying impl and asserts:
  - Success path returns expected data
  - Failure path (HTTP 4xx/5xx, thrown error, empty body) returns the appropriate outcome and does NOT silently fall back
- [ ] **Step 3:** Replace the raw call with `boundary.fetch / exec / readCookie / scrape` using a stable boundary `name`.
- [ ] **Step 4:** Replace any `.catch(() => [])` / `.catch(() => null)` / `if (!response.ok) return []` at the call site with explicit outcome branching:
  ```js
  const { outcome, value } = await boundary.fetch(url, { name: 'xxx' })
  if (outcome !== 'ok') return { items: [], failureReason: outcome }
  return parseAndReturn(value)
  ```
- [ ] **Step 5:** Run the call-site's existing test file. Fix any regressions.
- [ ] **Step 6:** Manual smoke test — invoke the site's endpoint once and confirm `/debug/boundary-stats` reflects the call.
- [ ] **Step 7:** Commit with message `feat(boundary): wrap <site> via boundary.<method> (M7.4–7.7)`.

### Per-site task list (Sprint 2)

| # | Boundary name | File to wrap | Existing tests |
|---|---------------|--------------|----------------|
| 7.4a | `reddit-creator` | `server/sources/reddit.js` | `server/__tests__/scraper-routing.test.js`, related |
| 7.4b | `tiktok-creator` | `server/sources/tiktok.js` | search by file name |
| 7.4c | `instagram-creator` | `server/sources/instagram.js` | `scraper-instagram.test.js` |
| 7.4d | `twitter-creator` | `server/sources/twitter.js` | search by file name |
| 7.5  | `cookie-read-{site}` | `server/cookies.js` | search by file name |
| 7.6a | `proxy-stream` | `server/routes/proxy-stream.js` (or `routes/stream.js`) | `stream-url-homepage-cache.test.js` |
| 7.6b | `proxy-image` | `server/routes/proxy-image.js` (search project for image proxy) | search by file name |
| 7.7a | `nsfw-pornhub-stream-url` | `server/sources/pornhub-personal.js`, `pornhub-subs-sync.js` | search by file name |
| 7.7b | `nsfw-eporner-stream-url` | `server/sources/eporner.js` | `eporner.test.js` |
| 7.7c | `nsfw-spankbang-stream-url` | `server/sources/spankbang.js` (if present) | search by file name |

### Boundary naming convention (LOCK IN)

- Static string constants. Never interpolate user/dynamic data into the name.
- Format: `{surface}-{site}-{operation}` or `{operation}-{site}` (e.g., `cookie-read-pornhub`, `nsfw-eporner-stream-url`, `reddit-creator`).
- Add a comment in `server/boundary/index.js` listing all known boundary names as a reference.

### Sprint 2 sign-off

- [ ] All 10 per-site tasks committed
- [ ] Run `npx vitest run server/` — full suite green
- [ ] Manual: visit `/debug/boundary-stats` after browsing the homepage for 5 minutes, confirm at least 5 boundaries show traffic
- [ ] Update BACKLOG.md, mark 7.4–7.8 done, write session log

---

## Sprint 3 — Observe and Fix

This is not a code-task plan. It is an operational loop run daily for ~2 weeks.

### Daily routine (5–10 min/day)

- [ ] **Step 1:** Open `/debug/boundary-stats`. Note the top 3 boundaries by `failures` column.
- [ ] **Step 2:** Tail `data/boundary-failures.log | tail -50`. Skim for unexpected outcome tags.
- [ ] **Step 3:** Pick the worst offender. Read the current code path. Identify why the failures cluster (cookie expired? format ID dead? rate limit hit? endpoint changed?).
- [ ] **Step 4:** Fix the root cause. Write a regression test. Commit. Move on tomorrow.

### Exit criteria

Stop the daily loop when, for 3 consecutive days, the total non-ok event count across all boundaries is `<5`, OR each remaining recurring failure has a documented exception (committed as a comment in the call-site file referencing the M7 spec).

### Sprint 3 sign-off

- [ ] At least 3 root-cause fixes shipped
- [ ] Documented baseline (paste a snapshot of `/debug/boundary-stats` into the M7 closing session log)
- [ ] BACKLOG.md M7 marked complete
- [ ] M7 retrospective note in `_memory/decisions/2026-XX-XX-m7-closing.md`

---

## Parallel Track — Pattern Audit

Runs alongside Sprints 1–3. Each finding becomes its own tiny PR.

### Anti-pattern checklist

- [ ] **7.P1 — `.catch(() => [])` and `.catch(() => null)`** — silent empty on error
  Run: `npx grep -rn "\\.catch(() => \\[\\])" server/ src/`
  Run: `npx grep -rn "\\.catch(() => null)" server/ src/`
  For each hit: replace with explicit outcome handling. If the silent empty IS the desired behavior, add a comment explaining why.

- [ ] **7.P2 — `if (!response.ok) return []`** — HTTP error → empty array, no signal
  Run: `npx grep -rn "if (!.*\\.ok)" server/ src/`
  Audit each: should it return an outcome marker instead?

- [ ] **7.P3 — `Promise.allSettled` without checking rejected count**
  Run: `npx grep -rn "Promise\\.allSettled" server/ src/`
  For each: is the rejected count logged or surfaced? If not, add it.

- [ ] **7.P4 — Hardcoded external IDs / format constants**
  Run: `npx grep -rn "'1080p'\\|'720p'\\|'480p'" server/sources/`
  Audit each: is this constant still valid against today's external API? Add a probe.

- [ ] **7.P5 — Calls missing `mode` parameter**
  Cross-check `getMode` audit (existing) with all `fetch(/api/...)` call sites in `src/`. Already partially done by `2026-05-14` mode-leaks work — close the remaining 11 routes.

- [ ] **7.P6 — `?? 'fallback'` after parsing required values**
  Run: `npx grep -rn "?? '" src/ server/`
  Audit each: is the `??` masking "missing" vs "actually empty"?

### Pattern-audit sign-off

- [ ] All 6 patterns swept
- [ ] Findings either fixed or filed as `## Discovered Tasks` in BACKLOG.md with explicit deferral reason
- [ ] Single closing commit: `chore(M7): pattern audit complete`

---

## Risks During Implementation

| Risk | Mitigation |
|------|------------|
| `boundary.fetch` overhead measurable on hot paths | Sprint 1 includes a perf check — add `console.time` around 100 wrapped calls in a smoke test, verify <1ms p95 overhead |
| `boundary.exec` swallowing the cookie-retry path in `ytdlp.js` | Task 7 explicitly preserves the cookie-retry logic by exposing `stderr` in the wrapper return shape |
| In-memory tally Map grows if boundary names accidentally include dynamic data | Add a lint/grep step in Sprint 2 sign-off: `grep -rn "boundary\\.\\(fetch\\|exec\\|scrape\\|readCookie\\)" server/` and inspect every `name:` value — must be a string literal |
| Failure log fills disk if rotation breaks | Hourly `pruneOlderThan(7)` runs in addition to daily rotation; sink writes are wrapped in try/catch fail-safe |
| Debug page leaks information if Beelink ever exposed publicly | Header comment in `DebugBoundaryPage.jsx` and `boundary-debug.js` route file documents the assumption. If/when public exposure happens, gate via env var `ALLOW_DEBUG=1` |
| Test flakiness from shared module state | Every test file resets `sink.resetForTest()` in `beforeEach`. The `vitest.config.js` already isolates files in jsdom |
