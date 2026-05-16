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
