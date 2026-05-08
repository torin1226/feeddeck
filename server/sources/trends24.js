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
// --- Resilience strategy ---
// Each <li class="video-item"> ships a <script>console.log(JSON.parse('{...}'))</script>
// payload that is the YouTube Data API response for the video. It contains
// title, channelTitle, channelId, publishedAt, thumbnails (5 resolutions),
// tags, categoryId, and description. This is the app's data layer, not its
// presentation layer, and is far more stable across visual redesigns.
//
// Item extraction priority:
//   1. JSON payload (title, channelTitle, channelId, thumbnails, tags, publishedAt)
//   2. DOM selectors (watch URL from <a>, view_count from stat-line)
//   3. Structural heuristics (any <a href*=youtube>, any <img>, first heading)
//
// Section list discovery also uses layered fallbacks:
//   1. ol.video-list[aria-labelledby="group-X"]  — semantic attribute (stable)
//   2. [aria-labelledby="group-X"]               — any tag with aria attribute
//   3. #group-X ~ ol                              — structural sibling
//   4. #group-X ~ ul
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

    // Wait for the primary selector. If it times out, page.evaluate() will
    // try the fallback selectors — the page is loaded regardless.
    const primarySelector = `ol.video-list[aria-labelledby="${sectionAnchor}"]`
    await page.waitForSelector(primarySelector, {
      timeout: SELECTOR_TIMEOUT_MS,
    }).catch(() => null)

    const result = await page.evaluate((anchor) => {
      // --- Section list discovery (layered fallbacks) ---
      // Each candidate is tried in order; first that returns a non-empty list wins.
      const listCandidates = [
        `ol.video-list[aria-labelledby="${anchor}"]`,  // current markup (verified 2026-05-02)
        `[aria-labelledby="${anchor}"]`,               // any tag — survives ol→ul rewrites
        `#${anchor} ~ ol`,                             // structural sibling after heading
        `#${anchor} ~ ul`,
      ]
      let list = null
      for (const sel of listCandidates) {
        // eslint-disable-next-line no-undef
        const candidate = document.querySelector(sel)
        if (candidate && candidate.querySelectorAll('li').length > 0) {
          list = candidate
          break
        }
      }
      if (!list) return { videos: [], creators: [], keywords: [], _listSelector: null }

      // --- Helpers ---
      const parseCount = (raw) => {
        if (!raw) return null
        const m = String(raw).trim().match(/^([\d.,]+)\s*([KMB]?)$/i)
        if (!m) return null
        const n = parseFloat(m[1].replace(/,/g, ''))
        if (!isFinite(n)) return null
        const mult = { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()] || 1
        return Math.round(n * mult)
      }

      // Parse the per-item embedded JSON payload:
      //   <script>console.log(JSON.parse('{"channelId":"...","title":"...","thumbnails":{...},...}'))</script>
      // This is the YouTube Data API response embedded by the site — data layer,
      // not presentation layer. Far more stable than CSS class names.
      const parseItemMeta = (li) => {
        const scriptEl = li.querySelector('script')
        if (!scriptEl?.textContent) return null
        const m = scriptEl.textContent.match(/JSON\.parse\('([\s\S]+?)'\)/)
        if (!m) return null
        try {
          return JSON.parse(m[1].replace(/\\'/g, "'"))
        } catch { return null }
      }

      // Best available thumbnail URL (prefer high-res from JSON payload).
      const bestThumb = (meta, li) => {
        if (meta?.thumbnails) {
          const t = meta.thumbnails
          return (t.maxres || t.standard || t.high || t.medium || t.default)?.url || null
        }
        const img = li.querySelector('img')
        return img?.getAttribute('src') || img?.getAttribute('data-src') || null
      }

      // Derive watch URL from YouTube thumbnail URL: .../vi/VIDEO_ID/...
      const urlFromThumb = (thumbUrl) => {
        if (!thumbUrl) return null
        const m = thumbUrl.match(/\/vi\/([^/]+)\//)
        return m ? `https://www.youtube.com/watch?v=${m[1]}` : null
      }

      // --- Item extraction ---
      const videos = []
      const seenUrls = new Set()
      const creatorMap = new Map()
      const allItemTags = []

      for (const li of list.querySelectorAll('li')) {
        const meta = parseItemMeta(li)

        // Title: JSON > h4.vc-title > any h4/h3 > first heading
        const title = (
          meta?.title ||
          li.querySelector('h4.vc-title')?.textContent ||
          li.querySelector('h4, h3, h2')?.textContent ||
          ''
        ).trim()
        if (!title) continue

        // Watch URL: DOM link (most direct) > derive from JSON thumbnail
        const linkEl = li.querySelector('a[href*="youtube.com/watch"], a.video-link, a[href*="youtu"]')
        const domUrl = linkEl?.getAttribute('href') || linkEl?.href || ''
        const thumb = bestThumb(meta, li)
        const url = domUrl || urlFromThumb(thumb) || ''
        if (!url || seenUrls.has(url)) continue

        // Channel info: JSON > DOM meta spans
        const channelName = (
          meta?.channelTitle ||
          (() => {
            const spans = li.querySelectorAll('p .font-medium, p span.font-medium')
            return spans.length >= 2 ? spans[spans.length - 1].textContent : null
          })() ||
          ''
        ).trim() || null

        const channelUrl = meta?.channelId
          ? `https://www.youtube.com/channel/${meta.channelId}`
          : null

        // View count: DOM only (not in JSON payload)
        const viewSpan = li.querySelector(
          'p.stat-line > span:first-of-type, .stat-line span:first-of-type, [class*="stat"] span'
        )
        const viewText = (viewSpan?.textContent || '').replace(/Views?/i, '').trim()
        const viewCount = parseCount(viewText)

        // Upload date: JSON only (DOM has no date)
        const uploadDate = meta?.publishedAt || null

        seenUrls.add(url)
        videos.push({
          url,
          title,
          uploader: channelName,
          channel_url: channelUrl,
          view_count: viewCount,
          thumbnail: thumb,
          upload_date: uploadDate,
          source: 'youtube.com',
        })

        if (channelName && !creatorMap.has(channelName)) {
          creatorMap.set(channelName, channelUrl)
        }

        if (Array.isArray(meta?.tags)) {
          allItemTags.push(...meta.tags)
        }
      }

      // --- Keywords ---
      // Priority: dedicated keywords panel > JSON tags from items > title-derived seeds
      const keywords = []
      // eslint-disable-next-line no-undef
      const kwList = document.querySelector('ol.keywords-list, ul.keywords-list, [class*="keyword"] ol, [class*="keyword"] ul')
      if (kwList) {
        for (const li of kwList.querySelectorAll('li')) {
          const t = (li.textContent || '').trim()
          if (t && t.length < 60) keywords.push(t)
        }
      }
      if (keywords.length < 10 && allItemTags.length > 0) {
        // Deduplicate tags by frequency, prefer shorter/cleaner terms
        const tagFreq = new Map()
        for (const tag of allItemTags) {
          const t = tag.trim()
          if (t && t.length >= 4 && t.length <= 50) {
            tagFreq.set(t, (tagFreq.get(t) || 0) + 1)
          }
        }
        const sortedTags = [...tagFreq.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([t]) => t)
        for (const tag of sortedTags) {
          if (!keywords.includes(tag)) keywords.push(tag)
        }
      }
      if (keywords.length === 0) {
        for (const v of videos.slice(0, 12)) {
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
