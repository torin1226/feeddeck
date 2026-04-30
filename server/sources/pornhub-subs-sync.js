// ============================================================
// PornHub Subscriptions Sync
//
// Replaces the old `/subscriptions` page scraper (which was actually a
// PH-curated "videos similar to subscriptions" recommender, not the
// real list). Strategy:
//
//   1. syncPornhubSubscriptions() — scrape the user's two canonical
//      subscription pages and upsert each creator into the `creators`
//      table with platform='pornhub'. Each creator's URL prefix
//      (/pornstar/, /model/, /channels/) tells us how to fetch their
//      videos later.
//
//   2. fetchSubscribedCreatorsAggregated() — walk the creators table
//      (today: pornhub only, but cross-platform-ready), fetch latest
//      videos for each, merge, sort by upload_date, return top N.
//
// The persistent row "From Your Subscriptions" calls this aggregator
// and gets back actual videos from creators the user has subscribed
// to, instead of recommendations.
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

const PH_USERNAME = process.env.PH_USERNAME || 'Tonjone92'

// Lazy puppeteer
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

export async function _closeBrowser() {
  if (_browser) {
    await _browser.close().catch(() => {})
    _browser = null
  }
}

async function applyPornhubCookies(page) {
  const { cookies } = parseCookieFile('pornhub.com')
  if (!cookies || Object.keys(cookies).length === 0) return false
  const cookieList = Object.entries(cookies).map(([name, value]) => ({
    name, value, domain: '.pornhub.com', path: '/', httpOnly: false, secure: true,
  }))
  try {
    await page.setCookie(...cookieList)
    return true
  } catch {
    return false
  }
}

/**
 * Pull the user's actual PH subscriptions. Visits two pages and reads
 * the canonical containers identified during DOM probing:
 *   - /pornstar_subscriptions:
 *       #moreData                           (pornstars,  /pornstar/*)
 *       #profileSubscriptions
 *         ul#sideBarSubscriptionsSection    (models,     /model/*)
 *         ul.channelSubcriptions            (channels,   /channels/*)
 *   - /channel_subscriptions:
 *       #moreData                           (channels,   /channels/*)
 *
 * Channels and models from both pages are unioned to be safe against
 * the per-page sidebar truncating long lists.
 *
 * @returns {Array<{name: string, url: string, type: 'pornstar'|'model'|'channel', handle: string}>}
 */
export async function fetchSubscribedHandles() {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
    )
    await page.setViewport({ width: 1920, height: 1080 })
    if (!await applyPornhubCookies(page)) {
      logger.warn('PH subs sync: no cookies, aborting')
      return []
    }

    const collected = new Map() // url -> { name, url, type, handle }

    const collectFromPage = async (url) => {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      const finalUrl = page.url()
      if ((resp && resp.status() >= 400) || /\/login|signin/i.test(finalUrl)) {
        logger.warn(`PH subs sync: ${url} → ${resp?.status()} / ${finalUrl}`)
        return
      }
      // Selectors derived from DOM probing in diagnose-ph-sub-extract.mjs
      const items = await page.evaluate(() => {
        const out = []
        const containers = [
          '#moreData',
          '#profileSubscriptions ul#sideBarSubscriptionsSection',
          '#profileSubscriptions ul.channelSubcriptions',
          '#sidebarPornstars ul#pornstarProfileSideBar',
        ]
        for (const sel of containers) {
          // eslint-disable-next-line no-undef
          const root = document.querySelector(sel)
          if (!root) continue
          const links = root.querySelectorAll(
            'a[href^="/pornstar/"], a[href^="/model/"], a[href^="/channels/"]'
          )
          for (const a of links) {
            const href = a.getAttribute('href') || ''
            const m = href.match(/^\/(pornstar|model|channels)\/([^/?#]+)/)
            if (!m) continue
            const text = (a.textContent || '').trim()
            if (!text) continue // skip thumbnail-only anchors
            out.push({
              type: m[1] === 'channels' ? 'channel' : m[1],
              handle: m[2],
              path: `/${m[1]}/${m[2]}`,
              name: text,
            })
          }
        }
        return out
      })
      for (const it of items) {
        const fullUrl = `https://www.pornhub.com${it.path}`
        if (!collected.has(fullUrl)) {
          collected.set(fullUrl, {
            name: it.name,
            url: fullUrl,
            type: it.type,
            handle: it.handle,
          })
        }
      }
    }

    await collectFromPage(`https://www.pornhub.com/users/${PH_USERNAME}/pornstar_subscriptions`)
    await collectFromPage(`https://www.pornhub.com/users/${PH_USERNAME}/channel_subscriptions`)

    return Array.from(collected.values())
  } finally {
    await page.close().catch(() => {})
  }
}

/**
 * Scrape and upsert into the existing `creators` table with
 * platform='pornhub'. Mirrors what subscription_backups + creators
 * does for other platforms.
 *
 * @returns {{added: number, kept: number, removed: number}}
 */
export async function syncPornhubSubscriptions() {
  const handles = await fetchSubscribedHandles()
  if (!handles.length) {
    logger.warn('PH subs sync: 0 handles found — leaving creators table untouched')
    return { added: 0, kept: 0, removed: 0 }
  }

  const upsert = db.prepare(`
    INSERT INTO creators (platform, handle, url, label, active)
    VALUES ('pornhub', ?, ?, ?, 1)
    ON CONFLICT(platform, handle) DO UPDATE SET
      url = excluded.url,
      label = excluded.label,
      active = 1
  `)
  let added = 0, kept = 0
  const seenHandles = new Set()
  for (const h of handles) {
    seenHandles.add(h.handle)
    const before = db.prepare(
      "SELECT id FROM creators WHERE platform = 'pornhub' AND handle = ?"
    ).get(h.handle)
    upsert.run(h.handle, h.url, h.name || h.handle)
    if (before) kept++; else added++
  }

  // Mark inactive any pornhub creator we no longer see in the user's
  // list (PH cookie source of truth). Don't delete — keeps history.
  let removed = 0
  if (seenHandles.size > 0) {
    const stale = db.prepare(`
      SELECT id, handle FROM creators
      WHERE platform = 'pornhub' AND active = 1
    `).all()
    const deactivate = db.prepare('UPDATE creators SET active = 0 WHERE id = ?')
    for (const c of stale) {
      if (!seenHandles.has(c.handle)) {
        deactivate.run(c.id)
        removed++
      }
    }
  }
  return { added, kept, removed }
}

// ----------------------------------------------------------
// Per-creator video fetch (PH today; extensible per platform)
// ----------------------------------------------------------

async function ytdlpJson(url, { limit = 15, timeout = YTDLP_TIMEOUT } = {}) {
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
      encoding: 'utf8', timeout, maxBuffer: MAX_BUFFER, windowsHide: true,
    })
    stdout = result.stdout
  } catch (err) {
    if (err.stdout?.trim()) stdout = err.stdout
    else throw err
  }
  const videos = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    try { videos.push(JSON.parse(line)) } catch { /* skip malformed */ }
  }
  return videos
}

function normalize(raw, { displayUploader, forceUploader = false } = {}) {
  // forceUploader=true: use displayUploader regardless (good for channel
  // pages where yt-dlp's uploader is the individual contributor, not
  // the subscribed channel itself).
  const uploader = forceUploader && displayUploader
    ? displayUploader
    : (raw.uploader || raw.channel || raw.creator || displayUploader || '')
  return {
    id: raw.id || randomUUID(),
    url: raw.webpage_url || raw.url || '',
    title: raw.title || 'Untitled',
    thumbnail: raw.thumbnails?.at(-1)?.url || raw.thumbnail || '',
    duration: raw.duration || 0,
    uploader,
    view_count: raw.view_count || 0,
    like_count: raw.like_count ?? null,
    upload_date: raw.upload_date
      ? `${raw.upload_date.slice(0,4)}-${raw.upload_date.slice(4,6)}-${raw.upload_date.slice(6,8)}`
      : null,
    tags: raw.tags || [],
  }
}

async function fetchPornhubCreatorVideos(creator, { limit = 8 } = {}) {
  // creator.url already has the right prefix (/model/, /pornstar/, /channels/)
  const url = `${creator.url}/videos?o=mr`
  const raws = await ytdlpJson(url, { limit })
  const isChannel = creator.url.includes('/channels/')
  const displayUploader = creator.label || creator.handle
  return raws
    .map(r => normalize(r, { displayUploader, forceUploader: isChannel }))
    .filter(v => v.url)
}

/**
 * Fetch latest videos for every active subscribed creator on the
 * given platforms, aggregate, sort by upload_date desc, return top N.
 * Only `pornhub` is wired today; other platforms will return [].
 */
export async function fetchSubscribedCreatorsAggregated({
  limit = 50,
  perCreatorLimit = 8,
  platforms = ['pornhub'],
} = {}) {
  const placeholders = platforms.map(() => '?').join(',')
  const creators = db.prepare(`
    SELECT * FROM creators
    WHERE platform IN (${placeholders}) AND active = 1
    ORDER BY last_fetched ASC NULLS FIRST
  `).all(...platforms)

  if (creators.length === 0) {
    logger.info('Subscribed creators: 0 active — nothing to aggregate')
    return []
  }
  logger.info(`Subscribed creators: aggregating across ${creators.length} active`)

  const all = []
  const updateLastFetched = db.prepare(
    "UPDATE creators SET last_fetched = datetime('now'), fetch_failures = 0 WHERE id = ?"
  )
  const incFailures = db.prepare(
    'UPDATE creators SET fetch_failures = fetch_failures + 1 WHERE id = ?'
  )

  for (const c of creators) {
    try {
      let videos = []
      if (c.platform === 'pornhub') {
        videos = await fetchPornhubCreatorVideos(c, { limit: perCreatorLimit })
      }
      // Other platforms intentionally not wired yet (Phase 2).
      updateLastFetched.run(c.id)
      all.push(...videos)
    } catch (err) {
      incFailures.run(c.id)
      logger.warn(`Subscribed creators: ${c.platform}/${c.handle} failed: ${err.message}`)
    }
  }

  // Dedup by URL (creators sometimes share content)
  const dedup = new Map()
  for (const v of all) if (!dedup.has(v.url)) dedup.set(v.url, v)

  // Sort by upload_date desc; nulls last
  const sorted = Array.from(dedup.values()).sort((a, b) => {
    const ad = a.upload_date || ''
    const bd = b.upload_date || ''
    if (ad && bd) return bd.localeCompare(ad)
    if (ad) return -1
    if (bd) return 1
    return 0
  })

  return sorted.slice(0, limit)
}

/**
 * One-shot used by the persistent_rows fetcher: sync the user's PH
 * subs (cookie-source-of-truth), then aggregate latest videos.
 */
export async function fetchSubscribedCreatorVideosWithSync({ limit = 50 } = {}) {
  try {
    const stats = await syncPornhubSubscriptions()
    logger.info(`PH subs sync: +${stats.added} new, ${stats.kept} kept, ${stats.removed} deactivated`)
  } catch (err) {
    logger.warn(`PH subs sync failed (continuing with whatever's already in creators table): ${err.message}`)
  }
  return fetchSubscribedCreatorsAggregated({ limit })
}
