// ============================================================
// Contract test: CreatorAdapter._fetchReddit routed through boundary.fetch
//
// Locks the M7 Sprint 2 migration of the raw `fetch(...)` call at
// sources/creator.js:195 over to `boundary.fetch` under the stable
// boundary name `creator-reddit-api`. Existing caller contract is
// preserved: success returns a videos array; any non-ok outcome
// throws so the caller's failure counter increments.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('../database.js', () => ({
  db: { prepare: () => ({ get: () => null, run: () => ({}), all: () => [] }) },
}))

// Stub ytdlp.js so importing creator.js doesn't try to resolve the
// yt-dlp binary at module-load time.
vi.mock('../sources/ytdlp.js', () => ({
  ytdlpExec: vi.fn(async () => ''),
  YTDLP_TIMEOUT: 60_000,
}))

const boundaryMock = { fetch: vi.fn() }
vi.mock('../boundary/index.js', () => ({ boundary: boundaryMock }))

const { CreatorAdapter } = await import('../sources/creator.js')

beforeEach(() => {
  boundaryMock.fetch.mockReset()
})

const SAMPLE_REDDIT_JSON = JSON.stringify({
  data: {
    children: [
      {
        data: {
          id: 'abc',
          title: 'Native Reddit video',
          permalink: '/r/videos/comments/abc/',
          subreddit: 'videos',
          ups: 100,
          created_utc: 1700000000,
          is_video: true,
          stickied: false,
          media: { reddit_video: { fallback_url: 'https://v.redd.it/abc.mp4', duration: 30, height: 1080, width: 1920 } },
        },
      },
      {
        data: {
          id: 'xyz',
          title: 'Cross-posted YouTube',
          permalink: '/r/videos/comments/xyz/',
          subreddit: 'videos',
          ups: 50,
          created_utc: 1700000001,
          is_video: false,
          is_self: false,
          url: 'https://www.youtube.com/watch?v=zzz',
          stickied: false,
        },
      },
      {
        data: {
          id: 'sticky',
          title: 'Sticky announcement',
          permalink: '/r/videos/comments/sticky/',
          subreddit: 'videos',
          ups: 999,
          stickied: true,
          is_video: false,
        },
      },
      {
        data: {
          id: 'textpost',
          title: 'Just text',
          permalink: '/r/videos/comments/textpost/',
          subreddit: 'videos',
          ups: 5,
          stickied: false,
          is_video: false,
          is_self: true,
          url: 'https://reddit.com/r/videos/comments/textpost/',
        },
      },
    ],
  },
})

describe('CreatorAdapter._fetchReddit — boundary integration', () => {
  it('uses boundary.fetch with the stable name "creator-reddit-api"', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok', value: SAMPLE_REDDIT_JSON, durationMs: 1,
    })
    const adapter = new CreatorAdapter()
    await adapter._fetchReddit({ handle: 'videos' })

    expect(boundaryMock.fetch).toHaveBeenCalledOnce()
    const [url, opts] = boundaryMock.fetch.mock.calls[0]
    expect(url).toBe('https://www.reddit.com/r/videos/hot.json?limit=15')
    expect(opts.name).toBe('creator-reddit-api')
    expect(opts.headers['User-Agent']).toContain('FeedDeck')
    expect(opts.headers['Accept']).toBe('application/json')
  })

  it('honors creator.url when provided (override of default subreddit URL)', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok', value: SAMPLE_REDDIT_JSON, durationMs: 1,
    })
    const adapter = new CreatorAdapter()
    await adapter._fetchReddit({ handle: 'x', url: 'https://www.reddit.com/user/foo/submitted.json' })

    const [url] = boundaryMock.fetch.mock.calls[0]
    expect(url).toBe('https://www.reddit.com/user/foo/submitted.json')
  })

  it('returns parsed videos on ok outcome, filtering stickied + text posts', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok', value: SAMPLE_REDDIT_JSON, durationMs: 1,
    })
    const adapter = new CreatorAdapter()
    const videos = await adapter._fetchReddit({ handle: 'videos' })

    expect(videos).toHaveLength(2)
    expect(videos[0]).toMatchObject({
      id: 'reddit_abc',
      source: 'reddit',
      streamUrl: 'https://v.redd.it/abc.mp4',
      orientation: 'horizontal', // height(1080) < width(1920) → horizontal
    })
    expect(videos[1]).toMatchObject({
      id: 'reddit_xyz',
      source: 'reddit',
      url: 'https://www.youtube.com/watch?v=zzz',
    })
  })

  it('throws (does NOT silently return []) on auth_failed outcome', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'auth_failed', value: null, durationMs: 1,
    })
    const adapter = new CreatorAdapter()
    await expect(adapter._fetchReddit({ handle: 'videos' })).rejects.toThrow(/auth_failed/)
  })

  it('throws on rate_limited outcome', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'rate_limited', value: null, durationMs: 1,
    })
    const adapter = new CreatorAdapter()
    await expect(adapter._fetchReddit({ handle: 'videos' })).rejects.toThrow(/rate_limited/)
  })

  it('throws on timeout outcome', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'timeout', value: null, durationMs: 15000,
    })
    const adapter = new CreatorAdapter()
    await expect(adapter._fetchReddit({ handle: 'videos' })).rejects.toThrow(/timeout/)
  })

  it('throws on ok outcome with unparsable JSON', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok', value: 'not json at all', durationMs: 1,
    })
    const adapter = new CreatorAdapter()
    await expect(adapter._fetchReddit({ handle: 'videos' })).rejects.toThrow()
  })
})
