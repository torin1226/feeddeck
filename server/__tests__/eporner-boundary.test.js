// ============================================================
// Contract test: Eporner search() routed through boundary.fetch
//
// Locks the M7 Sprint 2 migration of the raw `fetch(...)` call inside
// _politeFetch (sources/eporner.js) over to `boundary.fetch` under the
// stable boundary name `nsfw-eporner-api`. Existing search() contract is
// preserved: failures swallow to [] (the topic-pipeline tolerates a
// missing provider). The polite-fetch serializer + rate limit are
// unchanged — boundary just wraps the inner fetch.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

const boundaryMock = { fetch: vi.fn() }
vi.mock('../boundary/index.js', () => ({ boundary: boundaryMock }))

beforeEach(() => {
  boundaryMock.fetch.mockReset()
  vi.resetModules() // reset _lastRequestAt + _fetchChain between tests
})

describe('Eporner search() — boundary integration', () => {
  it('uses boundary.fetch with the stable name "nsfw-eporner-api"', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok',
      value: JSON.stringify({ videos: [] }),
      durationMs: 1,
    })
    const ep = await import('../sources/eporner.js')
    await ep.search({ query: 'amateur' })

    expect(boundaryMock.fetch).toHaveBeenCalledOnce()
    const [url, opts] = boundaryMock.fetch.mock.calls[0]
    expect(url).toContain('https://www.eporner.com/api/v2/video/search/')
    expect(url).toContain('query=amateur')
    expect(opts.name).toBe('nsfw-eporner-api')
    expect(opts.headers['accept']).toBe('application/json')
  })

  it('returns parsed videos on ok outcome', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok',
      value: JSON.stringify({
        videos: [
          { id: 'a', url: 'https://www.eporner.com/x/a/', title: 'A',
            keywords: 'tag1', views: 100, rate: 4, length_sec: 60, added: '2026-01-01' },
        ],
      }),
      durationMs: 1,
    })
    const ep = await import('../sources/eporner.js')
    const videos = await ep.search({})
    expect(videos).toHaveLength(1)
    expect(videos[0]).toMatchObject({ id: 'a', source: 'eporner.com' })
  })

  it('returns [] on rate_limited outcome (not throw)', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'rate_limited', value: null, durationMs: 1,
    })
    const ep = await import('../sources/eporner.js')
    const videos = await ep.search({})
    expect(videos).toEqual([])
  })

  it('returns [] on timeout outcome', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'timeout', value: null, durationMs: 15000,
    })
    const ep = await import('../sources/eporner.js')
    const videos = await ep.search({})
    expect(videos).toEqual([])
  })

  it('returns [] on auth_failed outcome', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'auth_failed', value: null, durationMs: 1,
    })
    const ep = await import('../sources/eporner.js')
    const videos = await ep.search({})
    expect(videos).toEqual([])
  })

  it('returns [] on ok outcome with unparsable JSON body', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok', value: '<html>oops</html>', durationMs: 1,
    })
    const ep = await import('../sources/eporner.js')
    const videos = await ep.search({})
    expect(videos).toEqual([])
  })
})
