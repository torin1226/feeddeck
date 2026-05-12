// ============================================================
// Tests for filterSocialContent — the shared content-quality
// filter chain used by homepage refill (routes/content.js), the
// feed warm-cache (scripts/warm-cache.js), and on-demand feed
// refill (index.js _refillFeedCacheImpl).
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import { filterSocialContent } from '../content-filters.js'

const item = (title, extras = {}) => ({ title, url: 'https://example.com/' + encodeURIComponent(title), ...extras })

describe('filterSocialContent', () => {
  it('passes NSFW arrays through unchanged', () => {
    const videos = [
      item('Try Not To Laugh — Top 100 Funniest'),
      item('Best Music Hits 70s 80s 90s Playlist'),
    ]
    const out = filterSocialContent(videos, { mode: 'nsfw' })
    expect(out).toEqual(videos)
  })

  it('returns empty array unchanged', () => {
    expect(filterSocialContent([], { mode: 'social' })).toEqual([])
  })

  it('returns null/undefined unchanged (defensive)', () => {
    expect(filterSocialContent(null, { mode: 'social' })).toBeNull()
    expect(filterSocialContent(undefined, { mode: 'social' })).toBeUndefined()
  })

  it('drops clickbait farm titles', () => {
    const videos = [
      item('Real news about something'),
      item('Try Not To Laugh — Top 100 Funniest Videos Ever 2026'),
      item('TRY NOT TO LAUGH Top 101 Funniest Videos Ever'),
      item('Best of 2026 Funny Compilation'),
    ]
    const out = filterSocialContent(videos, { mode: 'social' })
    expect(out).toHaveLength(1)
    expect(out[0].title).toContain('Real news')
  })

  it('drops hashtag-spam shorts (3+ hashtags)', () => {
    const videos = [
      item('Real story #news'),
      item('Shorts content #viral #trending #shorts #fyp'),
    ]
    const out = filterSocialContent(videos, { mode: 'social' })
    expect(out).toHaveLength(1)
  })

  it('drops music mixes outside social_music', () => {
    const videos = [
      item('Tech news today'),
      item('Best Music Hits 70s 80s 90s Playlist'),
      item('Chill Lo-Fi Mix to study'),
      item('Cleaning Mix 2026'),
    ]
    const out = filterSocialContent(videos, { mode: 'social', categoryKey: 'social_tech' })
    expect(out).toHaveLength(1)
    expect(out[0].title).toContain('Tech news')
  })

  it('keeps music mixes when categoryKey is social_music', () => {
    const videos = [
      item('Chill Lo-Fi Mix to study'),
      item('Greatest Hits Mixtape 2026'),
    ]
    const out = filterSocialContent(videos, { mode: 'social', categoryKey: 'social_music' })
    expect(out).toHaveLength(2)
  })

  it('drops kids content', () => {
    const videos = [
      item('Real news today'),
      item('Cocomelon nursery rhymes'),
      item('Peppa Pig full episode'),
    ]
    const out = filterSocialContent(videos, { mode: 'social' })
    expect(out).toHaveLength(1)
  })

  it('drops pet TV', () => {
    const videos = [
      item('Real news'),
      item('Dog TV 8 hours of calming videos for dogs'),
    ]
    const out = filterSocialContent(videos, { mode: 'social' })
    expect(out).toHaveLength(1)
  })

  it('drops non-English titles', () => {
    const videos = [
      item('English title only'),
      item('Привет мир'),
      item('日本語のタイトル'),
      item('한국어 제목'),
    ]
    const out = filterSocialContent(videos, { mode: 'social' })
    expect(out).toHaveLength(1)
    expect(out[0].title).toContain('English')
  })

  it('drops full-movie clickbait', () => {
    const videos = [
      item('Real news'),
      item('Full HD Movie 2026 Action Thriller'),
      item('Hollywood Action Movie 2026'),
    ]
    const out = filterSocialContent(videos, { mode: 'social' })
    expect(out).toHaveLength(1)
  })

  it('logs drop counts when a logFn is provided', () => {
    const logFn = vi.fn()
    const videos = [
      item('Real news'),
      item('Cocomelon for kids'),
      item('Dog TV for dogs'),
    ]
    filterSocialContent(videos, { mode: 'social', context: 'social_news', logFn })
    // At least one log call per kind that dropped
    expect(logFn).toHaveBeenCalled()
    const messages = logFn.mock.calls.map(c => c[0])
    expect(messages.some(m => m.includes('kids content'))).toBe(true)
    expect(messages.some(m => m.includes('pet TV'))).toBe(true)
    expect(messages.some(m => m.includes('from social_news'))).toBe(true)
  })

  it('does not log when nothing drops', () => {
    const logFn = vi.fn()
    filterSocialContent([item('Real news')], { mode: 'social', logFn })
    expect(logFn).not.toHaveBeenCalled()
  })

  it('preserves all extra fields on surviving rows', () => {
    const videos = [
      item('Real news', { url: 'https://example.com/x', uploader: 'BBC', _score: 5 }),
      item('Try Not To Laugh — Top 100 Funny'),
    ]
    const out = filterSocialContent(videos, { mode: 'social' })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ uploader: 'BBC', _score: 5 })
  })

  it('uploader-only kids detection (Cocomelon uploader, neutral title)', () => {
    const videos = [
      item('Latest video', { uploader: 'Cocomelon - Nursery Rhymes' }),
    ]
    const out = filterSocialContent(videos, { mode: 'social' })
    expect(out).toHaveLength(0)
  })
})
