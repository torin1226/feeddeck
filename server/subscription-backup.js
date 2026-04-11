// ============================================================
// Subscription Backup
// Fetches "who I follow" from each platform and archives it
// in the subscription_backups table. Supports live API fetch
// (YouTube, Twitter, Reddit) and GDPR export import
// (TikTok, Instagram).
// ============================================================

import { db } from './database.js'
import { parseCookieFile, getCookieArgs } from './cookies.js'
import { logger } from './logger.js'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const execFileAsync = promisify(execFile)

// Twitter's public bearer token (embedded in their web JS bundle, same for all users)
const TWITTER_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

// Known GraphQL query hashes for the Following endpoint (most recent first)
const TWITTER_FOLLOWING_HASHES = [
  'vWCjN9gcTJiXzzMPR5Oxzw',
  'iSicc7LrzWGBgDPL0tM_TQ',
  'mIwX8GogcobVlRwlgpHNYA',
]

const UPSERT_SQL = `
  INSERT INTO subscription_backups (platform, handle, display_name, profile_url, platform_id, source)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(platform, handle) DO UPDATE SET
    display_name = excluded.display_name,
    profile_url = excluded.profile_url,
    platform_id = excluded.platform_id,
    backed_up_at = datetime('now'),
    source = excluded.source
`

// URL generators matching creators.js
const URL_GENERATORS = {
  reddit:    (handle) => `https://www.reddit.com/r/${handle}/hot.json?limit=15`,
  tiktok:    (handle) => `https://www.tiktok.com/@${handle.replace(/^@/, '')}`,
  instagram: (handle) => `https://www.instagram.com/${handle.replace(/^@/, '')}/reels/`,
  twitter:   (handle) => `https://x.com/${handle.replace(/^@/, '')}/media`,
  youtube:   (handle) => `https://www.youtube.com/@${handle}`,
}

// ── Platform Fetchers ────────────────────────────────────────

/**
 * YouTube: use yt-dlp --flat-list on /feed/channels + merge sub_channels cache
 */
async function _fetchYouTube() {
  const results = []

  // Try yt-dlp flat list of subscription channels
  try {
    const cookieArgs = getCookieArgs('https://www.youtube.com/feed/channels')
    const args = ['--js-runtimes', 'node', ...cookieArgs, '--flat-playlist', '--dump-json', 'https://www.youtube.com/feed/channels']
    const { stdout } = await execFileAsync('yt-dlp', args, {
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 50 * 1024 * 1024,
      windowsHide: true,
    })

    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line)
        const handle = entry.channel || entry.uploader || entry.title
        if (!handle) continue
        results.push({
          handle,
          display_name: entry.channel || entry.uploader || handle,
          profile_url: entry.channel_url || entry.uploader_url || entry.url,
          platform_id: entry.channel_id || entry.uploader_id,
        })
      } catch {}
    }
  } catch (err) {
    logger.warn(`subscription-backup: YouTube yt-dlp fetch failed: ${err.message}`)
  }

  // Merge sub_channels cache for completeness
  try {
    const cached = db.prepare('SELECT channel_id, channel_name, channel_url FROM sub_channels').all()
    for (const ch of cached) {
      if (results.some(r => r.platform_id === ch.channel_id)) continue
      results.push({
        handle: ch.channel_name,
        display_name: ch.channel_name,
        profile_url: ch.channel_url,
        platform_id: ch.channel_id,
      })
    }
  } catch {}

  // Dedupe by platform_id or handle
  const seen = new Set()
  return results.filter(r => {
    const key = r.platform_id || r.handle
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Twitter/X: GraphQL Following endpoint with cookie auth
 */
async function _fetchTwitter() {
  const { cookies } = parseCookieFile('x.com')
  if (!cookies.auth_token || !cookies.ct0) {
    throw new Error('Missing Twitter auth cookies (auth_token, ct0). Add cookies to cookies-social.txt or cookies/twitter.txt')
  }

  // Extract user ID from twid cookie (format: u%3D1234567890)
  const twid = cookies.twid
  if (!twid) throw new Error('Missing twid cookie — cannot determine user ID')
  const userId = decodeURIComponent(twid).replace('u=', '')

  const cookieHeader = `auth_token=${cookies.auth_token}; ct0=${cookies.ct0}; twid=${cookies.twid}`
  const headers = {
    'authorization': `Bearer ${decodeURIComponent(TWITTER_BEARER)}`,
    'x-csrf-token': cookies.ct0,
    'cookie': cookieHeader,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'referer': 'https://x.com/',
    'origin': 'https://x.com',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
    'accept': '*/*',
  }

  // Try known query hashes, then auto-discover if all fail
  let queryHash = null
  for (const hash of TWITTER_FOLLOWING_HASHES) {
    if (await _testTwitterHash(hash, userId, headers)) {
      queryHash = hash
      break
    }
  }

  if (!queryHash) {
    logger.info('subscription-backup: known Twitter hashes failed, attempting auto-discovery')
    queryHash = await _discoverTwitterHash(headers)
  }

  if (!queryHash) {
    throw new Error('Could not find a working Twitter Following query hash. Twitter may have rotated their API.')
  }

  return _paginateTwitterFollowing(queryHash, userId, headers)
}

async function _testTwitterHash(hash, userId, headers) {
  try {
    const variables = JSON.stringify({ userId, count: 1, includePromotedContent: false })
    const url = `https://x.com/i/api/graphql/${hash}/Following?variables=${encodeURIComponent(variables)}`
    const res = await fetch(url, { headers })
    return res.status === 200
  } catch {
    return false
  }
}

async function _discoverTwitterHash(headers) {
  try {
    // Fetch the Twitter homepage to find JS bundle URLs
    const pageRes = await fetch('https://x.com/home', {
      headers: {
        cookie: headers.cookie,
        'user-agent': headers['user-agent'],
      },
    })
    const html = await pageRes.text()

    // Find main JS bundle URLs
    const bundleMatches = html.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web[^"]+\.js/g)
    if (!bundleMatches || bundleMatches.length === 0) return null

    // Search bundles for the Following query hash
    for (const bundleUrl of bundleMatches.slice(0, 5)) {
      try {
        const jsRes = await fetch(bundleUrl)
        const js = await jsRes.text()

        // Look for pattern like: queryId:"ABC123",operationName:"Following"
        const match = js.match(/queryId:"([^"]+)",operationName:"Following"/)
        if (match) {
          logger.info(`subscription-backup: discovered Twitter Following hash: ${match[1]}`)
          return match[1]
        }
      } catch {}
    }
  } catch (err) {
    logger.warn(`subscription-backup: Twitter hash auto-discovery failed: ${err.message}`)
  }
  return null
}

async function _paginateTwitterFollowing(queryHash, userId, headers) {
  const results = []
  let cursor = null
  let pageCount = 0
  const MAX_PAGES = 100 // Safety limit (2000 following)

  while (pageCount < MAX_PAGES) {
    const variables = { userId, count: 20, includePromotedContent: false }
    if (cursor) variables.cursor = cursor

    const url = `https://x.com/i/api/graphql/${queryHash}/Following?variables=${encodeURIComponent(JSON.stringify(variables))}`

    const res = await fetch(url, { headers })

    if (res.status === 429) {
      logger.warn('subscription-backup: Twitter rate limited, stopping with partial results')
      break
    }

    if (!res.ok) {
      if (results.length > 0) break // Return partial results
      throw new Error(`Twitter API returned ${res.status}: ${await res.text()}`)
    }

    const data = await res.json()
    const timeline = data?.data?.user?.result?.timeline?.timeline
    if (!timeline) break

    let foundUsers = false
    let nextCursor = null

    for (const entry of timeline.instructions || []) {
      const entries = entry.entries || []
      for (const e of entries) {
        // User entries
        if (e.entryId?.startsWith('user-')) {
          const userResult = e.content?.itemContent?.user_results?.result
          if (!userResult) continue
          // screen_name and name live in core (newer API) or legacy (older API)
          const core = userResult.core || {}
          const legacy = userResult.legacy || {}
          const screenName = core.screen_name || legacy.screen_name
          const displayName = core.name || legacy.name
          if (!screenName) continue
          results.push({
            handle: screenName,
            display_name: displayName,
            profile_url: `https://x.com/${screenName}`,
            platform_id: userResult.rest_id,
          })
          foundUsers = true
        }
        // Cursor entries
        if (e.entryId?.startsWith('cursor-bottom')) {
          nextCursor = e.content?.value
        }
      }
    }

    if (!foundUsers || !nextCursor) break
    cursor = nextCursor
    pageCount++

    // Courtesy delay between pages
    await new Promise(r => setTimeout(r, 1000))
  }

  return results
}

/**
 * Reddit: fetch subscribed subreddits via API or parse GDPR export
 */
async function _fetchReddit(options = {}) {
  if (options.gdprPath) return _parseRedditGdpr(options.gdprPath)

  const { cookies } = parseCookieFile('reddit.com')
  if (!cookies.reddit_session && !cookies.token_v2) {
    throw new Error('No Reddit cookies found. Use --gdpr-path for GDPR export instead.')
  }

  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  const results = []
  let after = null

  while (true) {
    const url = `https://www.reddit.com/subreddits/mine.json?limit=100${after ? `&after=${after}` : ''}`
    const res = await fetch(url, {
      headers: {
        'cookie': cookieHeader,
        'user-agent': 'FeedDeck/1.0',
      },
    })

    if (!res.ok) {
      if (results.length > 0) break
      throw new Error(`Reddit API returned ${res.status}`)
    }

    const data = await res.json()
    for (const child of data?.data?.children || []) {
      const sub = child.data
      results.push({
        handle: sub.display_name,
        display_name: sub.title || sub.display_name,
        profile_url: `https://www.reddit.com${sub.url}`,
        platform_id: sub.name,
      })
    }

    after = data?.data?.after
    if (!after) break
    await new Promise(r => setTimeout(r, 500))
  }

  return results
}

function _parseRedditGdpr(exportPath) {
  const csvPath = join(exportPath, 'subscribed_subreddits.csv')
  if (!existsSync(csvPath)) {
    throw new Error(`Not found: ${csvPath}`)
  }

  const text = readFileSync(csvPath, 'utf-8')
  const lines = text.split('\n').slice(1) // skip header
  return lines
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      // CSV format: id,name (or just name depending on export version)
      const parts = line.split(',')
      const name = parts.length > 1 ? parts[1].trim() : parts[0].trim()
      return {
        handle: name.replace(/^r\//, ''),
        display_name: name,
        profile_url: `https://www.reddit.com/r/${name.replace(/^r\//, '')}`,
        platform_id: null,
      }
    })
}

/**
 * TikTok: GDPR export only (Activity/Following List.txt)
 */
function _fetchTikTok(options = {}) {
  if (!options.gdprPath) {
    throw new Error('TikTok requires a GDPR export. Use --gdpr-path "/path/to/export"')
  }

  // Try common TikTok export structures
  const candidates = [
    join(options.gdprPath, 'Activity', 'Following List.txt'),
    join(options.gdprPath, 'Activity', 'Following.txt'),
    join(options.gdprPath, 'following_list.txt'),
    join(options.gdprPath, 'Following List.txt'),
  ]

  const filePath = candidates.find(p => existsSync(p))
  if (!filePath) {
    throw new Error(`TikTok following list not found. Tried: ${candidates.join(', ')}`)
  }

  const text = readFileSync(filePath, 'utf-8')
  const results = []

  // TikTok export format: blocks with Date: and Link: lines
  const lines = text.split('\n')
  for (const line of lines) {
    const linkMatch = line.match(/(?:Link|Username|User):\s*(.+)/i)
    if (!linkMatch) continue

    const value = linkMatch[1].trim()
    // Could be a URL or a username
    let handle, profileUrl
    if (value.startsWith('http')) {
      profileUrl = value
      const urlMatch = value.match(/tiktok\.com\/@?([^/?]+)/)
      handle = urlMatch ? urlMatch[1] : value
    } else {
      handle = value.replace(/^@/, '')
      profileUrl = `https://www.tiktok.com/@${handle}`
    }

    results.push({
      handle,
      display_name: handle,
      profile_url: profileUrl,
      platform_id: null,
    })
  }

  return results
}

/**
 * Instagram: GDPR export only (followers_and_following/following.json)
 */
function _fetchInstagram(options = {}) {
  if (!options.gdprPath) {
    throw new Error('Instagram requires a GDPR export. Use --gdpr-path "/path/to/export"')
  }

  const candidates = [
    join(options.gdprPath, 'followers_and_following', 'following.json'),
    join(options.gdprPath, 'following.json'),
    join(options.gdprPath, 'connections', 'followers_and_following', 'following.json'),
  ]

  const filePath = candidates.find(p => existsSync(p))
  if (!filePath) {
    throw new Error(`Instagram following.json not found. Tried: ${candidates.join(', ')}`)
  }

  const data = JSON.parse(readFileSync(filePath, 'utf-8'))

  // Instagram export format: { relationships_following: [{ string_list_data: [{ value, href, timestamp }] }] }
  const following = data.relationships_following || data
  if (!Array.isArray(following)) {
    throw new Error('Unexpected Instagram export format')
  }

  return following.map(entry => {
    const info = entry.string_list_data?.[0] || {}
    const handle = info.value || 'unknown'
    return {
      handle,
      display_name: handle,
      profile_url: info.href || `https://www.instagram.com/${handle}/`,
      platform_id: null,
    }
  }).filter(r => r.handle !== 'unknown')
}

// ── Public API ───────────────────────────────────────────────

const FETCHERS = {
  youtube: _fetchYouTube,
  twitter: _fetchTwitter,
  reddit: _fetchReddit,
  tiktok: _fetchTikTok,
  instagram: _fetchInstagram,
}

/**
 * Back up subscriptions for a single platform.
 * @returns {{ platform, count, results }}
 */
export async function backupPlatform(platform, options = {}) {
  const fetcher = FETCHERS[platform]
  if (!fetcher) throw new Error(`Unknown platform: ${platform}. Use: ${Object.keys(FETCHERS).join(', ')}`)

  logger.info(`subscription-backup: starting ${platform} backup`)
  const results = await fetcher(options)

  const upsert = db.prepare(UPSERT_SQL)
  let count = 0
  for (const r of results) {
    if (!r.handle) continue
    try {
      upsert.run(
        String(platform),
        String(r.handle),
        r.display_name ? String(r.display_name) : null,
        r.profile_url ? String(r.profile_url) : null,
        r.platform_id ? String(r.platform_id) : null,
        options.source || 'api',
      )
      count++
    } catch (err) {
      logger.warn(`subscription-backup: failed to upsert ${r.handle}: ${err.message}`)
    }
  }

  logger.info(`subscription-backup: backed up ${count} ${platform} subscriptions`)
  return { platform, count, results }
}

/**
 * Back up all platforms that have available auth.
 */
export async function backupAll(options = {}) {
  const statuses = getBackupStatus()
  const results = {}

  for (const [platform, status] of Object.entries(statuses)) {
    if (!status.available) {
      results[platform] = { skipped: true, reason: status.reason }
      continue
    }
    try {
      results[platform] = await backupPlatform(platform, options)
    } catch (err) {
      results[platform] = { error: err.message }
      logger.warn(`subscription-backup: ${platform} backup failed: ${err.message}`)
    }
  }

  return results
}

/**
 * Check which platforms have auth available.
 */
export function getBackupStatus() {
  const status = {}

  // YouTube
  const ytCookies = parseCookieFile('youtube.com')
  const hasYtCache = (() => { try { return db.prepare('SELECT COUNT(*) as n FROM sub_channels').get().n > 0 } catch { return false } })()
  status.youtube = {
    available: Object.keys(ytCookies.cookies).length > 0 || hasYtCache,
    reason: Object.keys(ytCookies.cookies).length > 0 ? 'cookies' : hasYtCache ? 'cache only' : 'no auth',
  }

  // Twitter
  const twCookies = parseCookieFile('x.com')
  status.twitter = {
    available: !!(twCookies.cookies.auth_token && twCookies.cookies.ct0),
    reason: twCookies.cookies.auth_token ? 'cookies' : 'no auth',
  }

  // Reddit
  const rdCookies = parseCookieFile('reddit.com')
  status.reddit = {
    available: !!(rdCookies.cookies.reddit_session || rdCookies.cookies.token_v2),
    reason: rdCookies.cookies.reddit_session || rdCookies.cookies.token_v2 ? 'cookies' : 'gdpr only',
  }

  // TikTok & Instagram — GDPR only
  status.tiktok = { available: false, reason: 'gdpr only' }
  status.instagram = { available: false, reason: 'gdpr only' }

  return status
}

/**
 * Get backed-up subscriptions from the database.
 */
export function getBackedUpSubscriptions(platform) {
  if (platform) {
    return db.prepare('SELECT * FROM subscription_backups WHERE platform = ? ORDER BY handle').all(platform)
  }
  return db.prepare('SELECT * FROM subscription_backups ORDER BY platform, handle').all()
}

/**
 * Sync backed-up subscriptions into the creators table.
 */
export function syncToCreators(platform) {
  const subs = platform
    ? db.prepare('SELECT * FROM subscription_backups WHERE platform = ?').all(platform)
    : db.prepare('SELECT * FROM subscription_backups').all()

  const insert = db.prepare(
    'INSERT OR IGNORE INTO creators (platform, handle, url, label) VALUES (?, ?, ?, ?)'
  )

  let added = 0
  for (const sub of subs) {
    const urlGen = URL_GENERATORS[sub.platform]
    if (!urlGen) continue // skip platforms without URL generators (e.g. youtube isn't in creators)
    const url = urlGen(sub.handle)
    const result = insert.run(sub.platform, sub.handle, url, sub.display_name || sub.handle)
    if (result.changes > 0) added++
  }

  logger.info(`subscription-backup: synced ${added} new creators from ${subs.length} backups`)
  return { added, total: subs.length }
}
