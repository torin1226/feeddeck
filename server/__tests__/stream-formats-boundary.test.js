// ============================================================
// Contract test: GET /api/stream-formats routed through boundary.exec
//
// Locks the M7 Sprint 2 migration of the raw `execFileAsync('yt-dlp', ...)`
// call at routes/stream.js:257 over to `boundary.exec` with the stable
// boundary name `yt-dlp-stream-formats`. The test stubs the boundary
// module so we can drive every outcome path without spawning yt-dlp.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'

vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

// Stub the database module so importing routes/stream.js (which imports
// `database.js` at the top level) doesn't try to open a real SQLite file.
vi.mock('../database.js', () => ({
  db: {
    prepare: () => ({ get: () => null, run: () => ({}), all: () => [] }),
  },
}))

// Stub the sources registry — stream.js imports it for other endpoints
// we don't exercise here.
vi.mock('../sources/index.js', () => ({
  registry: { adapters: [], getStreamUrl: async () => 'https://cdn.test/x.mp4' },
  ytdlp: { isAvailable: () => true, version: 'test' },
}))

vi.mock('../cookies.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getCookieArgs: (_url) => ['--cookies', '/tmp/c.txt'],
  }
})

const boundaryMock = {
  exec: vi.fn(),
}
vi.mock('../boundary/index.js', () => ({ boundary: boundaryMock }))

const { default: streamRouter } = await import('../routes/stream.js')

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
      headersSent: false,
      status(code) { this.statusCode = code; return this },
      json(data) { payload = data; resolve({ status: this.statusCode, body: data }) },
      send(data) { payload = data; resolve({ status: this.statusCode, body: data }) },
      setHeader() {}, end() { resolve({ status: this.statusCode, body: payload }) },
      on() {},
    }
    try { app(req, res, (err) => { if (err) reject(err) }) } catch (err) { reject(err) }
  })
}

function buildApp() {
  const app = express()
  app.use(streamRouter)
  return app
}

beforeEach(() => {
  boundaryMock.exec.mockReset()
})

describe('GET /api/stream-formats — boundary integration', () => {
  it('uses boundary.exec with the stable name "yt-dlp-stream-formats"', async () => {
    boundaryMock.exec.mockResolvedValue({
      outcome: 'ok',
      value: JSON.stringify({ title: 'x', formats: [] }),
      stderr: '',
      durationMs: 1,
    })

    await callApp(buildApp(), 'GET', '/api/stream-formats?url=https://youtu.be/abc')

    expect(boundaryMock.exec).toHaveBeenCalledOnce()
    const [cmd, args, opts] = boundaryMock.exec.mock.calls[0]
    expect(cmd).toBe('yt-dlp')
    expect(opts.name).toBe('yt-dlp-stream-formats')
    expect(args).toContain('-j')
    expect(args).toContain('--no-warnings')
    expect(args).toContain('--no-playlist')
    expect(args).toContain('https://youtu.be/abc')
    // cookie args are injected ahead of the yt-dlp flags
    expect(args.slice(0, 2)).toEqual(['--cookies', '/tmp/c.txt'])
  })

  it('returns 200 with parsed formats on ok outcome', async () => {
    const ytdlpJson = JSON.stringify({
      title: 'Test Video',
      formats: [
        { format_id: '137', vcodec: 'avc1', ext: 'mp4', height: 1080, filesize: 1234, fps: 30 },
        { format_id: '136', vcodec: 'avc1', ext: 'mp4', height: 720, filesize: 567, fps: 30 },
        { format_id: '140', vcodec: 'none', ext: 'm4a', height: 0 },
      ],
    })
    boundaryMock.exec.mockResolvedValue({ outcome: 'ok', value: ytdlpJson, stderr: '', durationMs: 1 })

    const r = await callApp(buildApp(), 'GET', '/api/stream-formats?url=https://youtu.be/abc')

    expect(r.status).toBe(200)
    expect(r.body.title).toBe('Test Video')
    expect(r.body.formats).toHaveLength(2)
    expect(r.body.formats[0].height).toBe(720)
    expect(r.body.formats[1].height).toBe(1080)
  })

  it('returns 429 on rate_limited outcome (not generic 500)', async () => {
    boundaryMock.exec.mockResolvedValue({
      outcome: 'rate_limited', value: null, stderr: 'HTTP Error 429', durationMs: 1,
    })
    const r = await callApp(buildApp(), 'GET', '/api/stream-formats?url=https://youtu.be/abc')
    expect(r.status).toBe(429)
  })

  it('returns 504 on timeout outcome', async () => {
    boundaryMock.exec.mockResolvedValue({
      outcome: 'timeout', value: null, stderr: '', durationMs: 30000,
    })
    const r = await callApp(buildApp(), 'GET', '/api/stream-formats?url=https://youtu.be/abc')
    expect(r.status).toBe(504)
  })

  it('returns 502 on auth_failed outcome (cookies dead)', async () => {
    boundaryMock.exec.mockResolvedValue({
      outcome: 'auth_failed', value: null, stderr: 'cookies are no longer valid', durationMs: 1,
    })
    const r = await callApp(buildApp(), 'GET', '/api/stream-formats?url=https://youtu.be/abc')
    expect(r.status).toBe(502)
  })

  it('returns 403 on blocked outcome (geo)', async () => {
    boundaryMock.exec.mockResolvedValue({
      outcome: 'blocked', value: null, stderr: 'Video unavailable in your country', durationMs: 1,
    })
    const r = await callApp(buildApp(), 'GET', '/api/stream-formats?url=https://youtu.be/abc')
    expect(r.status).toBe(403)
  })

  it('returns 502 when stdout is unparsable JSON (wrong_shape from caller)', async () => {
    boundaryMock.exec.mockResolvedValue({
      outcome: 'ok', value: 'not-json-at-all', stderr: '', durationMs: 1,
    })
    const r = await callApp(buildApp(), 'GET', '/api/stream-formats?url=https://youtu.be/abc')
    expect(r.status).toBe(502)
  })

  it('returns 400 when url query param is missing', async () => {
    const r = await callApp(buildApp(), 'GET', '/api/stream-formats')
    expect(r.status).toBe(400)
    expect(boundaryMock.exec).not.toHaveBeenCalled()
  })
})
