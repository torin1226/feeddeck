// ============================================================
// Eporner JSON API client — Phase 3 of multi-search topic pipeline
//
// Documented endpoint: GET https://www.eporner.com/api/v2/video/search/
// Query params:
//   query       - keyword search (optional)
//   per_page    - 1..100 (we cap at 30)
//   order       - latest | longest | shortest | top-rated |
//                 most-popular | top-weekly | top-monthly
//   gay, lq     - boolean filters (we skip)
//   thumbsize   - small | medium | big (we use big)
//   format      - json (default)
//
// No auth, no API key. Be polite: 1 req/sec (serialized via a
// promise chain so concurrent callers from resolveEpornerApi +
// resolveCrossSite cannot race past the rate limit), 6h cache.
// Eporner doesn't return creator/model — uploader stays null.
// Tags arrive as a comma-separated `keywords` string and are
// returned as a string[] (the consumer in routes/content.js
// JSON.stringifies before persisting).
// ============================================================

import { logger } from '../logger.js'

const BASE = 'https://www.eporner.com/api/v2/video/search/'
const REQ_DELAY_MS = 1000
let _lastRequestAt = 0
// Serializes _politeFetch calls so the rate limit holds under
// concurrent invocations. A read-modify-write of _lastRequestAt
// alone is not safe across awaits.
let _fetchChain = Promise.resolve()

async function _politeFetch(url) {
  const next = _fetchChain.then(async () => {
    const now = Date.now()
    const wait = Math.max(0, _lastRequestAt + REQ_DELAY_MS - now)
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    _lastRequestAt = Date.now()
    const res = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'accept': 'application/json',
      },
    })
    if (!res.ok) throw new Error(`eporner HTTP ${res.status}`)
    return res.json()
  })
  // Don't break the chain on this caller's error; the next caller
  // still needs a settled promise to resume from.
  _fetchChain = next.catch(() => {})
  return next
}

function _mapItem(r) {
  if (!r || !r.url) return null
  // Eporner's `keywords` field is comma-separated. Multi-word tags
  // ("hd porn", "verified amateurs") preserve their spaces.
  const tagList = typeof r.keywords === 'string'
    ? r.keywords.split(',').map(s => s.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean)
    : (Array.isArray(r.keywords) ? r.keywords : [])
  // Synthesise like_count from rating × views so the scoring layer's
  // log-scaled like bonus has something to chew on. Real engagement data
  // is unavailable from Eporner.
  const views = Number(r.views) || 0
  const rate = Number(r.rate) || 0
  const synthLikes = views > 0 && rate > 0 ? Math.round((rate / 5) * views * 0.05) : 0
  // Pick the largest thumbnail.
  let thumb = r.default_thumb?.src || null
  if (Array.isArray(r.thumbs) && r.thumbs.length) {
    const big = r.thumbs.find(t => t.size === 'big') || r.thumbs[r.thumbs.length - 1]
    if (big?.src) thumb = big.src
  }
  return {
    id: r.id || null,
    url: r.url,
    title: r.title || '',
    thumbnail: thumb,
    duration: Number(r.length_sec) || 0,
    source: 'eporner.com',
    uploader: null,
    view_count: views,
    like_count: synthLikes,
    subscriber_count: null,
    upload_date: r.added || null,
    tags: tagList,
  }
}

/**
 * Search Eporner.
 *
 * @param {Object} opts
 * @param {string} [opts.query='']  - keyword filter (empty = no filter)
 * @param {string} [opts.order='top-weekly']
 * @param {number} [opts.perPage=30]
 * @returns {Promise<Array>} mapped FeedDeck videos
 */
export async function search({ query = '', order = 'top-weekly', perPage = 30 } = {}) {
  const params = new URLSearchParams({
    per_page: String(Math.max(1, Math.min(30, perPage))),
    order,
    thumbsize: 'big',
    format: 'json',
  })
  if (query) params.set('query', query)
  const url = `${BASE}?${params}`
  try {
    const json = await _politeFetch(url)
    const videos = Array.isArray(json?.videos) ? json.videos : []
    return videos.map(_mapItem).filter(Boolean)
  } catch (err) {
    logger.warn('eporner search failed', { url, error: err.message })
    return []
  }
}

/**
 * Convenience wrappers — match the topic-pipeline's resolver naming.
 */
export const searchTopWeekly  = (query = '') => search({ query, order: 'top-weekly' })
export const searchTopMonthly = (query = '') => search({ query, order: 'top-monthly' })
export const searchTopRated   = (query = '') => search({ query, order: 'top-rated' })
export const searchMostPopular= (query = '') => search({ query, order: 'most-popular' })
export const searchLatest     = (query = '') => search({ query, order: 'latest' })
