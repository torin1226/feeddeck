// ============================================================
// Contract test: ErocastAdapter external fetches routed through boundary.exec
//
// Covers the single curl boundary in sources/erocast.js:
//   audio-erocast-genre — HTML scrape of a genre listing page on erocast.me
//
// Adapter is curl-backed (Cloudflare in front of the site). The genre
// pages embed each track as `var song_data_NN = {...};` JS blobs; the
// adapter parses those with a regex and normalizes to audio items.
// Dedup against the audio_cache table is handled via db.prepare.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

// Default DB mock: empty audio_cache (no URLs are dedup-skipped).
// Individual tests can override via vi.spyOn(db, 'prepare').
const dbMock = {
  prepare: vi.fn(() => ({ get: () => null, run: () => ({}), all: () => [] })),
}
vi.mock('../database.js', () => ({ db: dbMock }))

const boundaryMock = { exec: vi.fn() }
vi.mock('../boundary/index.js', () => ({ boundary: boundaryMock }))

const { ErocastAdapter } = await import('../sources/erocast.js')

// Build a synthetic song_data_NN blob. Erocast embeds these as JS source
// in the genre page HTML. The trailing `var` or `</script>` is required
// by the parser regex.
function songBlob(id, fields, trailing = 'var') {
  const obj = { id, ...fields }
  return `var song_data_${id} = ${JSON.stringify(obj)};\n${trailing}`
}

function pageHtml(blobs) {
  return `<html><body><script>\n${blobs.join('\n')}\n</script></body></html>`
}

beforeEach(() => {
  boundaryMock.exec.mockReset()
  dbMock.prepare.mockClear()
  dbMock.prepare.mockImplementation(() => ({ get: () => null, run: () => ({}), all: () => [] }))
})

describe('ErocastAdapter.fetchCategories — boundary integration', () => {
  it('uses boundary.exec with name "audio-erocast-genre" and curl command', async () => {
    boundaryMock.exec.mockResolvedValue({
      outcome: 'ok',
      value: pageHtml([
        songBlob(1, {
          title: 'Test track',
          file_url: 'https://wasabi.example/1.m3u8',
          permalink_url: 'https://erocast.me/track/1',
          duration: 600,
        }, '</script>'),
      ]),
      durationMs: 1,
    })

    const adapter = new ErocastAdapter()
    await adapter.fetchCategories()

    const [cmd, args, opts] = boundaryMock.exec.mock.calls[0]
    expect(cmd).toBe('curl')
    expect(opts.name).toBe('audio-erocast-genre')
    expect(args).toContain('-s')
    expect(args).toContain('-L')
    // Last arg is the URL — should hit /genre/<slug>
    expect(args[args.length - 1]).toMatch(/^https:\/\/erocast\.me\/genre\//)
  })

  it('calls boundary.exec once per genre in the rotation (3 per cycle)', async () => {
    boundaryMock.exec.mockResolvedValue({
      outcome: 'ok',
      value: pageHtml([]),
      durationMs: 1,
    })

    const adapter = new ErocastAdapter()
    await adapter.fetchCategories()

    expect(boundaryMock.exec).toHaveBeenCalledTimes(3)
    // First three genres in rotation are gfe, bfe, fwb (see GENRE_SLUGS)
    const urls = boundaryMock.exec.mock.calls.map(c => c[1][c[1].length - 1])
    expect(urls[0]).toContain('/genre/gfe')
    expect(urls[1]).toContain('/genre/bfe')
    expect(urls[2]).toContain('/genre/fwb')
  })

  it('rotates the genre offset across cycles', async () => {
    boundaryMock.exec.mockResolvedValue({
      outcome: 'ok',
      value: pageHtml([]),
      durationMs: 1,
    })

    const adapter = new ErocastAdapter()
    await adapter.fetchCategories() // gfe, bfe, fwb
    await adapter.fetchCategories() // narrative, improv, ramble-fap

    expect(boundaryMock.exec).toHaveBeenCalledTimes(6)
    const lastThree = boundaryMock.exec.mock.calls.slice(3).map(c => c[1][c[1].length - 1])
    expect(lastThree[0]).toContain('/genre/narrative')
    expect(lastThree[1]).toContain('/genre/improv')
    expect(lastThree[2]).toContain('/genre/ramble-fap')
  })

  it('normalizes a parsed track to an audio item with HLS audio_url', async () => {
    boundaryMock.exec
      .mockResolvedValueOnce({
        outcome: 'ok',
        value: pageHtml([
          songBlob(42, {
            title: '[F4M] Sample',
            file_url: 'https://wasabi.example/42.m3u8',
            permalink_url: 'https://erocast.me/track/42',
            duration: 900,
          }, '</script>'),
        ]),
        durationMs: 1,
      })
      .mockResolvedValue({
        outcome: 'ok',
        value: pageHtml([]),
        durationMs: 1,
      })

    const adapter = new ErocastAdapter()
    const items = await adapter.fetchCategories()

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      source_domain: 'erocast.me',
      url: 'https://erocast.me/track/42',
      audio_url: 'https://wasabi.example/42.m3u8',
      title: '[F4M] Sample',
      duration_sec: 900,
    })
    expect(items[0].tags).toContain('f4m')
    expect(items[0].id).toMatch(/^erocast_/)
  })

  it('skips tracks already present in audio_cache (dedup)', async () => {
    dbMock.prepare.mockImplementation(() => ({
      get: () => null,
      run: () => ({}),
      all: () => [{ url: 'https://erocast.me/track/55' }],
    }))

    boundaryMock.exec
      .mockResolvedValueOnce({
        outcome: 'ok',
        value: pageHtml([
          songBlob(55, {
            title: 'Cached',
            file_url: 'https://wasabi.example/55.m3u8',
            permalink_url: 'https://erocast.me/track/55',
          }, '</script>'),
        ]),
        durationMs: 1,
      })
      .mockResolvedValue({
        outcome: 'ok',
        value: pageHtml([]),
        durationMs: 1,
      })

    const adapter = new ErocastAdapter()
    const items = await adapter.fetchCategories()
    expect(items).toEqual([])
  })

  it('logs and continues when curl outcome is non-ok for one genre', async () => {
    // First genre rate-limited, second + third return empty pages.
    boundaryMock.exec
      .mockResolvedValueOnce({ outcome: 'rate_limited', value: null, durationMs: 1 })
      .mockResolvedValueOnce({ outcome: 'ok', value: pageHtml([]), durationMs: 1 })
      .mockResolvedValueOnce({ outcome: 'ok', value: pageHtml([]), durationMs: 1 })

    const adapter = new ErocastAdapter()
    const items = await adapter.fetchCategories()
    // Should not throw — top-level resolves with empty results
    expect(items).toEqual([])
    expect(boundaryMock.exec).toHaveBeenCalledTimes(3)
  })

  it('drops tracks with no audio_url', async () => {
    boundaryMock.exec
      .mockResolvedValueOnce({
        outcome: 'ok',
        value: pageHtml([
          songBlob(99, {
            title: 'No audio',
            file_url: null,
            stream_url: null,
            permalink_url: 'https://erocast.me/track/99',
          }, '</script>'),
        ]),
        durationMs: 1,
      })
      .mockResolvedValue({
        outcome: 'ok',
        value: pageHtml([]),
        durationMs: 1,
      })

    const adapter = new ErocastAdapter()
    const items = await adapter.fetchCategories()
    expect(items).toEqual([])
  })
})
