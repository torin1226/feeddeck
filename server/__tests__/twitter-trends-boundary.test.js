// ============================================================
// Contract test: twitter-trends external fetches routed through boundary.fetch
//
// Covers the 4 boundary names in sources/twitter-trends.js:
//   twitter-trends-v11           — legacy v1.1 trends endpoint
//   twitter-trends-explore-page  — explore page HTML
//   twitter-trends-bundle-js     — JS bundle scan for queryId
//   twitter-trends-graphql       — GraphQL trends call
//
// Outermost contract preserved: fetchUsTrends() never throws to the
// caller and returns [] on total failure.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('../cookies.js', () => ({
  parseCookieFile: () => ({ cookies: { auth_token: 'a', ct0: 'c' } }),
}))

const boundaryMock = { fetch: vi.fn() }
vi.mock('../boundary/index.js', () => ({ boundary: boundaryMock }))

const { fetchUsTrends } = await import('../sources/twitter-trends.js')

beforeEach(() => {
  boundaryMock.fetch.mockReset()
})

describe('fetchUsTrends — boundary integration', () => {
  it('hits twitter-trends-v11 first and returns trends on ok outcome', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok',
      value: JSON.stringify([{ trends: [{ name: 'Trending' }, { name: '#Hashtag' }] }]),
      durationMs: 1,
    })
    const trends = await fetchUsTrends()
    expect(trends).toEqual(['Trending', 'Hashtag'])

    const [url, opts] = boundaryMock.fetch.mock.calls[0]
    expect(url).toContain('api.x.com/1.1/trends/place.json')
    expect(opts.name).toBe('twitter-trends-v11')
  })

  it('falls back to GraphQL path when v1.1 returns non-ok and uses three more boundary names', async () => {
    boundaryMock.fetch
      // 1: v1.1 fails
      .mockResolvedValueOnce({ outcome: 'rate_limited', value: null, durationMs: 1 })
      // 2: explore page returns HTML containing one bundle URL
      .mockResolvedValueOnce({
        outcome: 'ok',
        value: 'preamble <script src="https://abs.twimg.com/responsive-web/client-web/bundle.js"></script> end',
        durationMs: 1,
      })
      // 3: bundle JS contains queryId
      .mockResolvedValueOnce({
        outcome: 'ok',
        value: 'foo queryId:"abcDEF12345",operationName:"GenericTimelineByRestId" bar',
        durationMs: 1,
      })
      // 4: GraphQL returns trends
      .mockResolvedValueOnce({
        outcome: 'ok',
        value: JSON.stringify({ trends: [{ name: 'GraphTrend', trend_metadata: {} }] }),
        durationMs: 1,
      })

    const trends = await fetchUsTrends()
    expect(trends).toEqual(['GraphTrend'])

    const names = boundaryMock.fetch.mock.calls.map(c => c[1].name)
    expect(names).toEqual([
      'twitter-trends-v11',
      'twitter-trends-explore-page',
      'twitter-trends-bundle-js',
      'twitter-trends-graphql',
    ])
  })

  it('returns [] (never throws) when both paths fail', async () => {
    boundaryMock.fetch.mockResolvedValue({ outcome: 'auth_failed', value: null, durationMs: 1 })
    const trends = await fetchUsTrends()
    expect(trends).toEqual([])
  })

  it('returns [] when v1.1 returns ok but yields zero trends, AND GraphQL path also fails', async () => {
    boundaryMock.fetch
      .mockResolvedValueOnce({ outcome: 'ok', value: JSON.stringify([{ trends: [] }]), durationMs: 1 })
      // explore page fails — GraphQL path bails
      .mockResolvedValue({ outcome: 'timeout', value: null, durationMs: 1 })
    const trends = await fetchUsTrends()
    expect(trends).toEqual([])
  })
})
