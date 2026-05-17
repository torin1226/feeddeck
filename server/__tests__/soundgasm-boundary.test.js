// ============================================================
// Contract test: SoundgasmAdapter external fetches routed through boundary.fetch
//
// Covers the 3 boundary names in sources/soundgasm.js:
//   audio-soundgasm-user    — creator user-page HTML scrape
//   audio-soundgasm-post    — per-post HTML scrape
//   audio-soundgasm-resolve — standalone URL → media URL resolution
//                             (used by getStreamUrl + extractMetadata)
//
// Caller contracts preserved: _fetchCreator/_fetchPost throw on failure
// (outer loop catches per-creator/per-post); getStreamUrl and
// extractMetadata throw to their callers.
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

const { SoundgasmAdapter } = await import('../sources/soundgasm.js')

beforeEach(() => {
  boundaryMock.fetch.mockReset()
})

describe('SoundgasmAdapter._fetchCreator — boundary integration', () => {
  it('uses boundary.fetch with the stable name "audio-soundgasm-user"', async () => {
    // User page returns one post link → _fetchPost called → resolves with media URL.
    boundaryMock.fetch
      .mockResolvedValueOnce({
        outcome: 'ok',
        value: '<div class="sound-details"><a href="https://soundgasm.net/u/alice/Hello">Hello</a>',
        durationMs: 1,
      })
      .mockResolvedValueOnce({
        outcome: 'ok',
        value: 'https://media.soundgasm.net/sounds/abcdef.m4a',
        durationMs: 1,
      })

    const adapter = new SoundgasmAdapter()
    const items = await adapter._fetchCreator({ handle: 'alice' })

    expect(items).toHaveLength(1)
    expect(items[0].audio_url).toBe('https://media.soundgasm.net/sounds/abcdef.m4a')
    expect(boundaryMock.fetch.mock.calls[0][1].name).toBe('audio-soundgasm-user')
    expect(boundaryMock.fetch.mock.calls[1][1].name).toBe('audio-soundgasm-post')
  })

  it('throws on user-page non-ok outcome', async () => {
    boundaryMock.fetch.mockResolvedValue({ outcome: 'rate_limited', value: null, durationMs: 1 })
    const adapter = new SoundgasmAdapter()
    await expect(adapter._fetchCreator({ handle: 'a' })).rejects.toThrow(/rate_limited/)
  })
})

describe('SoundgasmAdapter.getStreamUrl — boundary integration', () => {
  it('uses boundary.fetch with "audio-soundgasm-resolve" and returns the media URL', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok',
      value: 'wrapper https://media.soundgasm.net/sounds/abc123.m4a wrapper',
      durationMs: 1,
    })
    const adapter = new SoundgasmAdapter()
    const url = await adapter.getStreamUrl('https://soundgasm.net/u/a/post')
    expect(url).toBe('https://media.soundgasm.net/sounds/abc123.m4a'.toLowerCase())
    expect(boundaryMock.fetch.mock.calls[0][1].name).toBe('audio-soundgasm-resolve')
  })

  it('throws on non-ok outcome', async () => {
    boundaryMock.fetch.mockResolvedValue({ outcome: 'timeout', value: null, durationMs: 15000 })
    const adapter = new SoundgasmAdapter()
    await expect(adapter.getStreamUrl('https://soundgasm.net/u/a/post')).rejects.toThrow(/timeout/)
  })
})

describe('SoundgasmAdapter.extractMetadata — boundary integration', () => {
  it('shares the "audio-soundgasm-resolve" boundary name', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok',
      value: '<div class="jp-title">Real Title</div> https://media.soundgasm.net/sounds/abc123.m4a',
      durationMs: 1,
    })
    const adapter = new SoundgasmAdapter()
    const meta = await adapter.extractMetadata('https://soundgasm.net/u/alice/post')
    expect(meta.title).toBe('Real Title')
    expect(boundaryMock.fetch.mock.calls[0][1].name).toBe('audio-soundgasm-resolve')
  })
})
