// ============================================================
// Contract test: /api/proxy-stream + /api/hls-proxy routed
// through boundary.streamingFetch (M7.6 Sprint 2)
//
// Locks the three stable boundary names:
//   - proxy-stream         (binary MP4 / progressive bytes)
//   - hls-proxy-playlist   (.m3u8 manifest fetch + rewrite)
//   - hls-proxy-segment    (.ts segment bytes)
//
// And the outcome → HTTP status mapping (mirrors stream.js statusForOutcome).
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'

vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('../database.js', () => ({
  db: { prepare: () => ({ get: () => null, run: () => ({}), all: () => [] }) },
}))

const boundaryMock = { streamingFetch: vi.fn(), exec: vi.fn(), fetch: vi.fn() }
vi.mock('../boundary/index.js', () => ({ boundary: boundaryMock }))

const { default: streamRouter } = await import('../routes/stream.js')

beforeEach(() => {
  boundaryMock.streamingFetch.mockReset()
})

function callApp(method, url, headers = {}) {
  return new Promise((resolve, reject) => {
    const app = express()
    app.use(streamRouter)
    const req = {
      method, url,
      headers,
      query: Object.fromEntries(new URL('http://x' + url).searchParams),
      params: {},
      path: url.split('?')[0],
      on(event, cb) { if (event === 'end') queueMicrotask(cb) },
      pipe() {}, socket: { destroy() {} }, get() { return null },
    }
    let payload = null
    const responseHeaders = {}
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this },
      json(data) { payload = data; resolve({ status: this.statusCode, body: data, headers: responseHeaders }) },
      send(data) { payload = data; resolve({ status: this.statusCode, body: data, headers: responseHeaders }) },
      setHeader(k, v) { responseHeaders[k.toLowerCase()] = v },
      end() { resolve({ status: this.statusCode, body: payload, headers: responseHeaders }) },
      on() {},
      get writableEnded() { return false },
      get headersSent() { return false },
    }
    try { app(req, res, (err) => { if (err) reject(err) }) } catch (err) { reject(err) }
  })
}

// Headers map that mimics fetch Response.headers.get(name)
function fakeHeaders(obj) {
  return {
    get(name) {
      const k = Object.keys(obj).find(k => k.toLowerCase() === name.toLowerCase())
      return k ? obj[k] : null
    },
  }
}

// Minimal web ReadableStream that emits one chunk and closes. Required
// because the proxy routes call Readable.fromWeb(upstream.body) which
// validates the arg is a real ReadableStream.
function emptyWebStream() {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0]))
      controller.close()
    },
  })
}

describe('/api/proxy-stream — boundary.streamingFetch integration', () => {
  it('uses boundary.streamingFetch with stable name "proxy-stream"', async () => {
    boundaryMock.streamingFetch.mockResolvedValue({
      outcome: 'ok',
      response: {
        status: 200,
        headers: fakeHeaders({ 'content-type': 'video/mp4' }),
        body: emptyWebStream(),
      },
      status: 200,
      durationMs: 5,
    })
    await callApp('GET', '/api/proxy-stream?url=https%3A%2F%2Fcdn.googlevideo.com%2Fv.mp4').catch(() => {})
    expect(boundaryMock.streamingFetch).toHaveBeenCalled()
    const [callUrl, opts] = boundaryMock.streamingFetch.mock.calls[0]
    expect(callUrl).toBe('https://cdn.googlevideo.com/v.mp4')
    expect(opts.name).toBe('proxy-stream')
    expect(opts.headers['User-Agent']).toMatch(/Mozilla/)
    expect(opts.headers['Referer']).toBeTruthy()
    expect(opts.signal).toBeInstanceOf(AbortSignal)
  })

  it('forwards Range header from request to upstream', async () => {
    boundaryMock.streamingFetch.mockResolvedValue({
      outcome: 'ok',
      response: { status: 206, headers: fakeHeaders({}), body: emptyWebStream() },
      status: 206,
      durationMs: 1,
    })
    await callApp('GET', '/api/proxy-stream?url=https%3A%2F%2Fcdn.googlevideo.com%2Fv.mp4', {
      range: 'bytes=0-1023',
    }).catch(() => {})
    const [, opts] = boundaryMock.streamingFetch.mock.calls[0]
    expect(opts.headers['Range']).toBe('bytes=0-1023')
  })

  it('returns 400 on missing url query', async () => {
    const r = await callApp('GET', '/api/proxy-stream')
    expect(r.status).toBe(400)
    expect(boundaryMock.streamingFetch).not.toHaveBeenCalled()
  })

  it('returns 403 on disallowed CDN domain (SSRF guard)', async () => {
    const r = await callApp('GET', '/api/proxy-stream?url=https%3A%2F%2Fevil.example.com%2Fx')
    expect(r.status).toBe(403)
    expect(boundaryMock.streamingFetch).not.toHaveBeenCalled()
  })

  it('maps timeout outcome to 504', async () => {
    boundaryMock.streamingFetch.mockResolvedValue({
      outcome: 'timeout', response: null, status: null, durationMs: 15000,
    })
    const r = await callApp('GET', '/api/proxy-stream?url=https%3A%2F%2Fcdn.googlevideo.com%2Fv.mp4')
    expect(r.status).toBe(504)
  })

  it('maps auth_failed outcome to 502 (CDN expired token)', async () => {
    boundaryMock.streamingFetch.mockResolvedValue({
      outcome: 'auth_failed', response: { status: 403, headers: fakeHeaders({}) }, status: 403, durationMs: 100,
    })
    const r = await callApp('GET', '/api/proxy-stream?url=https%3A%2F%2Fcdn.googlevideo.com%2Fv.mp4')
    expect(r.status).toBe(502)
  })

  it('maps rate_limited outcome to 429', async () => {
    boundaryMock.streamingFetch.mockResolvedValue({
      outcome: 'rate_limited', response: { status: 429, headers: fakeHeaders({}) }, status: 429, durationMs: 50,
    })
    const r = await callApp('GET', '/api/proxy-stream?url=https%3A%2F%2Fcdn.googlevideo.com%2Fv.mp4')
    expect(r.status).toBe(429)
  })

  it('maps blocked outcome to 403', async () => {
    boundaryMock.streamingFetch.mockResolvedValue({
      outcome: 'blocked', response: { status: 451, headers: fakeHeaders({}) }, status: 451, durationMs: 50,
    })
    const r = await callApp('GET', '/api/proxy-stream?url=https%3A%2F%2Fcdn.googlevideo.com%2Fv.mp4')
    expect(r.status).toBe(403)
  })

  it('ends cleanly on 2xx with no body (204-shaped response)', async () => {
    boundaryMock.streamingFetch.mockResolvedValue({
      outcome: 'ok',
      response: { status: 204, headers: fakeHeaders({}), body: null },
      status: 204,
      durationMs: 1,
    })
    const r = await callApp('GET', '/api/proxy-stream?url=https%3A%2F%2Fcdn.googlevideo.com%2Fv.mp4')
    expect(r.status).toBe(204)
  })

  it('maps unknown_error outcome to 500 (covers CDN 404 / 5xx)', async () => {
    boundaryMock.streamingFetch.mockResolvedValue({
      outcome: 'unknown_error', response: { status: 503, headers: fakeHeaders({}) }, status: 503, durationMs: 50,
    })
    const r = await callApp('GET', '/api/proxy-stream?url=https%3A%2F%2Fcdn.googlevideo.com%2Fv.mp4')
    expect(r.status).toBe(500)
  })
})

describe('/api/hls-proxy — boundary.streamingFetch integration', () => {
  it('uses stable name "hls-proxy-playlist" for .m3u8 fetches and rewrites segment URLs', async () => {
    const playlistBody = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXTINF:6.0,',
      'seg-0.ts',
      '#EXTINF:6.0,',
      'https://cdn.googlevideo.com/abs/seg-1.ts',
      '#EXT-X-ENDLIST',
    ].join('\n')
    boundaryMock.streamingFetch.mockResolvedValue({
      outcome: 'ok',
      response: {
        status: 200,
        headers: fakeHeaders({ 'content-type': 'application/vnd.apple.mpegurl' }),
        text: async () => playlistBody,
      },
      status: 200,
      durationMs: 10,
    })
    const r = await callApp(
      'GET',
      '/api/hls-proxy?url=https%3A%2F%2Fcdn.googlevideo.com%2Fpath%2Findex.m3u8',
    )
    expect(boundaryMock.streamingFetch).toHaveBeenCalledOnce()
    const [callUrl, opts] = boundaryMock.streamingFetch.mock.calls[0]
    expect(callUrl).toBe('https://cdn.googlevideo.com/path/index.m3u8')
    expect(opts.name).toBe('hls-proxy-playlist')

    expect(r.status).toBe(200)
    // Relative seg URL rewritten with resolved base + proxy prefix
    expect(r.body).toContain('/api/hls-proxy?url=https%3A%2F%2Fcdn.googlevideo.com%2Fpath%2Fseg-0.ts')
    // Absolute seg URL rewritten through proxy as well
    expect(r.body).toContain('/api/hls-proxy?url=https%3A%2F%2Fcdn.googlevideo.com%2Fabs%2Fseg-1.ts')
    // Header lines preserved
    expect(r.body).toContain('#EXTM3U')
    expect(r.headers['content-type']).toBe('application/vnd.apple.mpegurl')
    expect(r.headers['cache-control']).toBe('no-store')
  })

  it('uses stable name "hls-proxy-segment" for non-m3u8 (segment) fetches', async () => {
    boundaryMock.streamingFetch.mockResolvedValue({
      outcome: 'ok',
      response: {
        status: 200,
        headers: fakeHeaders({ 'content-type': 'video/mp2t', 'content-length': '12345' }),
        body: emptyWebStream(),
      },
      status: 200,
      durationMs: 8,
    })
    await callApp(
      'GET',
      '/api/hls-proxy?url=https%3A%2F%2Fcdn.googlevideo.com%2Fpath%2Fseg-0.ts',
    ).catch(() => {})
    expect(boundaryMock.streamingFetch).toHaveBeenCalledOnce()
    const [, opts] = boundaryMock.streamingFetch.mock.calls[0]
    expect(opts.name).toBe('hls-proxy-segment')
  })

  it('maps timeout on playlist fetch to 504', async () => {
    boundaryMock.streamingFetch.mockResolvedValue({
      outcome: 'timeout', response: null, status: null, durationMs: 15000,
    })
    const r = await callApp('GET', '/api/hls-proxy?url=https%3A%2F%2Fcdn.googlevideo.com%2Fx.m3u8')
    expect(r.status).toBe(504)
  })

  it('maps auth_failed on segment (mid-playback CDN token expiry) to 502', async () => {
    boundaryMock.streamingFetch.mockResolvedValue({
      outcome: 'auth_failed', response: { status: 403, headers: fakeHeaders({}) }, status: 403, durationMs: 50,
    })
    const r = await callApp('GET', '/api/hls-proxy?url=https%3A%2F%2Fcdn.googlevideo.com%2Fseg-9.ts')
    expect(r.status).toBe(502)
  })

  it('returns 403 on disallowed CDN domain', async () => {
    const r = await callApp('GET', '/api/hls-proxy?url=https%3A%2F%2Fevil.example.com%2Fx.m3u8')
    expect(r.status).toBe(403)
    expect(boundaryMock.streamingFetch).not.toHaveBeenCalled()
  })

  it('returns 400 on missing url query', async () => {
    const r = await callApp('GET', '/api/hls-proxy')
    expect(r.status).toBe(400)
    expect(boundaryMock.streamingFetch).not.toHaveBeenCalled()
  })

  it('forwards Range header on segment fetches', async () => {
    boundaryMock.streamingFetch.mockResolvedValue({
      outcome: 'ok',
      response: { status: 206, headers: fakeHeaders({}), body: emptyWebStream() },
      status: 206,
      durationMs: 1,
    })
    await callApp('GET', '/api/hls-proxy?url=https%3A%2F%2Fcdn.googlevideo.com%2Fseg-0.ts', {
      range: 'bytes=500-999',
    }).catch(() => {})
    const [, opts] = boundaryMock.streamingFetch.mock.calls[0]
    expect(opts.headers['Range']).toBe('bytes=500-999')
  })
})
