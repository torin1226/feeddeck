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
import { logger } from '../logger.js'

// Lazy import: puppeteer-extra + stealth plugin for Cloudflare bypass.
// Falls back to plain puppeteer if puppeteer-extra is not installed.
let puppeteer = null
async function getPuppeteer() {
  if (!puppeteer) {
    try {
      const extra = await import('puppeteer-extra')
      const stealth = await import('puppeteer-extra-plugin-stealth')
      const pptr = extra.default || extra
      pptr.use((stealth.default || stealth)())
      puppeteer = pptr
      logger.info('Puppeteer loaded with stealth plugin')
    } catch {
      try {
        const plain = await import('puppeteer')
        puppeteer = plain.default || plain
        logger.info('Puppeteer loaded without stealth (puppeteer-extra not available)')
      } catch {
        throw new Error('puppeteer not installed. Run: npm install puppeteer')
      }
    }
  }
  return puppeteer
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
      title: 'span.title a',
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
      title: '.title a',
      thumbnail: '.thumb-link img',
      duration: 'span.duration',
      views: 'span.views-count',
      uploader: 'a.name',
      link: '.title a, .thumb-link',
    },
    thumbnailAttr: ['data-src', 'src'],
    baseUrl: 'https://www.xvideos.com',
  },

  'spankbang.com': {
    searchUrl: (q) => `https://spankbang.com/s/${encodeURIComponent(q)}/`,
    categoryUrl: (cat) => `https://spankbang.com/t/${encodeURIComponent(cat)}/`,
    trendingUrl: 'https://spankbang.com/trending_videos/',
    selectors: {
      videoCard: '.js-video-item, [data-testid="video-item"]',
      title: '.line-clamp-2 a[title], [data-testid="video-info-with-badge"] a[href*="/video/"][title]',
      thumbnail: 'img[x-ref="thumbnail"], picture img',
      duration: '[data-testid="video-item-length"]',
      views: '[data-testid="views"]',
      uploader: 'a[data-testid="title"]',
      link: 'a[href*="/video/"], a[href*="/video"]',
    },
    thumbnailAttr: ['src', 'data-src'],
    baseUrl: 'https://spankbang.com',
  },

  'redtube.com': {
    searchUrl: (q) => `https://www.redtube.com/?search=${encodeURIComponent(q)}`,
    categoryUrl: (cat) => `https://www.redtube.com/category/${encodeURIComponent(cat)}`,
    trendingUrl: 'https://www.redtube.com/mostviewed?period=today',
    ageGate: true,
    selectors: {
      videoCard: 'li.thumbnail-card[data-video-id]',
      title: 'a.tm_video_title',
      thumbnail: 'picture.video_thumb_image img',
      duration: 'span.tm_video_duration',
      views: 'span.info-views',
      uploader: 'a.author-title-text',
      link: 'a.video_link',
    },
    thumbnailAttr: ['data-src', 'src'],
    baseUrl: 'https://www.redtube.com',
  },

  'youporn.com': {
    searchUrl: (q) => `https://www.youporn.com/search/?query=${encodeURIComponent(q)}`,
    categoryUrl: (cat) => `https://www.youporn.com/category/${encodeURIComponent(cat)}/`,
    trendingUrl: 'https://www.youporn.com/most_viewed/?t=t',
    ageGate: true,
    selectors: {
      videoCard: 'article.video-box[data-video-id]',
      title: 'a.video-title-text',
      thumbnail: 'img.thumb-image',
      duration: '.video-duration span',
      views: 'span.info-views',
      uploader: 'a.author-title-text',
      link: 'a.tm_video_link[href*="/watch/"]',
    },
    thumbnailAttr: ['data-src', 'src'],
    baseUrl: 'https://www.youporn.com',
  },

  'xhamster.com': {
    searchUrl: (q) => `https://xhamster.com/search/${encodeURIComponent(q)}`,
    categoryUrl: (cat) => `https://xhamster.com/categories/${encodeURIComponent(cat)}`,
    trendingUrl: 'https://xhamster.com/trending',
    selectors: {
      videoCard: '.thumb-list__item, .video-thumb',
      title: 'a.video-thumb-info__name, a[title]',
      thumbnail: 'img.thumb-image-container__image, img[data-src]',
      duration: '.thumb-image-container__duration, span.duration',
      views: '.video-thumb-views, span.views',
      uploader: '.video-uploader a',
      link: 'a.video-thumb-info__name, a.video-thumb__image-container',
    },
    thumbnailAttr: ['data-src', 'src'],
    baseUrl: 'https://xhamster.com',
  },
}

export class ScraperAdapter extends SourceAdapter {
  constructor() {
    super({
      name: 'scraper',
      supportedDomains: [...Object.keys(SITE_CONFIGS), 'redgifs.com', 'fikfap.com'],
      capabilities: {
        search: true,
        categories: true,
        trending: true,
        metadata: false,  // Use yt-dlp for metadata enrichment
        streamUrl: false,  // Use yt-dlp for stream URLs
      },
    })
    this.browser = null
    this._consecutiveFailures = 0
    this._idleTimer = null
  }

  async _getBrowser() {
    if (this.browser?.connected) return this.browser

    // Close any existing disconnected browser to prevent leaked processes
    if (this.browser) {
      logger.info('Closing disconnected Puppeteer browser before launching new one')
      await this.browser.close().catch(() => {})
      this.browser = null
    }

    const pptr = await getPuppeteer()

    // Retry launch once after a short delay. On low-memory systems (e.g. Beelink 8GB),
    // an OOM during a refresh rotation would otherwise throw synchronously and propagate
    // up through every active scraper call simultaneously, disabling all Puppeteer sources.
    // Returning null instead lets callers degrade gracefully to empty results.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
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
      } catch (err) {
        logger.warn(`Puppeteer launch failed (attempt ${attempt}/2): ${err.message}`)
        this.browser = null
        if (attempt < 2) await new Promise(r => setTimeout(r, 2000))
      }
    }

    logger.error('Puppeteer failed to launch after 2 attempts -- scraper will return empty results until next retry')
    return null
  }

  async _newPage() {
    const browser = await this._getBrowser()
    if (!browser) return null
    const page = await browser.newPage()

    // Reset idle timeout — close browser after 10 min of no scraping activity
    clearTimeout(this._idleTimer)
    this._idleTimer = setTimeout(async () => {
      if (this.browser) {
        logger.info('Closing idle Puppeteer browser (10 min timeout)')
        await this.browser.close().catch(() => {})
        this.browser = null
      }
    }, 10 * 60 * 1000)

    try {
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
          try { req.abort() } catch {}
        } else {
          try { req.continue() } catch {}
        }
      })
    } catch (err) {
      await page.close().catch(() => {})
      throw err
    }

    return page
  }

  // Scrape a page and extract video cards
  async _scrapeVideoList(url, siteKey, options = {}) {
    const { limit = 20, scrollCount = 2 } = options
    const config = SITE_CONFIGS[siteKey]
    if (!config) throw new Error(`No scraper config for ${siteKey}`)

    let page
    try {
      page = await this._newPage()
      if (!page) {
        logger.warn(`Scraper: Chromium unavailable, skipping ${siteKey} (${url})`)
        return []
      }
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })

      // Cloudflare challenge detection: if the page title indicates a challenge,
      // wait up to 15 seconds for it to auto-solve (JS challenges resolve in 3-8s).
      const CF_WAIT_MS = 15_000
      const CF_CHECK_INTERVAL = 1_000
      let pageTitle = await page.title().catch(() => '')
      if (pageTitle.includes('Cloudflare') || pageTitle.includes('Attention Required') || pageTitle.includes('Just a moment')) {
        logger.info(`Scraper: Cloudflare challenge detected for ${siteKey}, waiting up to ${CF_WAIT_MS / 1000}s...`)
        const deadline = Date.now() + CF_WAIT_MS
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, CF_CHECK_INTERVAL))
          pageTitle = await page.title().catch(() => '')
          if (!pageTitle.includes('Cloudflare') && !pageTitle.includes('Attention Required') && !pageTitle.includes('Just a moment')) {
            logger.info(`Scraper: Cloudflare challenge resolved for ${siteKey} (title: "${pageTitle}")`)
            break
          }
        }
      }

      // Age gate dismissal: some sites (RedTube, YouPorn) show an age verification
      // overlay before content is visible. Click through it automatically.
      if (config.ageGate) {
        /* eslint-disable no-undef -- runs in Puppeteer browser context */
        const dismissed = await page.evaluate(() => {
          // Try common age gate button patterns
          const selectors = [
            '#js_enterForm button[type="submit"]',
            'button[data-testid="age-verification-enter"]',
          ]
          for (const sel of selectors) {
            const btn = document.querySelector(sel)
            if (btn) { btn.click(); return sel }
          }
          // Fallback: find button/link with "I am 18" or "Enter" text
          for (const btn of document.querySelectorAll('button, a')) {
            const text = btn.textContent?.trim()?.toLowerCase() || ''
            if ((text.includes('i am 18') || text.includes('enter')) && !text.includes('sign') && !text.includes('cookie')) {
              btn.click()
              return `text:"${btn.textContent.trim().slice(0, 40)}"`
            }
          }
          return null
        }).catch(() => null)
        /* eslint-enable no-undef */

        if (dismissed) {
          logger.info(`Scraper: dismissed age gate for ${siteKey} (${dismissed})`)
          await new Promise(r => setTimeout(r, 2000))
          await page.waitForNetworkIdle({ timeout: 8000 }).catch(() => {})
        }
      }

      // Wait for video cards to appear. Log a warning if the selector times out
      // so stale selectors are visible in server logs rather than silently returning 0.
      const selectorFound = await page.waitForSelector(config.selectors.videoCard, { timeout: 10_000 })
        .then(() => true)
        .catch(() => false)

      if (!selectorFound) {
        pageTitle = await page.title().catch(() => '(unknown)')
        logger.warn(`Scraper: no cards found for "${siteKey}" at ${url} (selector: ${config.selectors.videoCard}, page title: "${pageTitle}"). Selectors may be stale or the page requires login.`)
      }

      // Scroll to load lazy content
      for (let i = 0; i < scrollCount; i++) {
        // eslint-disable-next-line no-undef
        await page.evaluate(() => window.scrollBy(0, window.innerHeight))
        await new Promise(r => setTimeout(r, 800))
      }

      // Extract video data from the DOM
      const videos = await page.evaluate((cfg, maxResults) => {
        // eslint-disable-next-line no-undef
        const cards = document.querySelectorAll(cfg.selectors.videoCard)
        const results = []

        for (const card of cards) {
          if (results.length >= maxResults) break

          // Title — prefer title attribute (more reliable on adult sites), fall back to text content
          const titleEl = card.querySelector(cfg.selectors.title)
          const title = titleEl?.getAttribute('title') || titleEl?.textContent?.trim() || ''
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

          // Duration text: "12:34", "1:05:30", "10m", "1h 5m"
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
          } else {
            // Handle "10m", "1h 5m", "1h" formats
            const hMatch = durText.match(/(\d+)\s*h/)
            const mMatch = durText.match(/(\d+)\s*m/)
            if (hMatch) duration += parseInt(hMatch[1]) * 3600
            if (mMatch) duration += parseInt(mMatch[1]) * 60
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
      this._consecutiveFailures = 0
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
    } catch (err) {
      this._consecutiveFailures++
      logger.warn(`Scraper failure #${this._consecutiveFailures} for ${siteKey}: ${err.message}`)
      if (this._consecutiveFailures >= 5 || !this.browser?.connected) {
        logger.info('Closing Puppeteer browser after repeated failures or disconnected state')
        await this.browser?.close().catch(() => {})
        this.browser = null
        this._consecutiveFailures = 0
      }
      throw err
    } finally {
      if (page) await page.close().catch(() => {})
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
    if (clean === 'redgifs.com') return 'redgifs.com'
    if (clean === 'fikfap.com') return 'fikfap.com'

    // Try partial match
    for (const key of Object.keys(SITE_CONFIGS)) {
      if (clean.includes(key) || key.includes(clean)) return key
    }
    if (clean.includes('redgifs') || 'redgifs.com'.includes(clean)) return 'redgifs.com'
    if (clean.includes('fikfap') || 'fikfap.com'.includes(clean)) return 'fikfap.com'
    return null
  }

  // RedGifs uses a JSON API with temporary bearer tokens
  async _getRedGifsToken() {
    // Cache token for 1 hour (they last ~24h but we play it safe)
    if (this._redGifsToken && Date.now() < this._redGifsTokenExpiry) {
      return this._redGifsToken
    }
    const res = await fetch('https://api.redgifs.com/v2/auth/temporary', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36' },
    })
    if (!res.ok) throw new Error(`RedGifs auth error: ${res.status}`)
    const data = await res.json()
    this._redGifsToken = data.token
    this._redGifsTokenExpiry = Date.now() + 60 * 60 * 1000
    return this._redGifsToken
  }

  async searchRedGifs(query, options = {}) {
    const { limit = 20 } = options
    const token = await this._getRedGifsToken()

    // HYDRATION: Parse RedGifs URLs to extract the actual search query or detect trending.
    // refillCategory passes URLs like "https://www.redgifs.com/search?query=amateur&order=trending"
    // which must not be encoded wholesale as search_text.
    // Note: /v2/gifs/trending endpoint was removed ~April 2026. Use /v2/gifs/search with order=trending instead.
    let apiUrl
    if (query.includes('redgifs.com')) {
      try {
        const parsed = new URL(query)
        if (parsed.pathname.includes('/trending')) {
          const type = parsed.searchParams.get('type') || ''
          apiUrl = `https://api.redgifs.com/v2/gifs/search?search_text=&order=trending&count=${limit}${type ? `&type=${type}` : ''}`
        } else if (parsed.searchParams.has('query')) {
          const searchText = parsed.searchParams.get('query')
          const order = parsed.searchParams.get('order') || ''
          apiUrl = `https://api.redgifs.com/v2/gifs/search?search_text=${encodeURIComponent(searchText)}&count=${limit}${order ? `&order=${order}` : ''}`
        } else {
          // Fall back to using the path segment as search text
          const pathSearch = parsed.pathname.split('/').filter(Boolean).pop() || query
          apiUrl = `https://api.redgifs.com/v2/gifs/search?search_text=${encodeURIComponent(pathSearch)}&count=${limit}`
        }
      } catch {
        apiUrl = `https://api.redgifs.com/v2/gifs/search?search_text=${encodeURIComponent(query)}&count=${limit}`
      }
    } else {
      apiUrl = `https://api.redgifs.com/v2/gifs/search?search_text=${encodeURIComponent(query)}&count=${limit}`
    }

    const res = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    })
    if (!res.ok) throw new Error(`RedGifs API error: ${res.status}`)

    const data = await res.json()
    const gifs = data.gifs || []

    return gifs.slice(0, limit).map(g => ({
      ...this.normalizeVideo({
        id: g.id,
        webpage_url: `https://www.redgifs.com/watch/${g.id}`,
        title: g.description || g.tags?.join(', ') || g.id,
        thumbnail: g.urls?.poster || g.urls?.thumbnail || '',
        duration: Math.round(g.duration || 0),
        view_count: g.views || 0,
        like_count: g.likes ?? null,
        timestamp: g.createDate ?? null,
        uploader: g.userName || '',
        source: 'redgifs.com',
      }),
      // RedGifs API returns direct CDN stream URLs -- bypass yt-dlp for faster playback.
      stream_url: g.urls?.hd || g.urls?.sd || null,
    }))
  }

  // FikFap uses a JSON API with anonymous UUID auth.
  // No token exchange needed — any random UUID works as authorization-anonymous header.
  async searchFikFap(query, options = {}) {
    const { limit = 20 } = options

    // Map FikFap URL patterns or search queries to API params.
    // FikFap supports sort: new, trending, top, random (not "hot" or "best").
    // The /trending route no longer exists on fikfap.com — use sort=trending instead.
    let sort = 'trending'
    if (query.includes('fikfap.com/new') || query.includes('sort=new')) sort = 'new'
    else if (query.includes('fikfap.com/top') || query.includes('sort=top')) sort = 'top'
    else if (query.includes('fikfap.com/random') || query.includes('sort=random')) sort = 'random'
    else if (query.includes('fikfap.com/trending') || query.includes('fikfap.com')) sort = 'trending'

    // Generate a random anonymous token (FikFap accepts any UUID)
    const anonToken = crypto.randomUUID()
    const url = `https://api.fikfap.com/posts?amount=${limit}&sort=${sort}&useDistinctUserIds=true&minimumScore=-20`

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Origin': 'https://fikfap.com',
        'Referer': 'https://fikfap.com/',
        'authorization-anonymous': anonToken,
        'isloggedin': 'false',
        'ispwa': 'false',
      },
    })
    if (!res.ok) throw new Error(`FikFap API error: ${res.status}`)

    const posts = await res.json()
    if (!Array.isArray(posts)) throw new Error('FikFap API returned unexpected format')

    return posts.slice(0, limit).map(p => {
      // Build a canonical URL from the postId
      const webUrl = `https://fikfap.com/post/${p.postId}`

      // Title: use label (description), fall back to hashtags or postId
      const hashtagStr = p.hashtags?.map(h => `#${h.label}`).join(' ') || ''
      const title = p.label?.trim() || hashtagStr || `FikFap #${p.postId}`

      return {
        ...this.normalizeVideo({
          id: `fikfap_${p.postId}`,
          webpage_url: webUrl,
          title,
          thumbnail: p.thumbnailStreamUrl || '',
          duration: Math.round(p.duration || 0),
          view_count: p.viewsCount || 0,
          uploader: p.author?.username || '',
          source: 'fikfap.com',
        }),
        // FikFap API returns a direct BunnyCDN HLS URL at scrape time.
        // Store it now so playback works without yt-dlp (which may not support fikfap.com).
        stream_url: p.videoStreamUrl || null,
      }
    })
  }

  async search(query, options = {}) {
    const { site = 'pornhub.com', limit = 20 } = options
    const siteKey = this._getSiteKey(site)
    if (!siteKey) throw new Error(`Scraper doesn't support ${site}`)

    // RedGifs and FikFap use JSON APIs, not Puppeteer scraping
    if (siteKey === 'redgifs.com') {
      return this.searchRedGifs(query, { limit })
    }
    if (siteKey === 'fikfap.com') {
      return this.searchFikFap(query, { limit })
    }

    // If the query is already a URL (e.g. category page passed from refillCategory),
    // scrape it directly instead of wrapping it in a search URL.
    // This prevents URLs like "/s/https%3A%2F%2Fspankbang.com%2Ftrending/".
    if (query.startsWith('http')) {
      return this._scrapeVideoList(query, siteKey, { limit })
    }

    const config = SITE_CONFIGS[siteKey]
    const url = config.searchUrl(query)
    return this._scrapeVideoList(url, siteKey, { limit })
  }

  async fetchCategory(categoryUrl, options = {}) {
    const { limit = 20 } = options

    // FikFap uses its own JSON API
    if (categoryUrl.includes('fikfap.com')) {
      return this.searchFikFap(categoryUrl, { limit })
    }

    // RedGifs uses its own JSON API
    if (categoryUrl.includes('redgifs.com')) {
      return this.searchRedGifs(categoryUrl, { limit })
    }

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

  // Multi-site search: hit all configured sites + RedGifs in parallel
  async searchAll(query, options = {}) {
    const { limit = 10 } = options
    const sites = [...Object.keys(SITE_CONFIGS), 'redgifs.com']

    const results = await Promise.allSettled(
      sites.map(site => this.search(query, { site, limit }))
    )

    const videos = []
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled') {
        videos.push(...results[i].value)
      } else {
        logger.warn(`Scraper search failed on ${sites[i]}`, { error: results[i].reason?.message })
      }
    }

    return videos
  }

  // Cleanup: close the browser when shutting down
  async close() {
    clearTimeout(this._idleTimer)
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }
}

// Export supported sites for use in UI/config
export const SUPPORTED_SITES = [...Object.keys(SITE_CONFIGS), 'redgifs.com', 'fikfap.com']
