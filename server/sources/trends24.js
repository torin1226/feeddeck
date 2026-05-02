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

    // Wait for the actual video list. Current markup (verified 2026-05-02):
    //   <h3 id="group-music">Music</h3>
    //   <ol aria-labelledby="group-music" class="video-list">
    //     <li class="video-item">
    //       <div class="video-card">
    //         <a class="video-link" href="..." data-id="...">
    //           <img class="thumbnail">
    //           <h4 class="vc-title">...</h4>
    //           <p>Published <span>X ago</span> by <span class="font-medium">Channel</span></p>
    //           <p class="stat-line"><span>Nx views</span>...</p>
    //         </a>
    //       </div>
    //       <script>console.log(JSON.parse('{"channelId":"...","channelTitle":"...","tags":[...]}'))</script>
    //     </li>
    //   </ol>
    // The legacy code looked up `getElementById(anchor)` which returns only the
    // <h3> heading — the <ol> sibling is where the items actually live, so it
    // was always returning empty. Use aria-labelledby to find the list directly.
    const listSelector = `ol.video-list[aria-labelledby="${sectionAnchor}"]`
    await page.waitForSelector(listSelector, {
      timeout: SELECTOR_TIMEOUT_MS,
    }).catch(() => null)

    const result = await page.evaluate((selector) => {
      // eslint-disable-next-line no-undef
      const list = document.querySelector(selector)
      if (!list) return { videos: [], creators: [], keywords: [] }

      const videos = []
      const seenUrls = new Set()
      const creatorMap = new Map() // channelTitle -> channelId-derived URL

      const parseCount = (raw) => {
        if (!raw) return null
        const m = String(raw).trim().match(/^([\d.,]+)\s*([KMB]?)$/i)
        if (!m) return null
        const n = parseFloat(m[1].replace(/,/g, ''))
        if (!isFinite(n)) return null
        const mult = { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()] || 1
        return Math.round(n * mult)
      }

      for (const li of list.querySelectorAll('li.video-item')) {
        const linkEl = li.querySelector('a.video-link')
        if (!linkEl) continue
        const href = linkEl.getAttribute('href') || linkEl.href || ''
        if (!href || seenUrls.has(href)) continue

        const titleEl = li.querySelector('h4.vc-title')
        const title = (titleEl?.textContent || '').trim()
        if (!title) continue

        // Channel name lives in the second <span class="font-medium"> inside
        // the meta paragraph: "Published <span>X ago</span> by <span>Name</span>".
        const metaSpans = li.querySelectorAll('p .font-medium, p span.font-medium')
        const channelName = metaSpans.length >= 2
          ? (metaSpans[metaSpans.length - 1].textContent || '').trim()
          : null

        // First <span> in stat-line holds the view count text.
        const viewSpan = li.querySelector('p.stat-line > span:first-of-type')
        // Strip leading SVG label text (e.g. "Views ") so only the number remains.
        const viewText = (viewSpan?.textContent || '').replace(/Views?/i, '').trim()
        const viewCount = parseCount(viewText)

        const thumbEl = li.querySelector('img.thumbnail')
        const thumb = thumbEl?.getAttribute('src') || thumbEl?.getAttribute('data-src') || null

        // Channel URL isn't in the DOM, but each item embeds a JSON payload
        // in a sibling <script> tag (console.log(JSON.parse('{...}'))). When
        // present, extract channelId to build a canonical channel URL.
        let channelUrl = null
        const scriptEl = li.querySelector('script')
        if (scriptEl?.textContent) {
          const jsonMatch = scriptEl.textContent.match(/JSON\.parse\('([\s\S]+?)'\)/)
          if (jsonMatch) {
            try {
              const meta = JSON.parse(jsonMatch[1].replace(/\\'/g, "'"))
              if (meta?.channelId) {
                channelUrl = `https://www.youtube.com/channel/${meta.channelId}`
              }
            } catch { /* malformed script payload — fall back to null */ }
          }
        }

        seenUrls.add(href)
        videos.push({
          url: href,
          title,
          uploader: channelName,
          channel_url: channelUrl,
          view_count: viewCount,
          thumbnail: thumb,
          source: 'youtube.com',
        })

        if (channelName && !creatorMap.has(channelName)) {
          creatorMap.set(channelName, channelUrl)
        }
      }

      // Popular Keywords panel — current markup is <ol class="keywords-list"><li>term</li>...
      const keywords = []
      // eslint-disable-next-line no-undef
      const kwList = document.querySelector('ol.keywords-list')
      if (kwList) {
        for (const li of kwList.querySelectorAll('li')) {
          const t = (li.textContent || '').trim()
          if (t && t.length < 60) keywords.push(t)
        }
      }
      // Fallback: titles themselves are reasonable topic seeds when the
      // dedicated keywords panel is not present (most per-genre sections).
      if (keywords.length === 0) {
        for (const v of videos.slice(0, 12)) {
          const seed = v.title.split(/[|\-—]/)[0].trim()
          if (seed && seed.length >= 8 && seed.length <= 60) keywords.push(seed)
        }
      }

      const creators = [...creatorMap.entries()].map(([handle, channel_url]) => ({ handle, channel_url }))
      return { videos, creators, keywords: keywords.slice(0, 30) }
    }, listSelector)

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
