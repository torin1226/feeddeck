// ============================================================
// trends24.in scraper — youtube.trends24.in/united-states
//
// Scrapes the per-category #group-* sections (music, gaming,
// news-and-politics, sports, comedy, entertainment, science-and-
// technology, howto-and-style, film-and-animation, people-and-blogs)
// plus the all-trending bucket (#group-all). Each section has
// numbered video items with title + creator + watch URL + view metrics,
// plus a "Popular Keywords" panel with 50+ trending search terms.
//
// We harvest:
//   - directVideos: scraped video objects (mapped to FeedDeck shape)
//   - creators: unique uploader names + channel URLs
//   - keywords: trending search terms (used as topic seeds for ytsearch)
//
// Cached for 6h via the trends_cache table by the topics.js layer.
// One concurrent navigation is enforced by reusing the existing
// scraper.js puppeteer instance; we just borrow getPuppeteer().
// ============================================================

import { getPuppeteer } from './scraper.js'
import { logger } from '../logger.js'

const TRENDS_URL = 'https://youtube.trends24.in/united-states/'
const NAV_TIMEOUT_MS = 25_000
const SELECTOR_TIMEOUT_MS = 8_000

let _browser = null
async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser
  const pptr = await getPuppeteer()
  _browser = await pptr.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  _browser.on('disconnected', () => { _browser = null })
  return _browser
}

/**
 * Fetch a single section from youtube.trends24.in.
 *
 * @param {string} sectionAnchor - e.g. "group-music", "group-news-and-politics"
 * @returns {Promise<{videos: object[], creators: object[], keywords: string[]}>}
 */
export async function fetchSection(sectionAnchor) {
  if (!sectionAnchor || !sectionAnchor.startsWith('group-')) {
    throw new Error(`fetchSection requires anchor starting with "group-", got: ${sectionAnchor}`)
  }

  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    )
    await page.setViewport({ width: 1280, height: 1800 })
    await page.goto(`${TRENDS_URL}#${sectionAnchor}`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    })

    // Give the section's video list a moment to render. Generic selector
    // because trends24's exact CSS classes aren't documented; we look for
    // the section container then walk its descendants.
    await page.waitForSelector(`#${sectionAnchor}, [id="${sectionAnchor}"]`, {
      timeout: SELECTOR_TIMEOUT_MS,
    }).catch(() => null)

    const result = await page.evaluate((anchor) => {
      // eslint-disable-next-line no-undef
      const root = document.getElementById(anchor)
      if (!root) return { videos: [], creators: [], keywords: [] }

      // Items live in li / div children with anchor links to YouTube.
      // Each item has at minimum: a watch URL, a title, often a channel
      // link and view count text.
      const itemNodes = root.querySelectorAll('li, .trend-item, .video-item, article')
      const videos = []
      const seenUrls = new Set()
      const creatorMap = new Map() // handle -> channel_url

      const itemArr = itemNodes.length > 0 ? itemNodes : root.querySelectorAll('a[href*="youtube.com/watch"]')

      for (const node of itemArr) {
        const watchAnchor = node.querySelector
          ? node.querySelector('a[href*="youtube.com/watch"], a[href*="youtu.be/"]')
          : (node.getAttribute && node.getAttribute('href') ? node : null)
        if (!watchAnchor) continue
        const href = watchAnchor.href || watchAnchor.getAttribute('href')
        if (!href || seenUrls.has(href)) continue

        const titleEl = (node.querySelector && (
          node.querySelector('h4') || node.querySelector('h3') || node.querySelector('h2') ||
          node.querySelector('.trend-title') || node.querySelector('.title')
        )) || watchAnchor
        const title = (titleEl?.textContent || watchAnchor.textContent || '').trim()
        if (!title) continue

        const channelAnchor = node.querySelector
          ? node.querySelector('a[href*="/channel/"], a[href*="/@"], a[href*="/user/"]')
          : null
        const channelHref = channelAnchor?.href || channelAnchor?.getAttribute?.('href') || null
        const channelName = (channelAnchor?.textContent || '').trim() || null

        // Best-effort view count extraction from any descendant text.
        let viewCount = null
        const text = (node.textContent || '').replace(/\s+/g, ' ')
        const viewsMatch = text.match(/([\d.,]+\s*[KMB]?)\s*views?/i)
        if (viewsMatch) {
          const raw = viewsMatch[1].replace(/[, ]/g, '')
          const m = raw.match(/^([\d.]+)([KMB]?)$/i)
          if (m) {
            const n = parseFloat(m[1])
            const mult = { K: 1e3, M: 1e6, B: 1e9 }[m[2]?.toUpperCase()] || 1
            viewCount = Math.round(n * mult)
          }
        }

        const thumbEl = node.querySelector ? node.querySelector('img') : null
        const thumb = thumbEl?.src || thumbEl?.getAttribute?.('data-src') || null

        seenUrls.add(href)
        videos.push({
          url: href,
          title,
          uploader: channelName,
          channel_url: channelHref,
          view_count: viewCount,
          thumbnail: thumb,
          source: 'youtube.com',
        })

        if (channelName) {
          if (!creatorMap.has(channelName)) creatorMap.set(channelName, channelHref)
        }
      }

      // Popular Keywords panel — usually on #group-all only, but cheap to look for everywhere.
      const keywords = []
      // eslint-disable-next-line no-undef
      const kwContainer = document.querySelector('.popular-keywords, #popular-keywords, [data-section="keywords"]')
      if (kwContainer) {
        for (const a of kwContainer.querySelectorAll('a, li')) {
          const t = (a.textContent || '').trim()
          if (t && t.length < 60) keywords.push(t)
        }
      }
      // Fallback: titles themselves are reasonable topic seeds when the
      // dedicated keywords panel is not present (most sections).
      if (keywords.length === 0) {
        for (const v of videos.slice(0, 12)) {
          // Use the meaningful prefix (drop "| Channel" suffixes etc.).
          const seed = v.title.split(/[|\-—]/)[0].trim()
          if (seed && seed.length >= 8 && seed.length <= 60) keywords.push(seed)
        }
      }

      const creators = [...creatorMap.entries()].map(([handle, channel_url]) => ({ handle, channel_url }))
      return { videos, creators, keywords: keywords.slice(0, 30) }
    }, sectionAnchor)

    return result
  } catch (err) {
    logger.warn('trends24 fetchSection failed', { sectionAnchor, error: err.message })
    return { videos: [], creators: [], keywords: [] }
  } finally {
    try { await page.close() } catch { /* ignore */ }
  }
}

/**
 * Cleanup hook (called from server shutdown if needed).
 */
export async function shutdown() {
  if (_browser) {
    try { await _browser.close() } catch { /* ignore */ }
    _browser = null
  }
}
