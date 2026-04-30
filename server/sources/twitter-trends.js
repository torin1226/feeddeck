// ============================================================
// Twitter trends fetcher — Phase 4
//
// Reuses the cookie + bearer + headers pattern from
// subscription-backup.js. Twitter doesn't document a public trends
// endpoint, so we try in order:
//
//   Path 1: legacy v1.1 trends/place.json?id=23424977 (US WOEID).
//           Often still works with consumer auth + ct0 cookie.
//
//   Path 2: x.com/explore/tabs/trending — scrape the bundle JS for
//           the GenericTimelineByRestId queryId, then call the
//           GraphQL endpoint. Mirrors subscription-backup.js's
//           auto-hash discovery for Following.
//
// Either path returns a list of plain trending topic strings (the
// kind the user types into search). The pipeline uses these as
// ytsearch seeds. Failure returns []; the pipeline absorbs the gap.
//
// Cached for 1h via the topics.js trends_cache layer (the resolver
// itself is in topics.js; this module is the network call only).
// ============================================================

import { logger } from '../logger.js'
import { parseCookieFile } from '../cookies.js'

const TWITTER_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'
const US_WOEID = 23424977

function _buildHeaders(cookies) {
  const cookieHeader = [
    `auth_token=${cookies.auth_token}`,
    `ct0=${cookies.ct0}`,
    cookies.twid ? `twid=${cookies.twid}` : null,
  ].filter(Boolean).join('; ')
  return {
    'authorization': `Bearer ${decodeURIComponent(TWITTER_BEARER)}`,
    'x-csrf-token': cookies.ct0,
    'cookie': cookieHeader,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'referer': 'https://x.com/explore',
    'origin': 'https://x.com',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
    'accept': '*/*',
  }
}

async function _pathV11(headers) {
  const url = `https://api.x.com/1.1/trends/place.json?id=${US_WOEID}`
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`v1.1 trends HTTP ${res.status}`)
  const json = await res.json()
  // Response shape: [{ trends: [{ name, query, ... }, ...], ... }]
  const arr = Array.isArray(json) ? json : []
  const trends = arr[0]?.trends || []
  return trends
    .map(t => (t?.name || '').replace(/^#/, '').trim())
    .filter(Boolean)
    .slice(0, 30)
}

async function _pathGraphQL(headers) {
  // 1) Fetch the explore page to find the bundle URLs
  const pageRes = await fetch('https://x.com/explore', {
    headers: { cookie: headers.cookie, 'user-agent': headers['user-agent'] },
  })
  if (!pageRes.ok) throw new Error(`explore page HTTP ${pageRes.status}`)
  const html = await pageRes.text()
  const bundleUrls = (html.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web[^"]+\.js/g) || []).slice(0, 5)
  if (bundleUrls.length === 0) throw new Error('no Twitter JS bundles found in explore page')

  // 2) Look for ExploreSidebar / GenericTimelineByRestId queryId in bundles
  let queryId = null
  let operationName = null
  for (const url of bundleUrls) {
    try {
      const js = await fetch(url).then(r => r.text())
      // Match patterns like: queryId:"abcDEF123",operationName:"GenericTimelineByRestId"
      // or: queryId:"abc",operationName:"ExploreSidebar"
      const m = js.match(/queryId:\s*"([A-Za-z0-9_-]{8,})"\s*,\s*operationName:\s*"(GenericTimelineByRestId|ExploreSidebar|TopicLandingPage)"/)
      if (m) { queryId = m[1]; operationName = m[2]; break }
    } catch { /* continue */ }
  }
  if (!queryId) throw new Error('could not locate GraphQL queryId in Twitter bundles')

  // 3) Call the GraphQL endpoint
  // For ExploreSidebar / GenericTimelineByRestId the trending timeline rest_id is "1761511368034574379" (varies)
  // We don't know the exact restId; try the Explore tab default by hitting a UrtRequest.
  const variables = encodeURIComponent(JSON.stringify({ count: 30, withGrokTranslatedBio: false }))
  const features = encodeURIComponent(JSON.stringify({}))
  const gqlUrl = `https://x.com/i/api/graphql/${queryId}/${operationName}?variables=${variables}&features=${features}`
  const res = await fetch(gqlUrl, { headers })
  if (!res.ok) throw new Error(`graphql trends HTTP ${res.status}`)
  const json = await res.json()
  // Response shape varies; walk it generically pulling .trend or .name strings.
  const trends = []
  function walk(node) {
    if (!node || typeof node !== 'object') return
    if (typeof node.name === 'string' && (node.trend_metadata || node.context || trends.length === 0)) {
      const t = node.name.replace(/^#/, '').trim()
      if (t) trends.push(t)
    }
    if (Array.isArray(node)) { for (const c of node) walk(c) }
    else { for (const k of Object.keys(node)) walk(node[k]) }
  }
  walk(json)
  // Dedup + cap.
  const seen = new Set()
  return trends.filter(t => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 30)
}

/**
 * Fetch US trending topics. Returns a list of topic strings (max 30).
 * Empty array on failure — never throws to the caller.
 */
export async function fetchUsTrends() {
  let cookies
  try {
    ({ cookies } = parseCookieFile('x.com'))
  } catch (err) {
    logger.warn('twitter-trends: cookie load failed', { error: err.message })
    return []
  }
  if (!cookies.auth_token || !cookies.ct0) {
    logger.warn('twitter-trends: missing auth_token or ct0; skipping')
    return []
  }
  const headers = _buildHeaders(cookies)

  try {
    const v11 = await _pathV11(headers)
    if (v11.length > 0) return v11
  } catch (err) {
    logger.debug('twitter-trends: v1.1 path failed, trying GraphQL', { error: err.message })
  }

  try {
    const gql = await _pathGraphQL(headers)
    return gql
  } catch (err) {
    logger.warn('twitter-trends: all paths failed', { error: err.message })
    return []
  }
}
