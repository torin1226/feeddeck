// ============================================================
// Contract test: pornhub-subs-sync yt-dlp call routed through boundary.exec
//
// Covers the 1 yt-dlp boundary in sources/pornhub-subs-sync.js:
//   nsfw-pornhub-subs-list — channel video-list scrape for subscribed creators
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('../database.js', () => ({
  db: { prepare: () => ({ get: () => null, run: () => ({}), all: () => [] }) },
}))

vi.mock('../cookies.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getCookieArgs: () => ['--cookies', '/tmp/c.txt'], parseCookieFile: () => ({ cookies: {} }) }
})

const boundaryMock = { exec: vi.fn() }
vi.mock('../boundary/index.js', () => ({ boundary: boundaryMock }))

const { _ytdlpJsonForTest } = await import('../sources/pornhub-subs-sync.js')

beforeEach(() => {
  boundaryMock.exec.mockReset()
})

describe('pornhub-subs-sync ytdlpJson — boundary integration', () => {
  it('uses boundary.exec with name "nsfw-pornhub-subs-list"', async () => {
    boundaryMock.exec.mockResolvedValue({
      outcome: 'ok',
      value: JSON.stringify({ id: '1' }) + '\n',
      stderr: '',
      durationMs: 1,
    })
    const videos = await _ytdlpJsonForTest('https://www.pornhub.com/model/x/videos')
    expect(videos).toHaveLength(1)
    const [, , opts] = boundaryMock.exec.mock.calls[0]
    expect(opts.name).toBe('nsfw-pornhub-subs-list')
  })

  it('throws on non-ok outcome', async () => {
    boundaryMock.exec.mockResolvedValue({
      outcome: 'auth_failed', value: null, stderr: 'cookies are no longer valid', durationMs: 1,
      error: { stderr: 'cookies are no longer valid', message: 'exit 1' },
    })
    await expect(_ytdlpJsonForTest('https://www.pornhub.com/x')).rejects.toThrow(/auth_failed/)
  })
})
