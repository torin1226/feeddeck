import { describe, it, expect } from 'vitest'
import { instagramFallbackTitle } from '../sources/scraper.js'

// AP5b — title fallback chain for Instagram cards.
//
// Why this exists: Instagram's grid view exposes an alt-text caption ONLY
// after the browser fetches the image. With image-loading enabled (AP5a)
// alt text + og:title carry the real caption; without, the URL shortcode
// is the only thing left in the DOM. The OG-enrichment pass closes most
// of that gap, but a fetch failure or empty og:title means we'd otherwise
// store a bare 11-char shortcode like "DXwidkpoiJC" as the title.
//
// The fallback chain (last-ditch, after enrichment) must produce something
// readable. Acceptance: never a bare shortcode in the title field.
describe('instagramFallbackTitle', () => {
  it('uses uploader handle when present (preferred path)', () => {
    expect(instagramFallbackTitle('https://www.instagram.com/reel/abc123/', 'cristiano'))
      .toBe('Reel by @cristiano')
  })

  it('strips a leading @ from the uploader handle', () => {
    expect(instagramFallbackTitle('https://www.instagram.com/reel/abc123/', '@kimkardashian'))
      .toBe('Reel by @kimkardashian')
  })

  it('extracts the handle from creator-page reel URLs when uploader is empty', () => {
    expect(instagramFallbackTitle('https://www.instagram.com/cristiano/reel/DXwidkpoiJC/', ''))
      .toBe('Reel by @cristiano')
  })

  it('falls back to "Instagram Reel" for explore-page reel URLs (no handle in path)', () => {
    expect(instagramFallbackTitle('https://www.instagram.com/reel/DXwidkpoiJC/', ''))
      .toBe('Instagram Reel')
  })

  it('falls back to "Instagram Reel" when a malformed URL has no path', () => {
    expect(instagramFallbackTitle('not a url', null))
      .toBe('Instagram Reel')
  })

  it('does not output a shortcode-shaped handle from a malformed URL', () => {
    // If parsing failed AND the uploader was somehow a shortcode-shaped string,
    // the function must not echo it back as "Reel by @<shortcode>".
    expect(instagramFallbackTitle('https://www.instagram.com/reel/DXwidkpoiJC/', 'DXwidkpoiJC'))
      .toBe('Instagram Reel')
  })

  it('handles trailing slashes and missing trailing slashes equally', () => {
    expect(instagramFallbackTitle('https://www.instagram.com/cristiano/reel/abc123', ''))
      .toBe('Reel by @cristiano')
    expect(instagramFallbackTitle('https://www.instagram.com/cristiano/reel/abc123/', ''))
      .toBe('Reel by @cristiano')
  })

  it('prefers an explicit uploader over the URL-derived handle', () => {
    // If a downstream enrichment step set uploader to "Real Name (@handle)",
    // the callable handle (uploader passed in) wins over the URL path tail.
    // The function does not currently strip parens — that's an enrichment-side
    // concern. This test pins the priority order: uploader first.
    expect(instagramFallbackTitle('https://www.instagram.com/someoneelse/reel/abc123/', 'cristiano'))
      .toBe('Reel by @cristiano')
  })
})
