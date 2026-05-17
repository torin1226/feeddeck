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
//
// NOTE: boundary.exec additionally returns `stderr` on BOTH success and
// error paths — yt-dlp surfaces "cookies are no longer valid" via stderr
// on partial-success runs as well as failures. Consumers that don't care
// about stderr can ignore the field.
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
    return { outcome, value: null, status: null, finalUrl: null, durationMs, error }
  }

  let body = null
  try { body = await response.text() } catch {}
  const outcome = classifyHttp(response, body)
  record(name, outcome, durationMs)
  // `status` and `finalUrl` are exposed for callers that need response
  // metadata (e.g., cookie-health Instagram probe detects login-redirect
  // via the post-redirect URL). Existing callers that only destructure
  // outcome/value/durationMs are unaffected.
  return {
    outcome,
    value: body,
    status: response?.status ?? null,
    finalUrl: response?.url ?? null,
    durationMs,
  }
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
    // Partial-success: child exited non-zero but produced usable stdout
    // (yt-dlp --ignore-errors pattern). Treat as ok so the snitch tally
    // reflects user-visible outcome, not transport-layer exit code.
    if (typeof error.stdout === 'string' && error.stdout.trim().length > 0) {
      record(name, OUTCOMES.OK, durationMs)
      return {
        outcome: OUTCOMES.OK,
        value: error.stdout,
        stderr: error.stderr ?? '',
        durationMs,
        error, // still surfaced so callers can inspect exit details if needed
      }
    }
    const outcome = classifyError(error)
    record(name, outcome, durationMs)
    return { outcome, value: null, stderr: error?.stderr ?? '', durationMs, error }
  }
  const stdout = value?.stdout ?? ''
  const outcome = stdout.length === 0 ? OUTCOMES.EMPTY : OUTCOMES.OK
  record(name, outcome, durationMs)
  return { outcome, value: stdout, stderr: value?.stderr ?? '', durationMs }
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
