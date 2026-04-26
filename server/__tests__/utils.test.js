import { describe, it, expect } from 'vitest'
import {
  isAllowedCdnUrl,
  inferMode,
  getRefererForUrl,
  REFERER_RULES,
  formatDuration,
} from '../utils.js'
import { COOKIE_MAP } from '../cookies.js'

// ============================================================
// Cross-cutting source-domain coverage tests.
// These exist to prevent the recurring drift bug:
// adding a new source to COOKIE_MAP but forgetting to update
// ALLOWED_CDN_DOMAINS or getRefererForUrl. Past incidents:
//   - 2026-04-18 (commit 700ba5d): missing referer for xHamster,
//     XVideos, SpankBang, RedTube, YouPorn, FikFap.
//   - 2026-04-20 (commit b06c073): FikFap CDN got the redgifs
//     referer because b-cdn.net was grouped with redgifs.com.
// The test for "every NSFW domain has its own referer" is the
// upstream catch-all so the next addition cannot drift silently.
// ============================================================

describe('isAllowedCdnUrl', () => {
  it('accepts URLs whose hostname matches an allowed domain', () => {
    expect(isAllowedCdnUrl('https://ev-h.phncdn.com/videos/abc.mp4')).toBe(true)
    expect(isAllowedCdnUrl('https://r5---sn-abc.googlevideo.com/videoplayback?xyz')).toBe(true)
    expect(isAllowedCdnUrl('https://vz-5d293dac-178.b-cdn.net/abc.m3u8')).toBe(true)
  })

  it('rejects URLs whose hostname is not allowed', () => {
    expect(isAllowedCdnUrl('https://evil.example.com/video.mp4')).toBe(false)
    expect(isAllowedCdnUrl('https://attacker.com/proxy?host=internal')).toBe(false)
  })

  it('rejects malformed URLs', () => {
    expect(isAllowedCdnUrl('not-a-url')).toBe(false)
    expect(isAllowedCdnUrl('')).toBe(false)
    expect(isAllowedCdnUrl(null)).toBe(false)
  })

  it('does not match a substring of a hostname', () => {
    // 'youtube.com' must not match 'youtube.com.evil.com' (suffix attack)
    expect(isAllowedCdnUrl('https://youtube.com.evil.com/x')).toBe(false)
    expect(isAllowedCdnUrl('https://fakeyoutube.com/x')).toBe(false)
  })
})

describe('inferMode', () => {
  it('classifies URLs that contain an NSFW domain as nsfw', () => {
    for (const [domain, cfg] of Object.entries(COOKIE_MAP)) {
      if (cfg.mode !== 'nsfw') continue
      expect(inferMode(`https://${domain}/something`)).toBe('nsfw')
    }
  })

  it('classifies URLs without any NSFW marker as social', () => {
    expect(inferMode('https://youtube.com/watch?v=a')).toBe('social')
    expect(inferMode('https://tiktok.com/@user/video/123')).toBe('social')
    expect(inferMode('https://reddit.com/r/foo')).toBe('social')
  })

  it('handles empty input safely', () => {
    expect(inferMode(null)).toBe('social')
    expect(inferMode(undefined)).toBe('social')
    expect(inferMode('')).toBe('social')
  })
})

describe('getRefererForUrl', () => {
  it('returns the source-specific referer for known NSFW page URLs', () => {
    expect(getRefererForUrl('https://www.pornhub.com/view_video.php?viewkey=abc'))
      .toBe('https://www.pornhub.com/')
    expect(getRefererForUrl('https://xvideos.com/video123/foo'))
      .toBe('https://www.xvideos.com/')
    expect(getRefererForUrl('https://spankbang.com/abc/video'))
      .toBe('https://spankbang.com/')
    expect(getRefererForUrl('https://redtube.com/12345'))
      .toBe('https://www.redtube.com/')
    expect(getRefererForUrl('https://xhamster.com/videos/foo-123'))
      .toBe('https://xhamster.com/')
    expect(getRefererForUrl('https://youporn.com/watch/123'))
      .toBe('https://www.youporn.com/')
    expect(getRefererForUrl('https://redgifs.com/watch/abc'))
      .toBe('https://www.redgifs.com/')
    expect(getRefererForUrl('https://fikfap.com/abc'))
      .toBe('https://fikfap.com/')
  })

  it('returns the correct referer for known CDN hosts', () => {
    // PornHub CDN
    expect(getRefererForUrl('https://ev-h.phncdn.com/videos/abc.mp4'))
      .toBe('https://www.pornhub.com/')
    // FikFap on BunnyCDN -- regression for the 2026-04-20 mismatch where
    // b-cdn.net got the redgifs referer.
    expect(getRefererForUrl('https://vz-5d293dac-178.b-cdn.net/abc.m3u8'))
      .toBe('https://fikfap.com/')
    // xHamster CDN host
    expect(getRefererForUrl('https://thumb.xhms.pro/videos/123.jpg'))
      .toBe('https://xhamster.com/')
    // YouTube CDN
    expect(getRefererForUrl('https://r5---sn-abc.googlevideo.com/videoplayback'))
      .toBe('https://www.youtube.com/')
  })

  it('falls through to the youtube default for unknown URLs', () => {
    // Behavior preserved from the pre-refactor implementation.
    expect(getRefererForUrl('https://unknown.example.com/foo'))
      .toBe('https://www.youtube.com/')
  })

  it('handles empty input without throwing', () => {
    expect(getRefererForUrl('')).toBe('https://www.youtube.com/')
    expect(getRefererForUrl(null)).toBe('https://www.youtube.com/')
    expect(getRefererForUrl(undefined)).toBe('https://www.youtube.com/')
  })
})

// ============================================================
// Drift guards. These fail if a new NSFW source is added to
// COOKIE_MAP but ALLOWED_CDN_DOMAINS or REFERER_RULES is not
// updated to match. Each is a single-line failure that points
// at the missing edit.
// ============================================================
describe('source-registry drift guard', () => {
  const nsfwDomains = Object.entries(COOKIE_MAP)
    .filter(([, c]) => c.mode === 'nsfw')
    .map(([d]) => d)

  // ALLOWED_CDN_DOMAINS lists CDN hostnames (phncdn, googlevideo, b-cdn)
  // not source page domains. Some sources do publish page-domain CDN URLs
  // (redtube.com, youporn.com) so they appear in both. This test only
  // checks the union of cdn host + source domain coverage in REFERER_RULES.

  it('every NSFW source domain in COOKIE_MAP has a non-default referer rule', () => {
    // The default referer is youtube. An NSFW source page URL must never
    // silently get the youtube referer -- the CDN will 403. This is the
    // recurrence guard for the 2026-04-18/2026-04-20 incidents.
    const fellThrough = nsfwDomains.filter(domain => {
      const ref = getRefererForUrl(`https://${domain}/path`)
      return ref === 'https://www.youtube.com/'
    })
    expect(fellThrough).toEqual([])
  })

  it('REFERER_RULES is non-empty and well-formed', () => {
    expect(Array.isArray(REFERER_RULES)).toBe(true)
    expect(REFERER_RULES.length).toBeGreaterThan(0)
    for (const rule of REFERER_RULES) {
      expect(Array.isArray(rule.match)).toBe(true)
      expect(rule.match.length).toBeGreaterThan(0)
      expect(typeof rule.referer).toBe('string')
      expect(rule.referer).toMatch(/^https:\/\//)
    }
  })
})

describe('formatDuration', () => {
  it('formats seconds as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(59)).toBe('0:59')
    expect(formatDuration(60)).toBe('1:00')
    expect(formatDuration(125)).toBe('2:05')
    expect(formatDuration(3600)).toBe('60:00')
  })

  it('handles falsy input', () => {
    expect(formatDuration(null)).toBe('0:00')
    expect(formatDuration(undefined)).toBe('0:00')
  })
})
