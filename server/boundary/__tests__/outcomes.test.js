import { describe, it, expect } from 'vitest'
import { OUTCOMES, classifyHttp, classifyError } from '../outcomes.js'

describe('OUTCOMES enum', () => {
  it('exposes the eight expected tags', () => {
    expect(OUTCOMES).toEqual({
      OK: 'ok',
      EMPTY: 'empty',
      WRONG_SHAPE: 'wrong_shape',
      AUTH_FAILED: 'auth_failed',
      RATE_LIMITED: 'rate_limited',
      TIMEOUT: 'timeout',
      BLOCKED: 'blocked',
      UNKNOWN_ERROR: 'unknown_error',
    })
  })
})

describe('classifyHttp(response, body)', () => {
  it('returns ok for 2xx with non-empty body', () => {
    expect(classifyHttp({ status: 200 }, 'data')).toBe('ok')
    expect(classifyHttp({ status: 201 }, [{ a: 1 }])).toBe('ok')
  })
  it('returns empty for 2xx with empty body', () => {
    expect(classifyHttp({ status: 200 }, '')).toBe('empty')
    expect(classifyHttp({ status: 200 }, [])).toBe('empty')
    expect(classifyHttp({ status: 204 }, null)).toBe('empty')
  })
  it('returns auth_failed for 401 / 403', () => {
    expect(classifyHttp({ status: 401 }, '')).toBe('auth_failed')
    expect(classifyHttp({ status: 403 }, '')).toBe('auth_failed')
  })
  it('returns rate_limited for 429', () => {
    expect(classifyHttp({ status: 429 }, '')).toBe('rate_limited')
  })
  it('returns blocked for 451 or 403 with geo body fragment', () => {
    expect(classifyHttp({ status: 451 }, '')).toBe('blocked')
    expect(classifyHttp({ status: 403 }, 'not available in your region')).toBe('blocked')
  })
  it('returns wrong_shape for 2xx but body is the empty-on-purpose sentinel', () => {
    expect(classifyHttp({ status: 200 }, '<!doctype html>')).toBe('wrong_shape')
  })
  it('returns unknown_error for anything else', () => {
    expect(classifyHttp({ status: 500 }, '')).toBe('unknown_error')
    expect(classifyHttp({ status: 502 }, '')).toBe('unknown_error')
  })
})

describe('classifyError(err)', () => {
  it('returns timeout for AbortError / ETIMEDOUT / ABORT_ERR / ESOCKETTIMEDOUT', () => {
    expect(classifyError({ name: 'AbortError' })).toBe('timeout')
    expect(classifyError({ code: 'ETIMEDOUT' })).toBe('timeout')
    expect(classifyError({ code: 'ABORT_ERR' })).toBe('timeout')
    expect(classifyError({ code: 'ESOCKETTIMEDOUT' })).toBe('timeout')
  })
  it('returns auth_failed when stderr/message mentions cookies/login', () => {
    expect(classifyError({ stderr: 'cookies are no longer valid' })).toBe('auth_failed')
    expect(classifyError({ message: 'login required' })).toBe('auth_failed')
  })
  it('returns rate_limited when stderr/message mentions HTTP Error 429', () => {
    expect(classifyError({ stderr: 'HTTP Error 429: Too Many Requests' })).toBe('rate_limited')
  })
  it('returns blocked for geo / cloudflare fragments', () => {
    expect(classifyError({ stderr: 'Video unavailable in your country' })).toBe('blocked')
    expect(classifyError({ message: 'cloudflare challenge' })).toBe('blocked')
  })
  it('returns wrong_shape on JSON parse / shape errors', () => {
    expect(classifyError({ name: 'SyntaxError', message: 'Unexpected token' })).toBe('wrong_shape')
  })
  it('returns unknown_error as the default bucket', () => {
    expect(classifyError({ message: 'something exploded' })).toBe('unknown_error')
    expect(classifyError(new Error('?'))).toBe('unknown_error')
  })
})
