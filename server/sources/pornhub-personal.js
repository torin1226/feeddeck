// ============================================================
// PornHub Personal Fetchers
// Authenticated fetchers for the user's own PH content:
//   - fetchLikes()              -> /favorites (Puppeteer + cookies)
//   - fetchSubscriptionsFeed()  -> /subscriptions (yt-dlp + cookies)
//   - fetchModel(handle)        -> /model/{handle}/videos?o=mr (yt-dlp + cookies)
//   - selectTopPHModels()       -> top-3 PH models by creator_boosts score
//
// These power the "persistent_rows" sticky shelves on the NSFW homepage.
// ============================================================

import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { db } from '../database.js'
import { getCookieArgs, parseCookieFile } from '../cookies.js'
import { logger } from '../logger.js'

const execFileAsync = promisify(execFile)

const YTDLP_TIMEOUT = 90_000
const MAX_BUFFER = 50 * 1024 * 1024

// Lazy puppeteer (same pattern as scraper.js)
let _puppeteer = null
async function getPuppeteer() {
  if (_puppeteer) return _puppeteer
  try {
    const extra = await import('puppeteer-extra')
    const stealth = await import('puppeteer-extra-plugin-stealth')
    const pptr = extra.default || extra
    pptr.use((stealth.default || stealth)())
    _puppeteer = pptr
  } catch {
    const plain = await import('puppeteer')
    _puppeteer = plain.default || plain
  }
  return _puppeteer
}

let _browser = null
async function getBrowser() {
  if (_browser?.connected) return _browser
  if (_browser) {
    await _browser.close().catch(() => {})
    _browser = null
  }
  const pptr = await getPuppeteer()
  _browser = await pptr.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  })
  return _browser
}

async function closeBrowser() {
  if (_browser) {
    await _browser.close().catch(() => {})
    _browser = null
  }
}

// Run yt-dlp with PH cookies and return parsed video JSON lines.
async function ytdlpJson(url, { limit = 30, timeout = YTDLP_TIMEOUT } = {}) {
  const cookieArgs = getCookieArgs(url)
  const args = [
    '--js-runtimes', 'node',
    ...cookieArgs,
    '--dump-json',
    '--playlist-end', String(limit),
    '--no-download',
    '--ignore-errors',
    url,
  ]
  let stdout
  try {
    const result = await execFileAsync('yt-dlp', args, {
      encoding: 'utf8',
      timeout,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    })
    stdout = result.stdout
  } catch (err) {
    if (err.stdout?.trim()) stdout = err.stdout
    else throw err
  }
  const videos = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    try {
      videos.push(JSON.parse(line))
    } catch { /* skip malformed */ }
  }
  return videos
}

function normalize(raw) {
  return {
    id: raw.id || randomUUID(),
    url: raw.webpage_url || raw.url || '',
    title: raw.title || 'Untitled',
    thumbnail: raw.thumbnails?.at(-1)?.url || raw.thumbnail || '',
    duration: raw.duration || 0,
    uploader: raw.uploader || raw.channel || raw.creator || '',
    view_count: raw.view_count || 0,
    like_count: raw.like_count ?? null,
    upload_date: raw.upload_date ? `${raw.upload_date.slice(0,4)}-${raw.upload_date.slice(4,6)}-${raw.upload_date.slice(6,8)}` : null,
    tags: raw.tags || [],
  }
}

// Load PH cookies into a Puppeteer page so we can hit authenticated routes.
async function applyPornhubCookies(page) {
  const { cookies } = parseCookieFile('pornhub.com')
  if (!cookies || Object.keys(cookies).length === 0) {
    logger.warn('PH cookie file not found or empty -- /favorites scrape will likely fail')
    return false
  }
  const cookieList = Object.entries(cookies).map(([name, value]) => ({
    name,
    value,
    domain: '.pornhub.com',
    path: '/',
    httpOnly: false,
    secure: true,
  }))
  try {
    await page.setCookie(...cookieList)
    return true
  } catch (err) {
    logger.warn(`PH setCookie failed: ${err.message}`)
    return false
  }
}

// PH doesn't expose /favorites as a shortcut for all accounts -- it 404s.
// The canonical path is /users/{username}/favorites, sometimes /users/{username}/videos/favorites.
// Username is sticky and known: override with PH_USERNAME env var if it ever changes.
const PH_USERNAME = process.env.PH_USERNAME || 'Tonjone92'

function favoritesUrlCandidates() {
  return [
    `https://www.pornhub.com/users/${PH_USERNAME}/favorites`,
    `https://www.pornhub.com/users/${PH_USERNAME}/videos/favorites`,
    `https://www.pornhub.com/users/${PH_USERNAME}/videos/favorites/all`,
  ]
}

/**
 * Fetch PornHub liked/favorite videos. Returns normalized video items
 * with `liked_at` set to the page-rendered like timestamp when available
 * (falls back to null; warm-cache will use added_at instead).
 */
export async function fetchLikes({ limit = 50 } = {}) {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
    )
    await page.setViewport({ width: 1920, height: 1080 })
    const cookiesApplied = await applyPornhubCookies(page)
    if (!cookiesApplied) return []

    let lastError = null
    for (const url of favoritesUrlCandidates()) {
      try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        const finalUrl = page.url()
        if (resp && resp.status() >= 400) {
          lastError = `HTTP ${resp.status()} at ${finalUrl}`
          continue
        }
        if (/\/login/i.test(finalUrl) || /signin/i.test(finalUrl)) {
          lastError = `Redirected to login: ${finalUrl} (cookies may be expired)`
          continue
        }
        // Wait briefly for video cards to render
        await page.waitForSelector('.pcVideoListItem, li.videoBox', { timeout: 8000 }).catch(() => {})

        // page.evaluate runs in the browser context where `document` is defined.
        const items = await page.evaluate(() => {
          // eslint-disable-next-line no-undef
          const cards = document.querySelectorAll('.pcVideoListItem, li.videoBox')
          const out = []
          for (const card of cards) {
            const linkEl = card.querySelector('.title a, a.linkVideoThumb')
            const titleEl = card.querySelector('span.title a')
            const thumbEl = card.querySelector('img.thumb, img[data-thumb_url]')
            const durEl = card.querySelector('.duration, var.duration')
            const viewsEl = card.querySelector('.views, span.views')
            const uploaderEl = card.querySelector('.usernameWrap a')
            const dateEl = card.querySelector('.added, time, .videoDate')

            const href = linkEl?.getAttribute('href') || ''
            if (!href || !/\/view_video\.php\?viewkey=/.test(href)) continue

            const url = href.startsWith('http') ? href : `https://www.pornhub.com${href}`
            const title = titleEl?.textContent?.trim() || ''
            const thumbnail =
              thumbEl?.getAttribute('data-thumb_url') ||
              thumbEl?.getAttribute('data-src') ||
              thumbEl?.getAttribute('src') ||
              ''
            const durationText = durEl?.textContent?.trim() || ''
            const viewsText = viewsEl?.textContent?.trim() || ''
            const uploader = uploaderEl?.textContent?.trim() || ''
            const likedAtText = dateEl?.getAttribute('datetime') || dateEl?.textContent?.trim() || ''

            out.push({ url, title, thumbnail, durationText, viewsText, uploader, likedAtText })
          }
          return out
        })

        const dedup = new Map()
        for (const it of items) {
          if (!dedup.has(it.url)) dedup.set(it.url, it)
        }

        return Array.from(dedup.values()).slice(0, limit).map(it => ({
          id: randomUUID(),
          url: it.url,
          title: it.title,
          thumbnail: it.thumbnail,
          duration: parseDuration(it.durationText),
          uploader: it.uploader,
          view_count: parseViewCount(it.viewsText),
          like_count: null,
          upload_date: null,
          liked_at: null, // PH does not expose like timestamp consistently; rely on added_at ordering
          tags: [],
        }))
      } catch (err) {
        lastError = err.message
      }
    }

    logger.warn(`fetchLikes: all candidate URLs failed -- last error: ${lastError}`)
    return []
  } finally {
    await page.close().catch(() => {})
  }
}

function parseDuration(text) {
  if (!text) return 0
  const parts = text.split(':').map(Number).filter(n => !isNaN(n))
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}

function parseViewCount(text) {
  if (!text) return 0
  const m = text.replace(/[, ]/g, '').match(/([\d.]+)([KMB]?)/i)
  if (!m) return 0
  const n = parseFloat(m[1])
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()] || 1
  return Math.round(n * mult)
}

/**
 * Fetch the authenticated PH subscription feed. yt-dlp can't parse the
 * JS-rendered /subscriptions page reliably, so we try yt-dlp first and
 * fall back to a Puppeteer scrape using the same selectors as /favorites.
 */
export async function fetchSubscriptionsFeed({ limit = 50 } = {}) {
  try {
    const raws = await ytdlpJson('https://www.pornhub.com/subscriptions', { limit })
    const ytItems = raws.map(normalize).filter(v => v.url)
    if (ytItems.length > 0) return ytItems
  } catch (err) {
    logger.warn(`fetchSubscriptionsFeed yt-dlp leg failed: ${err.message}`)
  }
  // Fallback to Puppeteer scrape
  return fetchAuthenticatedListPage('https://www.pornhub.com/subscriptions', { limit })
}

/**
 * Generic authenticated PH page scrape: loads cookies, navigates to URL,
 * extracts videoBox/pcVideoListItem cards. Used by /favorites and as the
 * /subscriptions fallback. Returns normalized items (no liked_at).
 */
async function fetchAuthenticatedListPage(url, { limit = 50 } = {}) {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
    )
    await page.setViewport({ width: 1920, height: 1080 })
    const ok = await applyPornhubCookies(page)
    if (!ok) return []

    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const finalUrl = page.url()
    if (resp && resp.status() >= 400) {
      logger.warn(`fetchAuthenticatedListPage(${url}): HTTP ${resp.status()} at ${finalUrl}`)
      return []
    }
    if (/\/login/i.test(finalUrl) || /signin/i.test(finalUrl)) {
      logger.warn(`fetchAuthenticatedListPage(${url}): redirected to login (${finalUrl})`)
      return []
    }

    await page.waitForSelector('.pcVideoListItem, li.videoBox', { timeout: 8000 }).catch(() => {})

    const items = await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      const cards = document.querySelectorAll('.pcVideoListItem, li.videoBox')
      const out = []
      for (const card of cards) {
        const linkEl = card.querySelector('.title a, a.linkVideoThumb')
        const titleEl = card.querySelector('span.title a')
        const thumbEl = card.querySelector('img.thumb, img[data-thumb_url]')
        const durEl = card.querySelector('.duration, var.duration')
        const viewsEl = card.querySelector('.views, span.views')
        const uploaderEl = card.querySelector('.usernameWrap a')

        const href = linkEl?.getAttribute('href') || ''
        if (!href || !/\/view_video\.php\?viewkey=/.test(href)) continue

        const u = href.startsWith('http') ? href : `https://www.pornhub.com${href}`
        out.push({
          url: u,
          title: titleEl?.textContent?.trim() || '',
          thumbnail:
            thumbEl?.getAttribute('data-thumb_url') ||
            thumbEl?.getAttribute('data-src') ||
            thumbEl?.getAttribute('src') || '',
          durationText: durEl?.textContent?.trim() || '',
          viewsText: viewsEl?.textContent?.trim() || '',
          uploader: uploaderEl?.textContent?.trim() || '',
        })
      }
      return out
    })

    const dedup = new Map()
    for (const it of items) if (!dedup.has(it.url)) dedup.set(it.url, it)

    return Array.from(dedup.values()).slice(0, limit).map(it => ({
      id: randomUUID(),
      url: it.url,
      title: it.title,
      thumbnail: it.thumbnail,
      duration: parseDuration(it.durationText),
      uploader: it.uploader,
      view_count: parseViewCount(it.viewsText),
      like_count: null,
      upload_date: null,
      liked_at: null,
      tags: [],
    }))
  } catch (err) {
    logger.warn(`fetchAuthenticatedListPage(${url}) failed: ${err.message}`)
    return []
  } finally {
    await page.close().catch(() => {})
  }
}

/**
 * Fetch the latest videos from a specific PH model/channel handle.
 * Uses /model/{handle}/videos?o=mr (most recent).
 */
export async function fetchModel(handle, { limit = 30 } = {}) {
  if (!handle) return []
  const url = `https://www.pornhub.com/model/${encodeURIComponent(handle)}/videos?o=mr`
  try {
    const raws = await ytdlpJson(url, { limit })
    return raws.map(normalize).filter(v => v.url)
  } catch (err) {
    logger.warn(`fetchModel(${handle}) failed: ${err.message}`)
    return []
  }
}

/**
 * Returns top-3 PornHub creators by boost_score, filtered to creators
 * whose content has been seen in feed_cache from pornhub.com.
 *
 * @returns {Array<{creator: string, boost_score: number}>}
 */
export function selectTopPHModels({ limit = 3 } = {}) {
  if (!db) return []
  try {
    const rows = db.prepare(`
      SELECT cb.creator, cb.boost_score
      FROM creator_boosts cb
      WHERE cb.boost_score > 0
        AND cb.creator IN (
          SELECT DISTINCT creator
          FROM feed_cache
          WHERE source_domain = 'pornhub.com' AND creator IS NOT NULL AND creator != ''
        )
      ORDER BY cb.boost_score DESC
      LIMIT ?
    `).all(limit)
    return rows
  } catch (err) {
    logger.warn(`selectTopPHModels failed: ${err.message}`)
    return []
  }
}

export const FETCHERS = {
  ph_likes: ({ limit }) => fetchLikes({ limit }),
  ph_subscriptions: ({ limit }) => fetchSubscriptionsFeed({ limit }),
  ph_model: ({ fetcher_arg, limit }) => fetchModel(fetcher_arg, { limit }),
}

export { closeBrowser as _closePornhubPersonalBrowser }
