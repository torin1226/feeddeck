import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

const sink = await import('../sink.js')
const { boundary } = await import('../wrap.js')

beforeEach(() => {
  sink.resetForTest()
})

describe('boundary.fetch(url, opts)', () => {
  it('returns { outcome: ok, value, durationMs } on a 2xx with body', async () => {
    const fakeFetch = vi.fn(async () => ({
      status: 200,
      text: async () => '{"items":[1,2,3]}',
    }))
    const r = await boundary.fetch('https://example.test/x', {
      name: 'test-fetch',
      fetchImpl: fakeFetch,
    })
    expect(r.outcome).toBe('ok')
    expect(r.value).toBe('{"items":[1,2,3]}')
    expect(typeof r.durationMs).toBe('number')
    expect(sink.snapshot()['test-fetch'].ok).toBe(1)
  })

  it('classifies a 401 as auth_failed and records to sink', async () => {
    const fakeFetch = vi.fn(async () => ({ status: 401, text: async () => '' }))
    const r = await boundary.fetch('https://example.test/x', {
      name: 'test-fetch',
      fetchImpl: fakeFetch,
    })
    expect(r.outcome).toBe('auth_failed')
    expect(sink.snapshot()['test-fetch'].auth_failed).toBe(1)
  })

  it('classifies an AbortError as timeout', async () => {
    const fakeFetch = vi.fn(async () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    })
    const r = await boundary.fetch('https://example.test/x', {
      name: 'test-fetch',
      timeoutMs: 100,
      fetchImpl: fakeFetch,
    })
    expect(r.outcome).toBe('timeout')
    expect(r.value).toBeNull()
  })

  it('passes the AbortSignal it created to the underlying fetch', async () => {
    const fakeFetch = vi.fn(async (_url, opts) => {
      expect(opts.signal).toBeInstanceOf(AbortSignal)
      return { status: 200, text: async () => 'ok' }
    })
    await boundary.fetch('https://x.test', {
      name: 'test-fetch',
      timeoutMs: 5000,
      fetchImpl: fakeFetch,
    })
    expect(fakeFetch).toHaveBeenCalledOnce()
  })
})

describe('boundary.exec(cmd, args, opts)', () => {
  it('returns ok with stdout when the command succeeds', async () => {
    const fakeExec = vi.fn(async () => ({ stdout: 'video-url-here', stderr: '' }))
    const r = await boundary.exec('yt-dlp', ['--get-url', 'x'], {
      name: 'yt-dlp-stream-url',
      execImpl: fakeExec,
    })
    expect(r.outcome).toBe('ok')
    expect(r.value).toBe('video-url-here')
  })

  it('classifies stderr "cookies are no longer valid" as auth_failed', async () => {
    const fakeExec = vi.fn(async () => {
      const err = new Error('exit 1')
      err.stderr = 'ERROR: cookies are no longer valid'
      throw err
    })
    const r = await boundary.exec('yt-dlp', ['x'], {
      name: 'yt-dlp-stream-url',
      execImpl: fakeExec,
    })
    expect(r.outcome).toBe('auth_failed')
  })

  it('classifies HTTP Error 429 in stderr as rate_limited', async () => {
    const fakeExec = vi.fn(async () => {
      const err = new Error('exit 1')
      err.stderr = 'HTTP Error 429: Too Many Requests'
      throw err
    })
    const r = await boundary.exec('yt-dlp', ['x'], {
      name: 'yt-dlp-stream-url',
      execImpl: fakeExec,
    })
    expect(r.outcome).toBe('rate_limited')
  })

  it('returns stderr on the error path too', async () => {
    const fakeExec = vi.fn(async () => {
      const err = new Error('exit 1')
      err.stderr = 'partial output then a problem'
      throw err
    })
    const r = await boundary.exec('yt-dlp', ['x'], {
      name: 'yt-dlp-stream-url',
      execImpl: fakeExec,
    })
    expect(r.outcome).not.toBe('ok')
    expect(r.stderr).toBe('partial output then a problem')
  })
})

describe('boundary.readCookie(path, opts)', () => {
  it('returns ok with file contents when readable and non-empty', async () => {
    const fakeRead = vi.fn(async () => '# Netscape\n.example\tTRUE\t/\tFALSE\t9999\tabc\tdef\n')
    const r = await boundary.readCookie('/tmp/cookies.txt', {
      name: 'cookie-test',
      readImpl: fakeRead,
    })
    expect(r.outcome).toBe('ok')
    expect(r.value).toContain('Netscape')
  })

  it('returns auth_failed when ENOENT or file is empty', async () => {
    const fakeRead = vi.fn(async () => {
      const err = new Error('ENOENT')
      err.code = 'ENOENT'
      throw err
    })
    const r = await boundary.readCookie('/tmp/missing.txt', {
      name: 'cookie-test',
      readImpl: fakeRead,
    })
    expect(r.outcome).toBe('auth_failed')
  })
})

describe('boundary.scrape(fn, opts)', () => {
  it('wraps an arbitrary scraper function and tags its outcome', async () => {
    const r = await boundary.scrape(async () => [{ id: 'a' }], {
      name: 'reddit-creator',
    })
    expect(r.outcome).toBe('ok')
    expect(r.value).toEqual([{ id: 'a' }])
  })

  it('returns empty when scraper returns []', async () => {
    const r = await boundary.scrape(async () => [], { name: 'reddit-creator' })
    expect(r.outcome).toBe('empty')
  })

  it('classifies thrown errors via classifyError', async () => {
    const r = await boundary.scrape(async () => {
      const err = new Error('login required')
      throw err
    }, { name: 'reddit-creator' })
    expect(r.outcome).toBe('auth_failed')
  })
})
