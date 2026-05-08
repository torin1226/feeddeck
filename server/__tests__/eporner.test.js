import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================
// Phase 3 — Eporner JSON API client tests
//
// We mock the global fetch so we don't hit the real API. The unit
// tests focus on the response mapping (Eporner shape → FeedDeck shape).
// ============================================================

vi.mock('../../logger.js', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }))

const FAKE_RESPONSE = {
  videos: [
    {
      id: 'abc123',
      url: 'https://www.eporner.com/video-abc/sample-1/',
      title: 'Sample Video One',
      keywords: 'amateur, hd porn, homemade, verified amateurs',
      views: 250_000,
      rate: 4.6,
      length_sec: 600,
      added: '2026-04-15',
      default_thumb: { src: 'https://thumb/small.jpg' },
      thumbs: [
        { size: 'small', src: 'https://thumb/small.jpg' },
        { size: 'big', src: 'https://thumb/big.jpg' },
      ],
    },
    {
      id: 'def456',
      url: 'https://www.eporner.com/video-def/sample-2/',
      title: 'Sample Two',
      keywords: 'japanese, asian',
      views: 50_000,
      rate: 3.8,
      length_sec: 320,
      added: '2026-04-20',
    },
    // Edge case: missing url (must be filtered out)
    { id: 'no-url', title: 'orphan', views: 1, rate: 1 },
  ],
}

let originalFetch

beforeEach(() => {
  vi.resetModules()
  originalFetch = globalThis.fetch
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => FAKE_RESPONSE,
  }))
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('Phase 3 Eporner client', () => {
  it('search() maps response to FeedDeck shape and filters items missing url', async () => {
    const ep = await import('../sources/eporner.js')
    const out = await ep.search({ order: 'top-weekly', perPage: 30 })
    expect(out).toHaveLength(2)

    const first = out[0]
    expect(first.url).toBe('https://www.eporner.com/video-abc/sample-1/')
    expect(first.title).toBe('Sample Video One')
    expect(first.duration).toBe(600)
    expect(first.source).toBe('eporner.com')
    expect(first.uploader).toBeNull()
    expect(first.view_count).toBe(250_000)
    expect(first.like_count).toBeGreaterThan(0)            // synthesised from rate × views
    expect(first.upload_date).toBe('2026-04-15')
    expect(first.thumbnail).toBe('https://thumb/big.jpg')  // largest thumb wins
    expect(first.tags).toEqual(['amateur', 'hd porn', 'homemade', 'verified amateurs'])
  })

  it('search() falls back to default_thumb when thumbs[] is missing', async () => {
    const ep = await import('../sources/eporner.js')
    const out = await ep.search({})
    const second = out[1]
    expect(second.url).toBe('https://www.eporner.com/video-def/sample-2/')
    expect(second.thumbnail).toBeNull() // no default_thumb on this fixture
  })

  it('search() URL contains correct order + per_page params', async () => {
    const ep = await import('../sources/eporner.js')
    await ep.search({ order: 'top-rated', perPage: 15, query: 'japanese' })
    const calledUrl = globalThis.fetch.mock.calls[0][0]
    expect(calledUrl).toContain('order=top-rated')
    expect(calledUrl).toContain('per_page=15')
    expect(calledUrl).toContain('query=japanese')
  })

  it('search() returns [] on HTTP error and does not throw', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }))
    const ep = await import('../sources/eporner.js')
    const out = await ep.search({})
    expect(out).toEqual([])
  })

  it('searchTopWeekly / searchTopRated etc. are convenience wrappers', async () => {
    const ep = await import('../sources/eporner.js')
    await ep.searchTopRated('amateur')
    const calledUrl = globalThis.fetch.mock.calls[0][0]
    expect(calledUrl).toContain('order=top-rated')
    expect(calledUrl).toContain('query=amateur')
  })

  it('per_page is clamped to max 30', async () => {
    const ep = await import('../sources/eporner.js')
    await ep.search({ perPage: 999 })
    const calledUrl = globalThis.fetch.mock.calls[0][0]
    expect(calledUrl).toContain('per_page=30')
  })

  it('tags string preserves multi-word tags and lowercases', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        videos: [
          { id: 'a', url: 'https://x/a', title: 't', views: 1, rate: 1,
            keywords: 'ASIAN, Big Tits, Japanese  Big Tits ' },
        ],
      }),
    }))
    const ep = await import('../sources/eporner.js')
    const out = await ep.search({})
    expect(out[0].tags).toEqual(['asian', 'big tits', 'japanese big tits'])
  })
})
