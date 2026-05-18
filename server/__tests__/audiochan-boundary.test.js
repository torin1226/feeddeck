// ============================================================
// Contract test: AudiochanAdapter external fetches routed through boundary.exec
//
// Covers the single curl boundary in sources/audiochan.js:
//   audio-audiochan-api — REST API call to api.audiochan.com/audios
//
// Adapter is curl-backed (Node fetch is blocked by Cloudflare TLS
// fingerprinting). Each curl invocation appends `\n###HTTP_STATUS=NNN`
// to the body so the adapter can detect non-2xx without a separate
// HEAD probe.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('../database.js', () => ({
  db: { prepare: () => ({ get: () => null, run: () => ({}), all: () => [] }) },
}))

const boundaryMock = { exec: vi.fn() }
vi.mock('../boundary/index.js', () => ({ boundary: boundaryMock }))

const { AudiochanAdapter } = await import('../sources/audiochan.js')

// Helper: build a curl response body with the trailing HTTP_STATUS marker.
function withStatus(body, status) {
  return `${body}\n###HTTP_STATUS=${status}`
}

// Minimal API response shape: one keep-tag track, one no-tag track (filtered out)
const SAMPLE_PAGE = {
  results: [
    {
      id: 101,
      title: '[F4M] Comfort whispers',
      audio_file: { url: 'https://cdn.audiochan.com/audio/101.m4a' },
      duration: 600,
      is_exclusive: false,
      tags: [{ name: 'F4M' }, { name: 'comfort' }],
      user: { username: 'alice', display_name: 'Alice' },
    },
    {
      id: 102,
      title: 'Some random track',
      audio_file: { url: 'https://cdn.audiochan.com/audio/102.m4a' },
      duration: 300,
      is_exclusive: false,
      tags: [{ name: 'unrelated' }],
      user: { username: 'bob' },
    },
  ],
  next: null,
}

beforeEach(() => {
  boundaryMock.exec.mockReset()
})

describe('AudiochanAdapter.fetchTrending — boundary integration', () => {
  it('uses boundary.exec with name "audio-audiochan-api" and curl command', async () => {
    boundaryMock.exec.mockResolvedValueOnce({
      outcome: 'ok',
      value: withStatus(JSON.stringify(SAMPLE_PAGE), 200),
      durationMs: 1,
    })

    const adapter = new AudiochanAdapter()
    const items = await adapter.fetchTrending()

    const [cmd, args, opts] = boundaryMock.exec.mock.calls[0]
    expect(cmd).toBe('curl')
    expect(opts.name).toBe('audio-audiochan-api')
    expect(args).toContain('-s')
    expect(args).toContain('-L')
    // Last arg is the URL — should hit the audios endpoint with sort=trending
    expect(args[args.length - 1]).toMatch(/api\.audiochan\.com\/audios\?sort=trending/)

    // One item passes the tag filter (F4M), the unrelated track is dropped
    expect(items).toHaveLength(1)
    expect(items[0].source_domain).toBe('audiochan.com')
    expect(items[0].audio_url).toBe('https://cdn.audiochan.com/audio/101.m4a')
    expect(items[0].creator_handle).toBe('alice')
    expect(items[0].tags).toContain('f4m')
  })

  it('returns empty array (no throw) when curl outcome is non-ok', async () => {
    // The adapter swallows page-level failures via warn-and-break, so the
    // top-level fetchTrending should still resolve (empty items).
    boundaryMock.exec.mockResolvedValueOnce({
      outcome: 'rate_limited', value: null, durationMs: 1,
    })

    const adapter = new AudiochanAdapter()
    const items = await adapter.fetchTrending()
    expect(items).toEqual([])
  })

  it('stops walking pages when HTTP status is non-2xx', async () => {
    boundaryMock.exec.mockResolvedValueOnce({
      outcome: 'ok',
      value: withStatus('{"error":"forbidden"}', 403),
      durationMs: 1,
    })

    const adapter = new AudiochanAdapter()
    const items = await adapter.fetchTrending()
    expect(items).toEqual([])
    // Should not call a second page after a non-2xx status
    expect(boundaryMock.exec).toHaveBeenCalledTimes(1)
  })

  it('skips exclusive (paywalled) tracks even when tag matches', async () => {
    boundaryMock.exec.mockResolvedValueOnce({
      outcome: 'ok',
      value: withStatus(JSON.stringify({
        results: [{
          id: 200,
          title: '[F4M] Locked',
          audio_file: { url: 'https://cdn.audiochan.com/audio/200.m4a' },
          is_exclusive: true,
          tags: [{ name: 'F4M' }],
          user: { username: 'paywalled' },
        }],
        next: null,
      }), 200),
      durationMs: 1,
    })

    const adapter = new AudiochanAdapter()
    const items = await adapter.fetchTrending()
    expect(items).toEqual([])
  })

  it('extracts bracket-style tags from the title', async () => {
    boundaryMock.exec.mockResolvedValueOnce({
      outcome: 'ok',
      value: withStatus(JSON.stringify({
        results: [{
          id: 300,
          title: '[F4A] [ASMR] [Sleep] Bedtime',
          audio_file: { url: 'https://cdn.audiochan.com/audio/300.m4a' },
          tags: [{ name: 'F4A' }],
          user: { username: 'carol' },
        }],
        next: null,
      }), 200),
      durationMs: 1,
    })

    const adapter = new AudiochanAdapter()
    const items = await adapter.fetchTrending()
    expect(items).toHaveLength(1)
    expect(items[0].tags).toContain('asmr')
    expect(items[0].tags).toContain('sleep')
  })

  it('stops paginating when the API returns next=null', async () => {
    boundaryMock.exec.mockResolvedValueOnce({
      outcome: 'ok',
      value: withStatus(JSON.stringify(SAMPLE_PAGE), 200),
      durationMs: 1,
    })

    const adapter = new AudiochanAdapter()
    await adapter.fetchTrending()
    // Only one page walked even though MAX_PAGES is 3, because next was null
    expect(boundaryMock.exec).toHaveBeenCalledTimes(1)
  })

  it('drops tracks with no audio_url even when tags match', async () => {
    boundaryMock.exec.mockResolvedValueOnce({
      outcome: 'ok',
      value: withStatus(JSON.stringify({
        results: [{
          id: 400,
          title: '[F4M] Missing audio',
          audio_file: null,
          stream_url: null,
          tags: [{ name: 'F4M' }],
          user: { username: 'dave' },
        }],
        next: null,
      }), 200),
      durationMs: 1,
    })

    const adapter = new AudiochanAdapter()
    const items = await adapter.fetchTrending()
    expect(items).toEqual([])
  })
})
