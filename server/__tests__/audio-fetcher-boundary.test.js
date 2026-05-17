// ============================================================
// Contract test: audio-fetcher's Reddit fetch routed through boundary.fetch
//
// Locks the migration of the raw fetch at sources/audio-fetcher.js:107
// over to `boundary.fetch` under the stable name `audio-reddit-api`.
// Distinct from `creator-reddit-api` (video CreatorAdapter) so the tally
// distinguishes audio-subreddit traffic from video-creator traffic.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('../database.js', () => ({
  db: { prepare: () => ({ get: () => null, run: () => ({}), all: () => [] }) },
}))

vi.mock('../scoring.js', () => ({ recomputeAudioScores: () => {} }))

const boundaryMock = { fetch: vi.fn() }
vi.mock('../boundary/index.js', () => ({ boundary: boundaryMock }))

const { fetchAudioCycle, _fetchRedditAudioCreatorForTest } = await import('../sources/audio-fetcher.js')

beforeEach(() => {
  boundaryMock.fetch.mockReset()
})

describe('fetchRedditAudioCreator — boundary integration', () => {
  it('uses boundary.fetch with the stable name "audio-reddit-api"', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok',
      value: JSON.stringify({ data: { children: [] } }),
      durationMs: 1,
    })
    await _fetchRedditAudioCreatorForTest({ handle: 'gonewildaudio' }, { adapters: [] })

    expect(boundaryMock.fetch).toHaveBeenCalledOnce()
    const [url, opts] = boundaryMock.fetch.mock.calls[0]
    expect(url).toBe('https://www.reddit.com/r/gonewildaudio/hot.json?limit=25')
    expect(opts.name).toBe('audio-reddit-api')
    expect(opts.headers['Accept']).toBe('application/json')
  })

  it('throws on non-ok outcome', async () => {
    boundaryMock.fetch.mockResolvedValue({ outcome: 'rate_limited', value: null, durationMs: 1 })
    await expect(
      _fetchRedditAudioCreatorForTest({ handle: 'x' }, { adapters: [] })
    ).rejects.toThrow(/rate_limited/)
  })
})
