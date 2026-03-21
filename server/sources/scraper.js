// ============================================================
// Puppeteer Discovery Scraper
// Headless browser scraper for NSFW content discovery.
// This is the discovery engine yt-dlp can't be: it navigates
// search pages, category listings, and trending feeds to find
// new content URLs with metadata. yt-dlp then handles the
// actual stream URL extraction.
//
// Why Puppeteer instead of plain HTTP?
// Adult sites are SPAs with JS rendering, anti-bot measures,
// and lazy-loaded content. A headless browser handles all of it.
// ============================================================

import { SourceAdapter } from './base.js'

// Lazy import: puppeteer is only needed when this adapter is used
let puppeteer = null
async function getPuppeteer() {
  if (!puppeteer) {
    try {
      puppeteer = await import('puppeteer')
    } catch {
      throw new Error('puppeteer not installed. Run: npm install puppeteer')
    }
  }
  return puppeteer.default || puppeteer
}

// Site-specific scraper configs
// Each site needs: URL patterns for search/category/trending,
// and CSS selectors for extracting video cards from the page.
const SITE_CONFIGS = {
  'pornhub.com': {
    searchUrl: (q) => `https://www.pornhub.com/video/search?search=${encodeURIComponent(q)}`,
    categoryUrl: (cat) => `https://www.pornhub.com/categories/${encodeURIComponent(cat)}`,
    trendingUrl: 'https://www.pornhub.com/video?o=tr',
    selectors: {
      videoCard: '.pcVideoListItem, li.videoBox',
      title: '.title a, a[title]',
      thumbnail: 'img.thumb, img[data-thumb_url]',
      duration: '.duration, var.duration',
      views: '.views, span.views',
      uploader: '.usernameWrap a',
      link: '.title a, a.linkVideoThumb',
    },
    // Some thumbnails are lazy-loaded via data attributes
    thumbnailAttr: ['data-thumb_url', 'data-src', 'src'],
    baseUrl: 'https://www.pornhub.com',
  },

  'xvideos.com': {
    searchUrl: (q) => `https://www.xvideos.com/?k=${encodeURIComponent(q)}`,
    categoryUrl: (cat) => `https://www.xvideos.com/tags/${encodeURIComponent(cat)}`,
    trendingUrl: 'https://www.xvideos.com/best',
    selectors: {
      videoCard: '.thumb-block',
      title: '.thumb-under p a, p.title a',
      thumbnail: 'img.thumb',
      duration: '.duration, span.duration',
      views: '.metadata .bg span',
      uploader: '.metadata .name a',
      link: '.thumb-under p a, a',
    },
    thumbnailAttr: ['data-src', 'src'],
    baseUrl: 'https://www.xvideos.com',
  },

  'spankbang.com': {
    searchUrl: (q) => `https://spankbang.com/s/${encodeURIComponent(q)}/`,
    categoryUrl: (cat) => `https://spankbang.com/t/${encodeURIComponent(cat)}/`,
    trendingUrl: 'https://spankbang.com/trending_videos/',
    selectors: {
      videoCard: '.video-item',
      title: 'a.n',
      thumbnail: 'img[data-src], picture img',
      duration: '.l',
      views: '.v',
      uploader: '.u a',
      link: 'a.n',
    },
    thumbnailAttr: ['data-src', 'src'],
    baseUrl: 'https://spankbang.com',
  },
}

export class ScraperAdapter extends SourceAdapter {
  constructor() {
    super({
      name: 'scraper',
      supportedDomains: Object.keys(SITE_CONFIGS),
      capabilities: {
        search: true,
        categories: true,
        trending: true,
        metadata: false,  // Use yt-dlp for metadata enrichment
        streamUrl: false,  // Use yt-dlp for stream URLs
      },
    })
    this.browser = null
  }

  async _getBrowser() {
    if (this.browser?.connected) return this.browser

    const pptr = await getPuppeteer()
    this.browser = await pptr.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    })
    return this.browser
  }

  async _newPage() {
    const browser = await this._getBrowser()
    const page = await browser.newPage()

    // Stealth basics: realistic user agent + viewport
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
    )
    await page.setViewport({ width: 1920, height: 1080 })

    // Block images, fonts, and CSS to speed things up (we only need the DOM)
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const type = req.resourceType()
      if (['image', 'font', 'stylesheet', 'media'].includes(type)) {
        req.abort()
      } else {
        req.continue()
      }
    })

    return page
  }

  // Scrape a page and extract video cards
  async _scrapeVideoList(url, siteKey, options = {}) {
    const { limit = 20, scrollCount = 2 } = options
    const config = SITE_CONFIGS[siteKey]
    if (!config) throw new Error(`No scraper config for ${siteKey}`)

    const page = await this._newPage()

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })

      // Wait for video cards to appear
      await page.waitForSelector(config.selectors.videoCard, { timeout: 10_000 })
        .catch(() => {}) // Some pages might not have results

      // Scroll to load lazy content
      for (let i = 0; i < scrollCount; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight))
        await new Promise(r => setTimeout(r, 800))
      }

      // Extract video data from the DOM
      const videos = await page.evaluate((cfg, maxResults) => {
        const cards = document.querySelectorAll(cfg.selectors.videoCard)
        const results = []

        for (const card of cards) {
          if (results.length >= maxResults) break

          // Title
          const titleEl = card.querySelector(cfg.selectors.title)
          const title = titleEl?.textContent?.trim() || titleEl?.getAttribute('title') || ''
          if (!title) continue

          // Link
          const linkEl = card.querySelector(cfg.selectors.link)
          let href = linkEl?.getAttribute('href') || ''
          if (href && !href.startsWith('http')) {
            href = cfg.baseUrl + href
          }
          if (!href) continue

          // Thumbnail (check multiple attrs for lazy loading)
          const thumbEl = card.querySelector(cfg.selectors.thumbnail)
          let thumbnail = ''
          if (thumbEl) {
            for (const attr of cfg.thumbnailAttr) {
              const val = thumbEl.getAttribute(attr)
              if (val && val.startsWith('http')) {
                thumbnail = val
                break
              }
            }
          }

          // Duration text like "12:34"
          const durEl = card.querySelector(cfg.selectors.duration)
          const durText = durEl?.textContent?.trim() || ''
          let duration = 0
          const durMatch = durText.match(/(\d+):(\d+)(?::(\d+))?/)
          if (durMatch) {
            if (durMatch[3]) {
              duration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseInt(durMatch[3])
            } else {
              duration = parseInt(durMatch[1]) * 60 + parseInt(durMatch[2])
            }
          }

          // Views
          const viewsEl = card.querySelector(cfg.selectors.views)
          const viewsText = viewsEl?.textContent?.trim() || ''
          let viewCount = 0
          const viewMatch = viewsText.replace(/,/g, '').match(/([\d.]+)\s*([KkMm])?/)
          if (viewMatch) {
            viewCount = parseFloat(viewMatch[1])
            if (viewMatch[2]?.toLowerCase() === 'k') viewCount *= 1000
            if (viewMatch[2]?.toLowerCase() === 'm') viewCount *= 1000000
            viewCount = Math.round(viewCount)
          }

          // Uploader
          const uploaderEl = card.querySelector(cfg.selectors.uploader)
          const uploader = uploaderEl?.textContent?.trim() || ''

          results.push({ title, url: href, thumbnail, duration, view_count: viewCount, uploader })
        }

        return results
      }, config, limit)

      // Normalize into our standard shape
      return videos.map(v => this.normalizeVideo({
        id: this._urlToId(v.url),
        webpage_url: v.url,
        title: v.title,
        thumbnail: v.thumbnail,
        duration: v.duration,
        view_count: v.view_count,
        uploader: v.uploader,
        source: siteKey,
      }))
    } finally {
      await page.close()
    }
  }

  _urlToId(url) {
    // Generate a stable ID from URL
    return url.replace(/https?:\/\/(www\.)?/, '').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 64)
  }

  _getSiteKey(siteOrDomain) {
    // Normalize "www.pornhub.com" -> "pornhub.com"
    const clean = siteOrDomain.replace(/^www\./, '')
    if (SITE_CONFIGS[clean]) return clean

    // Try partial match
    for (const key of Object.keys(SITE_CONFIGS)) {
      if (clean.includes(key) || key.includes(clean)) return key
    }
    return null
  }

  async search(query, options = {}) {
    const { site = 'pornhub.com', limit = 20 } = options
    const siteKey = this._getSiteKey(site)
    if (!siteKey) throw new Error(`Scraper doesn't support ${site}`)

    const config = SITE_CONFIGS[siteKey]
    const url = config.searchUrl(query)
    return this._scrapeVideoList(url, siteKey, { limit })
  }

  async fetchCategory(categoryUrl, options = {}) {
    const { limit = 20 } = options

    // Figure out which site from the URL
    let siteKey = null
    for (const key of Object.keys(SITE_CONFIGS)) {
      if (categoryUrl.includes(key)) { siteKey = key; break }
    }
    if (!siteKey) throw new Error(`Can't determine site from URL: ${categoryUrl}`)

    return this._scrapeVideoList(categoryUrl, siteKey, { limit })
  }

  async fetchTrending(options = {}) {
    const { site = 'pornhub.com', limit = 20 } = options
    const siteKey = this._getSiteKey(site)
    if (!siteKey) throw new Error(`Scraper doesn't support ${site}`)

    const config = SITE_CONFIGS[siteKey]
    return this._scrapeVideoList(config.trendingUrl, siteKey, { limit })
  }

  // Multi-site search: hit all configured sites in parallel
  async searchAll(query, options = {}) {
    const { limit = 10 } = options
    const sites = Object.keys(SITE_CONFIGS)

    const results = await Promise.allSettled(
      sites.map(site => this.search(query, { site, limit }))
    )

    const videos = []
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled') {
        videos.push(...results[i].value)
      } else {
        console.warn(`  ⚠️  Scraper search failed on ${sites[i]}: ${results[i].reason?.message}`)
      }
    }

    return videos
  }

  // Cleanup: close the browser when shutting down
  async close() {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }
}

// Export supported sites for use in UI/config
export const SUPPORTED_SITES = Object.keys(SITE_CONFIGS)
