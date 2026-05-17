// ============================================================
// Contract test: cookie-health probes routed through boundary
//
// Covers the 2 external calls in cookie-health.js:
//   cookie-health-ytdlp     — yt-dlp probe for YouTube/PornHub auth
//   cookie-health-ig-probe  — Instagram fetch for login-redirect check
//
// The Instagram probe needs the post-redirect URL (finalUrl) to detect
// session expiry — the wrap.js extension that exposes finalUrl is
// exercised here.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('../cookies.js', () => ({
  getCookieArgs: (_url) => ['--cookies', '/tmp/c.txt'],
}))

const boundaryMock = { exec: vi.fn(), fetch: vi.fn() }
vi.mock('../boundary/index.js', () => ({ boundary: boundaryMock }))

// readFileSync needs to return a fake cookie file body so _probeInstagram
// reaches the fetch call instead of bailing with 'missing'.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    readFileSync: (path, _enc) => {
      if (String(path).includes('instagram.txt')) {
        return '.instagram.com\tTRUE\t/\tTRUE\t9999999999\tsessionid\tabc123\n'
      }
      return actual.readFileSync(path, _enc)
    },
  }
})

const { probeCookieForDomain } = await import('../cookie-health.js')

beforeEach(() => {
  boundaryMock.exec.mockReset()
  boundaryMock.fetch.mockReset()
})

describe('yt-dlp cookie probes — boundary integration', () => {
  it('uses boundary.exec with name "cookie-health-ytdlp"', async () => {
    boundaryMock.exec.mockResolvedValue({
      outcome: 'ok',
      value: JSON.stringify({ title: 'x' }) + '\n',
      stderr: '',
      durationMs: 1,
    })
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok', value: 'ok', status: 200, finalUrl: 'https://www.instagram.com/accounts/edit/', durationMs: 1,
    })

    const result = await probeCookieForDomain('youtube.com')

    expect(result.status).toBe('healthy')
    expect(boundaryMock.exec).toHaveBeenCalledOnce()
    const [cmd, _args, opts] = boundaryMock.exec.mock.calls[0]
    expect(cmd).toBe('yt-dlp')
    expect(opts.name).toBe('cookie-health-ytdlp')
  })

  it('classifies expired-cookie stderr into status=expired', async () => {
    boundaryMock.exec.mockResolvedValue({
      outcome: 'auth_failed',
      value: null,
      stderr: 'ERROR: cookies are no longer valid',
      durationMs: 1,
      error: { stderr: 'ERROR: cookies are no longer valid', message: 'exit 1' },
    })
    const result = await probeCookieForDomain('youtube.com')
    expect(result.status).toBe('expired')
  })

  it('rate-limited is reported as healthy (auth works, just throttled)', async () => {
    boundaryMock.exec.mockResolvedValue({
      outcome: 'rate_limited',
      value: null,
      stderr: 'HTTP Error 429: Too Many Requests',
      durationMs: 1,
      error: { stderr: 'HTTP Error 429: Too Many Requests', message: 'exit 1' },
    })
    const result = await probeCookieForDomain('youtube.com')
    expect(result.status).toBe('healthy')
  })
})

describe('Instagram probe — boundary integration', () => {
  it('uses boundary.fetch with name "cookie-health-ig-probe"', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok',
      value: 'ok',
      status: 200,
      finalUrl: 'https://www.instagram.com/accounts/edit/',
      durationMs: 1,
    })
    const result = await probeCookieForDomain('instagram.com')
    expect(result.status).toBe('healthy')
    expect(boundaryMock.fetch).toHaveBeenCalledOnce()
    const [url, opts] = boundaryMock.fetch.mock.calls[0]
    expect(url).toBe('https://www.instagram.com/accounts/edit/')
    expect(opts.name).toBe('cookie-health-ig-probe')
  })

  it('reports expired when finalUrl indicates a login redirect', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'ok',
      value: '<html>login form</html>',
      status: 200,
      finalUrl: 'https://www.instagram.com/accounts/login/?next=/accounts/edit/',
      durationMs: 1,
    })
    const result = await probeCookieForDomain('instagram.com')
    expect(result.status).toBe('expired')
  })

  it('reports error on non-ok outcome', async () => {
    boundaryMock.fetch.mockResolvedValue({
      outcome: 'timeout', value: null, status: null, finalUrl: null, durationMs: 10000,
    })
    const result = await probeCookieForDomain('instagram.com')
    expect(result.status).toBe('error')
  })
})
