// ============================================================
// Contract test: pornhub-personal yt-dlp calls routed through boundary.exec
//
// Covers the 2 yt-dlp boundaries in sources/pornhub-personal.js:
//   nsfw-pornhub-personal-list — main video-list scrape (likes / subs / model)
//   nsfw-pornhub-personal-date — single-video upload_date enrichment
//
// Kept split because list-scrape and date-enrich have very different
// volume profiles (1 call per cycle vs ~30 per cycle). Aggregating
// would hide rate-limit pressure on the enrichment loop.
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

const {
  _ytdlpJsonForTest,
  _fetchUploadDateForTest,
} = await import('../sources/pornhub-personal.js')

beforeEach(() => {
  boundaryMock.exec.mockReset()
})

describe('ytdlpJson (list scrape) — boundary integration', () => {
  it('uses boundary.exec with name "nsfw-pornhub-personal-list"', async () => {
    boundaryMock.exec.mockResolvedValue({
      outcome: 'ok',
      value: JSON.stringify({ id: '1', title: 't' }) + '\n' + JSON.stringify({ id: '2', title: 't2' }) + '\n',
      stderr: '',
      durationMs: 1,
    })
    const videos = await _ytdlpJsonForTest('https://www.pornhub.com/users/x/videos')
    expect(videos).toHaveLength(2)

    const [cmd, _args, opts] = boundaryMock.exec.mock.calls[0]
    expect(cmd).toBe('yt-dlp')
    expect(opts.name).toBe('nsfw-pornhub-personal-list')
  })

  it('throws on non-ok outcome (caller controls fallback)', async () => {
    boundaryMock.exec.mockResolvedValue({
      outcome: 'rate_limited', value: null, stderr: 'HTTP 429', durationMs: 1,
      error: { stderr: 'HTTP 429', message: 'exit 1' },
    })
    await expect(_ytdlpJsonForTest('https://www.pornhub.com/x')).rejects.toThrow(/rate_limited/)
  })
})

describe('fetchUploadDate (single video) — boundary integration', () => {
  it('uses boundary.exec with name "nsfw-pornhub-personal-date"', async () => {
    boundaryMock.exec.mockResolvedValue({
      outcome: 'ok',
      value: JSON.stringify({ upload_date: '20260415' }),
      stderr: '',
      durationMs: 1,
    })
    const date = await _fetchUploadDateForTest('https://www.pornhub.com/view_video?viewkey=xyz')
    expect(date).toBe('2026-04-15')

    const [, , opts] = boundaryMock.exec.mock.calls[0]
    expect(opts.name).toBe('nsfw-pornhub-personal-date')
  })

  it('returns null (does NOT throw) on non-ok outcome — enrichment is best-effort', async () => {
    boundaryMock.exec.mockResolvedValue({
      outcome: 'timeout', value: null, stderr: '', durationMs: 30000,
      error: { stderr: '', message: 'timeout' },
    })
    const date = await _fetchUploadDateForTest('https://www.pornhub.com/x')
    expect(date).toBeNull()
  })

  it('returns null when upload_date format is unexpected', async () => {
    boundaryMock.exec.mockResolvedValue({
      outcome: 'ok',
      value: JSON.stringify({ upload_date: 'not-a-date' }),
      stderr: '',
      durationMs: 1,
    })
    const date = await _fetchUploadDateForTest('https://www.pornhub.com/x')
    expect(date).toBeNull()
  })
})
