// ============================================================
// Contract test: ScraperAdapter HTTP boundaries routed through boundary.fetch
//
// Covers the 4 external HTTP calls in sources/scraper.js:
//   nsfw-redgifs-auth    — bearer token fetch
//   nsfw-redgifs-search  — gif search API
//   nsfw-fikfap-api      — fikfap posts API
//   nsfw-og-enrich       — Open Graph metadata HTML scrape
//
// Caller contracts preserved:
//   - searchRedGifs / searchFikFap throw on failure (callers wrap in
//     try/catch via Promise.allSettled in searchAll)
//   - _enrichWithOgTags silently skips a video on non-ok outcome
//     (it's an optional augmentation — base data already present)
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('../database.js', () => ({
  db: { prepare: () => ({ get: () => null, run: () => ({}), all: () => [] }) },
}))

const boundaryMock = { fetch: vi.fn() }
vi.mock('../boundary/index.js', () => ({ boundary: boundaryMock }))

const { ScraperAdapter } = await import('../sources/scraper.js')

beforeEach(() => {
  boundaryMock.fetch.mockReset()
})

describe('_getRedGifsToken — boundary integration', () => {
  it('uses boundary.fetch with the stable name "nsfw-redgifs-auth"', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok',
      value: JSON.stringify({ token: 'tok123' }),
      durationMs: 1,
    })
    const adapter = new ScraperAdapter()
    const tok = await adapter._getRedGifsToken()

    expect(tok).toBe('tok123')
    expect(boundaryMock.fetch).toHaveBeenCalledOnce()
    const [url, opts] = boundaryMock.fetch.mock.calls[0]
    expect(url).toBe('https://api.redgifs.com/v2/auth/temporary')
    expect(opts.name).toBe('nsfw-redgifs-auth')
  })

  it('throws on auth_failed outcome', async () => {
    boundaryMock.fetch.mockResolvedValue({ outcome: 'auth_failed', value: null, durationMs: 1 })
    const adapter = new ScraperAdapter()
    await expect(adapter._getRedGifsToken()).rejects.toThrow(/auth_failed/)
  })

  it('throws on ok outcome with unparsable JSON', async () => {
    boundaryMock.fetch.mockResolvedValue({ outcome: 'ok', value: 'oops', durationMs: 1 })
    const adapter = new ScraperAdapter()
    await expect(adapter._getRedGifsToken()).rejects.toThrow()
  })
})

describe('searchRedGifs — boundary integration', () => {
  it('uses boundary.fetch with the stable name "nsfw-redgifs-search"', async () => {
    boundaryMock.fetch
      // First call = auth token
      .mockResolvedValueOnce({ outcome: 'ok', value: JSON.stringify({ token: 't' }), durationMs: 1 })
      // Second call = search
      .mockResolvedValueOnce({ outcome: 'ok', value: JSON.stringify({ gifs: [] }), durationMs: 1 })

    const adapter = new ScraperAdapter()
    await adapter.searchRedGifs('amateur', { limit: 5 })

    expect(boundaryMock.fetch).toHaveBeenCalledTimes(2)
    const [searchUrl, searchOpts] = boundaryMock.fetch.mock.calls[1]
    expect(searchUrl).toContain('https://api.redgifs.com/v2/gifs/search')
    expect(searchUrl).toContain('search_text=amateur')
    expect(searchOpts.name).toBe('nsfw-redgifs-search')
    expect(searchOpts.headers['Authorization']).toBe('Bearer t')
  })

  it('returns mapped videos on ok outcome', async () => {
    boundaryMock.fetch
      .mockResolvedValueOnce({ outcome: 'ok', value: JSON.stringify({ token: 't' }), durationMs: 1 })
      .mockResolvedValueOnce({
        outcome: 'ok',
        value: JSON.stringify({
          gifs: [
            { id: 'g1', description: 'd', urls: { hd: 'https://cdn/g1.mp4', poster: 'https://cdn/g1.jpg' },
              duration: 30, views: 100, likes: 5, createDate: 1700000000, userName: 'u' },
          ],
        }),
        durationMs: 1,
      })

    const adapter = new ScraperAdapter()
    const videos = await adapter.searchRedGifs('x', { limit: 5 })
    expect(videos).toHaveLength(1)
    expect(videos[0]).toMatchObject({ id: 'g1', source: 'redgifs.com', stream_url: 'https://cdn/g1.mp4' })
  })

  it('throws on rate_limited outcome', async () => {
    boundaryMock.fetch
      .mockResolvedValueOnce({ outcome: 'ok', value: JSON.stringify({ token: 't' }), durationMs: 1 })
      .mockResolvedValueOnce({ outcome: 'rate_limited', value: null, durationMs: 1 })

    const adapter = new ScraperAdapter()
    await expect(adapter.searchRedGifs('x')).rejects.toThrow(/rate_limited/)
  })
})

describe('searchFikFap — boundary integration', () => {
  it('uses boundary.fetch with the stable name "nsfw-fikfap-api"', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok',
      value: JSON.stringify([]), // FikFap returns a bare array
      durationMs: 1,
    })
    const adapter = new ScraperAdapter()
    await adapter.searchFikFap('fikfap.com/trending', { limit: 5 })

    expect(boundaryMock.fetch).toHaveBeenCalledOnce()
    const [url, opts] = boundaryMock.fetch.mock.calls[0]
    expect(url).toContain('https://api.fikfap.com/posts')
    expect(url).toContain('sort=trending')
    expect(opts.name).toBe('nsfw-fikfap-api')
    expect(opts.headers['authorization-anonymous']).toBeTruthy()
  })

  it('throws on auth_failed outcome', async () => {
    boundaryMock.fetch.mockResolvedValue({ outcome: 'auth_failed', value: null, durationMs: 1 })
    const adapter = new ScraperAdapter()
    await expect(adapter.searchFikFap('q')).rejects.toThrow(/auth_failed/)
  })

  it('throws when ok body is not the expected array shape', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok',
      value: JSON.stringify({ error: 'not an array' }),
      durationMs: 1,
    })
    const adapter = new ScraperAdapter()
    await expect(adapter.searchFikFap('q')).rejects.toThrow(/unexpected format/)
  })
})

describe('_enrichWithOgTags — boundary integration', () => {
  it('uses boundary.fetch with the stable name "nsfw-og-enrich"', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok',
      value: '<html><meta property="og:title" content="Real Title"></html>',
      durationMs: 1,
    })

    const adapter = new ScraperAdapter()
    // Pass a non-existent cookie file path; parseNetscapeCookies catches the
    // read failure and returns []. That's fine — we only care about boundary args.
    const enriched = await adapter._enrichWithOgTags(
      [{ url: 'https://x.test/v/1', title: 'shortcode' }],
      '/tmp/does-not-exist.txt'
    )

    expect(boundaryMock.fetch).toHaveBeenCalledOnce()
    const [url, opts] = boundaryMock.fetch.mock.calls[0]
    expect(url).toBe('https://x.test/v/1')
    expect(opts.name).toBe('nsfw-og-enrich')
    expect(enriched[0].title).toBe('Real Title')
  })

  it('skips (does NOT throw) when a video fetch returns non-ok outcome', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'timeout', value: null, durationMs: 10000,
    })
    const adapter = new ScraperAdapter()
    const enriched = await adapter._enrichWithOgTags(
      [{ url: 'https://x.test/v/1', title: 'orig' }],
      '/tmp/does-not-exist.txt'
    )
    // Video survives, just un-enriched (title unchanged).
    expect(enriched).toHaveLength(1)
    expect(enriched[0].title).toBe('orig')
  })
})
