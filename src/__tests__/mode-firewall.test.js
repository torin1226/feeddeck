import { describe, it, expect } from 'vitest'
import { inferMode, isVideoForMode, filterByMode, urlOf, modeFromIsSFW } from '../utils/mode'

// ============================================================
// Mode firewall tests
// Proves that NSFW source URLs can never pass an isVideoForMode
// check in social mode and vice versa.
// ============================================================

describe('inferMode', () => {
  it('classifies known NSFW domains as nsfw', () => {
    expect(inferMode('https://www.pornhub.com/view_video.php?viewkey=abc')).toBe('nsfw')
    expect(inferMode('https://xvideos.com/video123/foo')).toBe('nsfw')
    expect(inferMode('https://spankbang.com/abc/video')).toBe('nsfw')
    expect(inferMode('https://redtube.com/12345')).toBe('nsfw')
    expect(inferMode('https://xhamster.com/videos/foo-123')).toBe('nsfw')
    expect(inferMode('https://youporn.com/watch/123')).toBe('nsfw')
    expect(inferMode('https://redgifs.com/watch/abc')).toBe('nsfw')
    expect(inferMode('https://fikfap.com/abc')).toBe('nsfw')
  })

  it('classifies known social domains as social', () => {
    expect(inferMode('https://www.youtube.com/watch?v=abc')).toBe('social')
    expect(inferMode('https://youtu.be/abc')).toBe('social')
    expect(inferMode('https://tiktok.com/@user/video/123')).toBe('social')
    expect(inferMode('https://reddit.com/r/foo/comments/abc')).toBe('social')
    expect(inferMode('https://instagram.com/p/abc')).toBe('social')
  })

  it('classifies NSFW CDN URLs as nsfw', () => {
    expect(inferMode('https://ev-h.phncdn.com/videos/123/file.mp4')).toBe('nsfw')
    expect(inferMode('https://vz-5d293dac-178.b-cdn.net/abc.m3u8')).toBe('nsfw')
    expect(inferMode('https://thumb.xhms.pro/videos/123.jpg')).toBe('nsfw')
  })

  it('classifies social CDN URLs as social', () => {
    expect(inferMode('https://r5---sn-abc.googlevideo.com/videoplayback?xyz')).toBe('social')
    expect(inferMode('https://i.ytimg.com/vi/abc/maxresdefault.jpg')).toBe('social')
  })

  it('handles empty/null input safely', () => {
    expect(inferMode(null)).toBe('social')
    expect(inferMode(undefined)).toBe('social')
    expect(inferMode('')).toBe('social')
    expect(inferMode(123)).toBe('social') // non-string defensive case
  })
})

describe('isVideoForMode (the firewall predicate)', () => {
  it('blocks NSFW URLs in social mode', () => {
    const item = { url: 'https://pornhub.com/abc' }
    expect(isVideoForMode(item, 'social')).toBe(false)
    expect(isVideoForMode(item, 'nsfw')).toBe(true)
  })

  it('blocks social URLs in nsfw mode', () => {
    const item = { url: 'https://youtube.com/watch?v=abc' }
    expect(isVideoForMode(item, 'nsfw')).toBe(false)
    expect(isVideoForMode(item, 'social')).toBe(true)
  })

  it('trusts an explicit mode field over URL inference', () => {
    // A row where the URL might be ambiguous but mode is set authoritatively
    const item = { url: 'https://unknown.cdn.com/x.mp4', mode: 'nsfw' }
    expect(isVideoForMode(item, 'nsfw')).toBe(true)
    expect(isVideoForMode(item, 'social')).toBe(false)
  })

  it('reads URL from common alias fields', () => {
    expect(isVideoForMode({ video_url: 'https://pornhub.com/x' }, 'social')).toBe(false)
    expect(isVideoForMode({ stream_url: 'https://b-cdn.net/x.m3u8' }, 'social')).toBe(false)
    expect(isVideoForMode({ source: 'pornhub.com' }, 'social')).toBe(false)
  })

  it('passes through items with no URL (cannot classify)', () => {
    expect(isVideoForMode({ id: 'foo' }, 'social')).toBe(true)
    expect(isVideoForMode({}, 'nsfw')).toBe(true)
  })

  it('passes through non-objects', () => {
    expect(isVideoForMode(null, 'social')).toBe(true)
    expect(isVideoForMode('string', 'social')).toBe(true)
  })
})

describe('filterByMode', () => {
  it('strips cross-mode items from a mixed array', () => {
    const items = [
      { id: 1, url: 'https://youtube.com/watch?v=a' },
      { id: 2, url: 'https://pornhub.com/view?key=b' },
      { id: 3, url: 'https://tiktok.com/@x/video/c' },
      { id: 4, url: 'https://redgifs.com/watch/d' },
    ]
    expect(filterByMode(items, 'social').map(x => x.id)).toEqual([1, 3])
    expect(filterByMode(items, 'nsfw').map(x => x.id)).toEqual([2, 4])
  })

  it('returns non-arrays unchanged', () => {
    expect(filterByMode(null, 'social')).toBeNull()
    expect(filterByMode({ foo: 'bar' }, 'social')).toEqual({ foo: 'bar' })
  })
})

describe('urlOf', () => {
  it('finds url-like fields by precedence', () => {
    expect(urlOf({ url: 'a' })).toBe('a')
    expect(urlOf({ video_url: 'b' })).toBe('b')
    expect(urlOf({ streamUrl: 'c' })).toBe('c')
    expect(urlOf({ source: 'd' })).toBe('d')
    expect(urlOf({ url: 'a', source: 'd' })).toBe('a') // url wins
    expect(urlOf({})).toBeNull()
    expect(urlOf(null)).toBeNull()
  })
})

describe('modeFromIsSFW', () => {
  it('translates the boolean to the wire format', () => {
    expect(modeFromIsSFW(true)).toBe('social')
    expect(modeFromIsSFW(false)).toBe('nsfw')
  })
})

// ============================================================
// Real-world leak scenarios
// These directly exercise the bugs the firewall was built to prevent.
// ============================================================
describe('firewall: real-world leak scenarios', () => {
  it('NSFW liked video does not appear in social Liked tab', () => {
    // Simulates the BrowseSection useLikedRow / LibraryPage fetchLiked flow:
    // server returns rows from video_ratings, client filters by mode.
    const ratingsResponse = [
      { id: 1, video_url: 'https://pornhub.com/view?key=abc', mode: 'nsfw', rating: 'up' },
      { id: 2, video_url: 'https://www.youtube.com/watch?v=xyz', mode: 'social', rating: 'up' },
    ]
    const visibleInSocial = ratingsResponse.filter(r =>
      isVideoForMode({ url: r.video_url, mode: r.mode }, 'social')
    )
    expect(visibleInSocial).toHaveLength(1)
    expect(visibleInSocial[0].video_url).toContain('youtube.com')
  })

  it('legacy NULL-mode rating is classified by URL inference', () => {
    // Pre-firewall ratings have mode=null. URL inference is the fallback.
    const legacy = { id: 7, video_url: 'https://pornhub.com/view?key=abc', mode: null }
    expect(isVideoForMode({ url: legacy.video_url, mode: legacy.mode }, 'social')).toBe(false)
    expect(isVideoForMode({ url: legacy.video_url, mode: legacy.mode }, 'nsfw')).toBe(true)
  })

  it('queue across modes: filtering keeps each mode isolated', () => {
    const persisted = [
      { id: 'q1', video_url: 'https://pornhub.com/a', mode: 'nsfw' },
      { id: 'q2', video_url: 'https://youtube.com/watch?v=b', mode: 'social' },
      { id: 'q3', video_url: 'https://xvideos.com/c', mode: 'nsfw' },
    ]
    const socialQueue = persisted.filter(it => isVideoForMode(it, 'social'))
    expect(socialQueue.map(x => x.id)).toEqual(['q2'])
    const nsfwQueue = persisted.filter(it => isVideoForMode(it, 'nsfw'))
    expect(nsfwQueue.map(x => x.id)).toEqual(['q1', 'q3'])
  })

  it('hardcoded nsfw bug regression: a YouTube URL never lands in nsfw mode', () => {
    // The old POST /api/ratings inserted every liked video as mode='nsfw'
    // even YouTube videos. The fix: mode = inferMode(url). This test asserts
    // the URL-derived classification is what wins, not any hardcoded string.
    const yt = 'https://www.youtube.com/watch?v=abc123'
    expect(inferMode(yt)).toBe('social')
    expect(isVideoForMode({ url: yt }, 'social')).toBe(true)
    expect(isVideoForMode({ url: yt }, 'nsfw')).toBe(false)
  })
})
