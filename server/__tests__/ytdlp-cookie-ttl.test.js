import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock cookie-health BEFORE importing the module under test so the imported
// reference inside ytdlp.js sees the mocked function.
vi.mock('../cookie-health.js', () => ({
  probeCookieForDomain: vi.fn(),
}))

import {
  _isCookieExpired,
  _markCookieExpired,
  _verifyAndMarkExpired,
  _resetExpiredCookieDomains,
  COOKIE_EXPIRED_TTL_MS,
} from '../sources/ytdlp.js'
import { probeCookieForDomain } from '../cookie-health.js'

// Tiny helper: yield to the microtask queue so the async IIFE inside
// _verifyAndMarkExpired has a chance to run.
const flush = async (ms = 0) => {
  await new Promise(r => setTimeout(r, ms))
}

describe('ytdlp cookie skip-set TTL', () => {
  beforeEach(() => {
    _resetExpiredCookieDomains()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('null/empty domain is never reported expired', () => {
    expect(_isCookieExpired(null)).toBe(false)
    expect(_isCookieExpired('')).toBe(false)
    expect(_isCookieExpired(undefined)).toBe(false)
  })

  it('an unmarked domain is not expired', () => {
    expect(_isCookieExpired('youtube.com')).toBe(false)
  })

  it('immediate marking causes the domain to read as expired', () => {
    _markCookieExpired('youtube.com')
    expect(_isCookieExpired('youtube.com')).toBe(true)
  })

  it('entries auto-evict once the TTL window has passed', () => {
    vi.useFakeTimers()
    const t0 = new Date('2026-05-01T00:00:00Z')
    vi.setSystemTime(t0)
    _markCookieExpired('youtube.com')
    expect(_isCookieExpired('youtube.com')).toBe(true)

    vi.setSystemTime(new Date(t0.getTime() + COOKIE_EXPIRED_TTL_MS + 1))
    expect(_isCookieExpired('youtube.com')).toBe(false)
    // Reads at this point should also have evicted the entry.
    vi.useRealTimers()
  })

  it('marking is per-domain — does not leak across domains', () => {
    _markCookieExpired('youtube.com')
    expect(_isCookieExpired('youtube.com')).toBe(true)
    expect(_isCookieExpired('pornhub.com')).toBe(false)
  })

  it('verifyAndMarkExpired DOES NOT poison the skip set when probe says healthy', async () => {
    probeCookieForDomain.mockResolvedValue({ status: 'healthy', message: 'YouTube cookies valid' })
    _verifyAndMarkExpired('youtube.com')
    // Probe is async; wait a tick for the IIFE to resolve.
    await flush()
    expect(probeCookieForDomain).toHaveBeenCalledWith('youtube.com')
    expect(_isCookieExpired('youtube.com')).toBe(false)
  })

  it('verifyAndMarkExpired DOES poison when probe confirms expired', async () => {
    probeCookieForDomain.mockResolvedValue({ status: 'expired', message: 'YouTube cookies expired' })
    _verifyAndMarkExpired('youtube.com')
    await flush()
    expect(_isCookieExpired('youtube.com')).toBe(true)
  })

  it('verifyAndMarkExpired DOES poison when probe reports cookies missing', async () => {
    probeCookieForDomain.mockResolvedValue({ status: 'missing', message: 'No cookie file' })
    _verifyAndMarkExpired('pornhub.com')
    await flush()
    expect(_isCookieExpired('pornhub.com')).toBe(true)
  })

  it('verifyAndMarkExpired falls back to TTL marking when no probe exists for the domain', async () => {
    probeCookieForDomain.mockResolvedValue(null)
    _verifyAndMarkExpired('xvideos.com')
    await flush()
    // The only signal we have is the stderr warning; mark with TTL so the next
    // call retries with cookies after the TTL elapses.
    expect(_isCookieExpired('xvideos.com')).toBe(true)
  })

  it('verifyAndMarkExpired does not crash and does not poison if the probe throws', async () => {
    probeCookieForDomain.mockRejectedValue(new Error('boom'))
    _verifyAndMarkExpired('youtube.com')
    await flush()
    expect(_isCookieExpired('youtube.com')).toBe(false)
  })

  it('concurrent verify calls for the same domain dedupe to a single probe', async () => {
    let resolveProbe
    probeCookieForDomain.mockReturnValue(new Promise(r => { resolveProbe = r }))

    _verifyAndMarkExpired('youtube.com')
    _verifyAndMarkExpired('youtube.com')
    _verifyAndMarkExpired('youtube.com')

    // Allow the first IIFE to register its in-flight slot before resolving.
    await flush()
    resolveProbe({ status: 'healthy' })
    await flush()

    expect(probeCookieForDomain).toHaveBeenCalledTimes(1)
  })

  it('after the in-flight probe completes, a subsequent verify call can probe again', async () => {
    probeCookieForDomain.mockResolvedValueOnce({ status: 'healthy' })
    _verifyAndMarkExpired('youtube.com')
    await flush()
    expect(probeCookieForDomain).toHaveBeenCalledTimes(1)

    // Now a NEW transient warning arrives — this should issue a fresh probe.
    probeCookieForDomain.mockResolvedValueOnce({ status: 'expired' })
    _verifyAndMarkExpired('youtube.com')
    await flush()
    expect(probeCookieForDomain).toHaveBeenCalledTimes(2)
    expect(_isCookieExpired('youtube.com')).toBe(true)
  })

  it('reset clears all entries and any in-flight verification slots', async () => {
    _markCookieExpired('youtube.com')
    _markCookieExpired('pornhub.com')
    expect(_isCookieExpired('youtube.com')).toBe(true)
    expect(_isCookieExpired('pornhub.com')).toBe(true)

    _resetExpiredCookieDomains()
    expect(_isCookieExpired('youtube.com')).toBe(false)
    expect(_isCookieExpired('pornhub.com')).toBe(false)
  })
})

describe('cookie-health.probeCookieForDomain mapping', () => {
  // Sanity: the helper we expose must actually map yt-dlp's domain strings
  // to probe keys. Re-import without the vi.mock so we get the real impl.
  it('maps known domains via the documented table', async () => {
    vi.doUnmock('../cookie-health.js')
    vi.resetModules()
    const real = await import('../cookie-health.js')
    expect(real.DOMAIN_TO_PROBE_KEY['youtube.com']).toBe('youtube')
    expect(real.DOMAIN_TO_PROBE_KEY['youtu.be']).toBe('youtube')
    expect(real.DOMAIN_TO_PROBE_KEY['pornhub.com']).toBe('pornhub')
    expect(real.DOMAIN_TO_PROBE_KEY['xvideos.com']).toBeUndefined()
  })
})
