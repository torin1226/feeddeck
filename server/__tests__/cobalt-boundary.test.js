// ============================================================
// Contract test: CobaltAdapter._request routed through boundary.fetch
//
// Locks the M7 Sprint 2 migration of the raw `fetch(...)` POST in
// sources/cobalt.js over to `boundary.fetch` under the stable name
// `cobalt-api`. Caller contract preserved: success returns parsed JSON,
// any non-ok outcome throws (both extractMetadata and getStreamUrl rely
// on this).
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

const boundaryMock = { fetch: vi.fn() }
vi.mock('../boundary/index.js', () => ({ boundary: boundaryMock }))

const { CobaltAdapter } = await import('../sources/cobalt.js')

beforeEach(() => {
  boundaryMock.fetch.mockReset()
})

describe('CobaltAdapter._request — boundary integration', () => {
  it('uses boundary.fetch with the stable name "cobalt-api" and POST body', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok',
      value: JSON.stringify({ url: 'https://cdn/x.mp4' }),
      durationMs: 1,
    })

    const adapter = new CobaltAdapter()
    const url = await adapter.getStreamUrl('https://youtu.be/abc')

    expect(url).toBe('https://cdn/x.mp4')
    expect(boundaryMock.fetch).toHaveBeenCalledOnce()
    const [fetchUrl, opts] = boundaryMock.fetch.mock.calls[0]
    expect(fetchUrl).toMatch(/\/$/)            // cobalt POSTs to the API root
    expect(opts.name).toBe('cobalt-api')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body).url).toBe('https://youtu.be/abc')
    expect(opts.headers['Content-Type']).toBe('application/json')
  })

  it('extractMetadata returns normalized video on ok outcome', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok',
      value: JSON.stringify({ filename: 'Test Video.mp4' }),
      durationMs: 1,
    })
    const adapter = new CobaltAdapter()
    const meta = await adapter.extractMetadata('https://youtu.be/abc')
    expect(meta.title).toBe('Test Video.mp4')
  })

  it('getStreamUrl prefers result.url, falls back to picker[0].url', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok',
      value: JSON.stringify({
        picker: [
          { type: 'video', url: 'https://cdn/picked.mp4' },
          { type: 'video', url: 'https://cdn/other.mp4' },
        ],
      }),
      durationMs: 1,
    })
    const adapter = new CobaltAdapter()
    const url = await adapter.getStreamUrl('https://youtu.be/abc')
    expect(url).toBe('https://cdn/picked.mp4')
  })

  it('throws on auth_failed outcome', async () => {
    boundaryMock.fetch.mockResolvedValue({ outcome: 'auth_failed', value: null, durationMs: 1 })
    const adapter = new CobaltAdapter()
    await expect(adapter.getStreamUrl('https://youtu.be/abc')).rejects.toThrow(/auth_failed/)
  })

  it('throws on rate_limited outcome', async () => {
    boundaryMock.fetch.mockResolvedValue({ outcome: 'rate_limited', value: null, durationMs: 1 })
    const adapter = new CobaltAdapter()
    await expect(adapter.getStreamUrl('https://youtu.be/abc')).rejects.toThrow(/rate_limited/)
  })

  it('throws on timeout outcome', async () => {
    boundaryMock.fetch.mockResolvedValue({ outcome: 'timeout', value: null, durationMs: 30000 })
    const adapter = new CobaltAdapter()
    await expect(adapter.getStreamUrl('https://youtu.be/abc')).rejects.toThrow(/timeout/)
  })

  it('throws on ok outcome with unparsable JSON', async () => {
    boundaryMock.fetch.mockResolvedValue({ outcome: 'ok', value: '<html>oops</html>', durationMs: 1 })
    const adapter = new CobaltAdapter()
    await expect(adapter.getStreamUrl('https://youtu.be/abc')).rejects.toThrow()
  })

  it('throws when ok body has neither url nor picker', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok', value: JSON.stringify({ status: 'error' }), durationMs: 1,
    })
    const adapter = new CobaltAdapter()
    await expect(adapter.getStreamUrl('https://youtu.be/abc')).rejects.toThrow(/no stream URL/)
  })
})
