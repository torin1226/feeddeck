import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'

// ============================================================
// Mode-leak audit trail tests
// Locks down the runtime ring buffer + GET /api/debug/mode-leaks
// endpoint filed 2026-05-14 (Resilience-lens director). The
// motivating bug: client tag-preferences fetch sat shape-broken
// for 19 days because no contract / no test / no runtime check
// caught a getMode()-defaults-to-social silent leak. Buffer +
// endpoint make that class of bug grep-able in seconds.
// ============================================================

// Silence logger output during tests.
vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

// Import after mock so the logger stub is in place.
const { getMode, getModeLeaks, clearModeLeaks } = await import('../utils.js')
const { default: debugRouter } = await import('../routes/debug.js')

function makeReq({ query = {}, path = '/api/whatever', method = 'GET', headers = {} } = {}) {
  return {
    method,
    path,
    query,
    get(name) {
      return headers[name.toLowerCase()] || null
    },
  }
}

// Drives an Express router via an in-memory request/response pair.
// Mirrors the pattern in queue-routes.test.js so we don't pull in
// supertest as a dep.
function callApp(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url,
      headers: body ? { 'content-type': 'application/json' } : {},
      query: Object.fromEntries(new URL('http://x' + url).searchParams),
      params: {},
      body: undefined,
      path: url.split('?')[0],
      on(event, cb) {
        if (event === 'data' && body) cb(Buffer.from(JSON.stringify(body)))
        if (event === 'end') queueMicrotask(cb)
      },
      pipe() {},
      socket: { destroy() {} },
      get() { return null },
    }
    let payload = null
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this },
      json(data) { payload = data; resolve({ status: this.statusCode, body: data }) },
      setHeader() {},
      end() { resolve({ status: this.statusCode, body: payload }) },
      on() {},
    }
    try {
      app(req, res, (err) => { if (err) reject(err) })
    } catch (err) {
      reject(err)
    }
  })
}

beforeEach(() => {
  clearModeLeaks()
})

describe('getMode() mode-leak recording', () => {
  it('records an event when called without a mode query param', () => {
    getMode(makeReq({ query: {}, path: '/api/feed/next' }))
    const events = getModeLeaks()
    expect(events).toHaveLength(1)
    expect(events[0].path).toBe('/api/feed/next')
    expect(events[0].method).toBe('GET')
    expect(events[0].query).toEqual({})
    expect(typeof events[0].ts).toBe('string')
    expect(new Date(events[0].ts).toString()).not.toBe('Invalid Date')
  })

  it('does NOT record when called with mode=social', () => {
    getMode(makeReq({ query: { mode: 'social' }, path: '/api/feed/next' }))
    expect(getModeLeaks()).toEqual([])
  })

  it('does NOT record when called with mode=nsfw', () => {
    getMode(makeReq({ query: { mode: 'nsfw' }, path: '/api/feed/next' }))
    expect(getModeLeaks()).toEqual([])
  })

  it('captures user-agent and referer when present on the request', () => {
    getMode(makeReq({
      query: {},
      path: '/api/discover',
      headers: { 'user-agent': 'TestUA/1.0', referer: 'http://localhost:5173/feed' },
    }))
    const [entry] = getModeLeaks()
    expect(entry.userAgent).toBe('TestUA/1.0')
    expect(entry.referer).toBe('http://localhost:5173/feed')
  })

  it('captures unrelated query params alongside the missing mode', () => {
    getMode(makeReq({ query: { limit: '5', cursor: 'abc' }, path: '/api/recommendations' }))
    const [entry] = getModeLeaks()
    expect(entry.query).toEqual({ limit: '5', cursor: 'abc' })
  })

  it('tolerates a request object missing the optional get() helper', () => {
    // Tests / internal callers may pass a bare object. Should not throw.
    const bareReq = { method: 'GET', path: '/api/whatever', query: {} }
    expect(() => getMode(bareReq)).not.toThrow()
    const [entry] = getModeLeaks()
    expect(entry.userAgent).toBeNull()
    expect(entry.referer).toBeNull()
  })

  it('returns the safe default of social when mode is missing', () => {
    expect(getMode(makeReq({ query: {} }))).toBe('social')
  })

  it('returns nsfw when mode=nsfw', () => {
    expect(getMode(makeReq({ query: { mode: 'nsfw' } }))).toBe('nsfw')
  })
})

describe('mode-leak ring buffer', () => {
  it('caps the buffer at 200 entries with FIFO eviction', () => {
    for (let i = 0; i < 250; i++) {
      getMode(makeReq({ query: {}, path: `/api/r/${i}` }))
    }
    const events = getModeLeaks()
    expect(events).toHaveLength(200)
    // FIFO: the oldest 50 should have been evicted. First survivor is
    // entry 50, last entry is 249. Verify by inspecting the path field.
    expect(events[0].path).toBe('/api/r/50')
    expect(events[events.length - 1].path).toBe('/api/r/249')
  })

  it('clearModeLeaks() empties the buffer', () => {
    getMode(makeReq({ query: {} }))
    getMode(makeReq({ query: {} }))
    expect(getModeLeaks()).toHaveLength(2)
    clearModeLeaks()
    expect(getModeLeaks()).toEqual([])
  })

  it('getModeLeaks() returns a snapshot copy, not a live reference', () => {
    getMode(makeReq({ query: {} }))
    const snapshot = getModeLeaks()
    getMode(makeReq({ query: {} }))
    // The snapshot taken before the second call should not include it.
    expect(snapshot).toHaveLength(1)
    expect(getModeLeaks()).toHaveLength(2)
  })
})

describe('GET /api/debug/mode-leaks', () => {
  function buildApp() {
    const app = express()
    app.use(debugRouter)
    return app
  }

  it('returns count=0 and empty events when no leaks recorded', async () => {
    const r = await callApp(buildApp(), 'GET', '/api/debug/mode-leaks')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ count: 0, events: [] })
  })

  it('returns the captured events with their fields', async () => {
    getMode(makeReq({ query: {}, path: '/api/feed/next' }))
    getMode(makeReq({ query: { limit: '5' }, path: '/api/recommendations' }))
    const r = await callApp(buildApp(), 'GET', '/api/debug/mode-leaks')
    expect(r.status).toBe(200)
    expect(r.body.count).toBe(2)
    expect(r.body.events).toHaveLength(2)
    expect(r.body.events[0].path).toBe('/api/feed/next')
    expect(r.body.events[1].path).toBe('/api/recommendations')
    expect(r.body.events[1].query).toEqual({ limit: '5' })
  })

  it('DELETE /api/debug/mode-leaks empties the buffer', async () => {
    getMode(makeReq({ query: {} }))
    getMode(makeReq({ query: {} }))
    expect(getModeLeaks()).toHaveLength(2)
    const r = await callApp(buildApp(), 'DELETE', '/api/debug/mode-leaks')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true })
    expect(getModeLeaks()).toEqual([])
  })
})
