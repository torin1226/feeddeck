import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ScraperAdapter, SUPPORTED_SITES } from '../sources/scraper.js'

// ============================================================
// Drift-guard tests for ScraperAdapter routing.
//
// Past incidents this prevents:
//   - fetchTrending({ site: 'redgifs.com' }) and ({ site: 'fikfap.com' })
//     crashed with "Cannot read properties of undefined (reading 'trendingUrl')"
//     because both sites were in supportedDomains but had no SITE_CONFIGS entry
//     and fetchTrending had no API-site dispatch. The scheduled trending refresh
//     in server/index.js rotates through supportedDomains, so two slots silently
//     errored every full cycle.
//   - searchAll() hardcoded the site list and missed fikfap.com (added April 15).
//     /api/search/multi never returned fikfap content.
//
// The shape of both bugs: a new site added to one place, forgotten elsewhere.
// These tests assert the invariant: every entry in supportedDomains must be
// reachable from search(), fetchTrending(), and fetchCategory() without crashing
// on a missing config lookup.
// ============================================================

function makeAdapter() {
  const adapter = new ScraperAdapter()
  // Stub the underlying transports so the routing tests do not touch the network.
  // We only care that each site routes to the correct method and does not throw.
  adapter._scrapeVideoList = vi.fn(async (url, siteKey) => [{ id: `puppeteer:${siteKey}`, url }])
  adapter.searchRedGifs = vi.fn(async (query) => [{ id: `redgifs:${query}`, url: query }])
  adapter.searchFikFap = vi.fn(async (query) => [{ id: `fikfap:${query}`, url: query }])
  return adapter
}

describe('ScraperAdapter: site key resolution', () => {
  it('_getSiteKey resolves every supported domain to itself', () => {
    const adapter = new ScraperAdapter()
    for (const site of SUPPORTED_SITES) {
      expect(adapter._getSiteKey(site)).toBe(site)
    }
  })

  it('_getSiteKey strips www. prefix', () => {
    const adapter = new ScraperAdapter()
    expect(adapter._getSiteKey('www.pornhub.com')).toBe('pornhub.com')
    expect(adapter._getSiteKey('www.redgifs.com')).toBe('redgifs.com')
  })

  it('_getSiteKey resolves URLs to their site (substring match)', () => {
    const adapter = new ScraperAdapter()
    expect(adapter._getSiteKey('https://www.pornhub.com/video/abc')).toBe('pornhub.com')
    expect(adapter._getSiteKey('https://fikfap.com/post/123')).toBe('fikfap.com')
  })

  it('_getSiteKey returns null for unknown sites', () => {
    const adapter = new ScraperAdapter()
    expect(adapter._getSiteKey('example.com')).toBe(null)
  })
})

describe('ScraperAdapter: fetchTrending routing (drift guard)', () => {
  let adapter
  beforeEach(() => { adapter = makeAdapter() })

  it.each(SUPPORTED_SITES)(
    'fetchTrending({ site: "%s" }) does not throw on routing',
    async (site) => {
      // The historical bug returned undefined.trendingUrl for redgifs/fikfap.
      // This test catches that exact shape: any site in supportedDomains must
      // have a working trending path, whether Puppeteer or API-based.
      await expect(adapter.fetchTrending({ site, limit: 1 })).resolves.toBeDefined()
    }
  )

  it('fetchTrending routes redgifs.com to the API method, not Puppeteer', async () => {
    await adapter.fetchTrending({ site: 'redgifs.com', limit: 5 })
    expect(adapter.searchRedGifs).toHaveBeenCalledOnce()
    expect(adapter._scrapeVideoList).not.toHaveBeenCalled()
  })

  it('fetchTrending routes fikfap.com to the API method, not Puppeteer', async () => {
    await adapter.fetchTrending({ site: 'fikfap.com', limit: 5 })
    expect(adapter.searchFikFap).toHaveBeenCalledOnce()
    expect(adapter._scrapeVideoList).not.toHaveBeenCalled()
  })

  it('fetchTrending routes Puppeteer sites to _scrapeVideoList', async () => {
    await adapter.fetchTrending({ site: 'pornhub.com', limit: 5 })
    expect(adapter._scrapeVideoList).toHaveBeenCalledOnce()
    expect(adapter.searchRedGifs).not.toHaveBeenCalled()
    expect(adapter.searchFikFap).not.toHaveBeenCalled()
  })
})

describe('ScraperAdapter: fetchCategory routing', () => {
  let adapter
  beforeEach(() => { adapter = makeAdapter() })

  it('fetchCategory routes redgifs URLs to the API method', async () => {
    await adapter.fetchCategory('https://www.redgifs.com/search?query=amateur', { limit: 5 })
    expect(adapter.searchRedGifs).toHaveBeenCalledOnce()
    expect(adapter._scrapeVideoList).not.toHaveBeenCalled()
  })

  it('fetchCategory routes fikfap URLs to the API method', async () => {
    await adapter.fetchCategory('https://fikfap.com/trending', { limit: 5 })
    expect(adapter.searchFikFap).toHaveBeenCalledOnce()
    expect(adapter._scrapeVideoList).not.toHaveBeenCalled()
  })

  it('fetchCategory routes Puppeteer URLs to _scrapeVideoList', async () => {
    await adapter.fetchCategory('https://www.pornhub.com/categories/amateur', { limit: 5 })
    expect(adapter._scrapeVideoList).toHaveBeenCalledOnce()
  })

  it('fetchCategory throws on completely unknown URL', async () => {
    await expect(
      adapter.fetchCategory('https://example.com/unknown', { limit: 5 })
    ).rejects.toThrow(/Can't determine site/)
  })
})

describe('ScraperAdapter: search routing', () => {
  let adapter
  beforeEach(() => { adapter = makeAdapter() })

  it('search routes API sites correctly', async () => {
    await adapter.search('cats', { site: 'redgifs.com' })
    expect(adapter.searchRedGifs).toHaveBeenCalledOnce()

    await adapter.search('cats', { site: 'fikfap.com' })
    expect(adapter.searchFikFap).toHaveBeenCalledOnce()
  })

  it('search uses _scrapeVideoList for Puppeteer sites with keyword query', async () => {
    await adapter.search('cats', { site: 'pornhub.com' })
    expect(adapter._scrapeVideoList).toHaveBeenCalledOnce()
    // Should pass the constructed search URL, not the raw keyword
    const url = adapter._scrapeVideoList.mock.calls[0][0]
    expect(url).toContain('pornhub.com/video/search?search=cats')
  })

  it('search passes URL queries through to _scrapeVideoList unchanged', async () => {
    const url = 'https://www.pornhub.com/categories/amateur'
    await adapter.search(url, { site: 'pornhub.com' })
    expect(adapter._scrapeVideoList).toHaveBeenCalledWith(url, 'pornhub.com', { limit: 20 })
  })
})

describe('ScraperAdapter: searchAll covers every supported site', () => {
  it('searchAll fans out to all supportedDomains (drift guard)', async () => {
    const adapter = makeAdapter()
    // Spy on search() since searchAll() calls it for each site.
    const searchSpy = vi.spyOn(adapter, 'search')
    await adapter.searchAll('cats', { limit: 3 })

    // Every entry in supportedDomains must be searched. The historical bug had
    // searchAll() hardcoded to skip fikfap.com (added later); this test catches
    // that exact shape.
    expect(searchSpy).toHaveBeenCalledTimes(SUPPORTED_SITES.length)
    const sitesSearched = searchSpy.mock.calls.map(call => call[1].site)
    for (const site of SUPPORTED_SITES) {
      expect(sitesSearched).toContain(site)
    }
  })
})
