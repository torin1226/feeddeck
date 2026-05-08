import { describe, it, expect } from 'vitest'
import { isClickOutSource } from '../utils/isClickOutSource'

// Click-out sources are sources whose individual items can't be played
// in-app and must open in a new tab on the source's website. Today only
// Instagram qualifies (yt-dlp extractor upstream-broken; static cookies
// fail). The detection runs in render, so it has to be cheap and tolerant
// of varied source-string casing across ingest paths.
describe('isClickOutSource', () => {
  it('returns true for the canonical scraper site key', () => {
    expect(isClickOutSource('instagram.com')).toBe(true)
  })

  it('returns true for the platform short form', () => {
    expect(isClickOutSource('instagram')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isClickOutSource('Instagram.com')).toBe(true)
    expect(isClickOutSource('INSTAGRAM')).toBe(true)
  })

  it('returns false for any other source', () => {
    expect(isClickOutSource('youtube.com')).toBe(false)
    expect(isClickOutSource('redgifs.com')).toBe(false)
    expect(isClickOutSource('pornhub.com')).toBe(false)
    expect(isClickOutSource('reddit')).toBe(false)
    expect(isClickOutSource('tiktok')).toBe(false)
    expect(isClickOutSource('twitter')).toBe(false)
  })

  it('returns false for null, undefined, empty, or non-string input', () => {
    expect(isClickOutSource(null)).toBe(false)
    expect(isClickOutSource(undefined)).toBe(false)
    expect(isClickOutSource('')).toBe(false)
    expect(isClickOutSource(0)).toBe(false)
    expect(isClickOutSource(false)).toBe(false)
  })

  it('does not match substrings (no "uses-instagram" false positive)', () => {
    expect(isClickOutSource('uses-instagram')).toBe(false)
    expect(isClickOutSource('instagram-clone')).toBe(false)
    expect(isClickOutSource('instagrammy')).toBe(false)
  })
})
