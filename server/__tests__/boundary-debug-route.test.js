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
