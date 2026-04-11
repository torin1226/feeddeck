// ============================================================
// Creator Adapter
// Discovers content from followed creators across platforms.
// Reddit: public JSON API (no auth needed)
// TikTok/Instagram/Twitter: yt-dlp on creator pages (cookies)
//
// Each platform uses its own discovery method but all normalize
// to the standard video shape. The adapter handles smart rotation
// (oldest-fetched-first) to avoid hammering any single creator.
// ============================================================

import { SourceAdapter } from './base.js'
import { ytdlpExec, YTDLP_TIMEOUT } from './ytdlp.js'
import { logger } from '../logger.js'
import { db } from '../database.js'
import { randomUUID } from 'crypto'

// How many creators to fetch per refill cycle, per platform
const CREATORS_PER_CYCLE = {
  reddit: 5,
  tiktok: 3,
  instagram: 2,
  twitter: 3,
}

// Max consecutive failures before auto-disabling a creator
const MAX_CREATOR_FAILURES = 5

// Known video domains for filtering Reddit cross-posts
const VIDEO_DOMAINS = ['youtube.com', 'youtu.be', 'v.redd.it', 'streamable.com',
  'gfycat.com', 'imgur.com', 'tiktok.com', 'twitch.tv', 'vimeo.com']

export class CreatorAdapter extends SourceAdapter {
  constructor() {
    super({
      name: 'creator',
      supportedDomains: ['reddit.com', 'tiktok.com', 'instagram.com', 'twitter.com', 'x.com'],
      capabilities: {
        search: true,
        categories: false,
        trending: false,
        metadata: false,
        streamUrl: false,
      },
    })
  }

  /**
   * Search = discover new videos from followed creators.
   * Called by registry when source query is '__creators__'.
   */
  async search(query, options = {}) {
    if (query !== '__creators__') {
      throw new Error('CreatorAdapter only handles __creators__ queries')
    }

    const site = options.site || ''
    const platform = this._siteToPlatform(site)
    if (!platform) {
      throw new Error(`CreatorAdapter: unsupported site ${site}`)
    }

    // db is initialized at server startup before any search() calls
    const limit = CREATORS_PER_CYCLE[platform] || 3

    // Round-robin: pick creators with oldest last_fetched
    let creators = db.prepare(`
      SELECT * FROM creators
      WHERE platform = ? AND active = 1
      ORDER BY last_fetched ASC NULLS FIRST
      LIMIT ?
    `).all(platform, limit)

    // Auto-seed from subscription_backups if no active creators for this platform
    if (creators.length === 0) {
      const seeded = this._seedFromBackups(platform)
      if (seeded > 0) {
        creators = db.prepare(`
          SELECT * FROM creators
          WHERE platform = ? AND active = 1
          ORDER BY last_fetched ASC NULLS FIRST
          LIMIT ?
        `).all(platform, limit)
      }
    }

    if (creators.length === 0) {
      logger.info(`  creator: no active ${platform} creators configured`)
      return []
    }

    const allVideos = []
    for (const creator of creators) {
      try {
        let videos
        if (platform === 'reddit') {
          videos = await this._fetchReddit(creator)
        } else {
          videos = await this._fetchYtdlpCreator(creator, platform)
        }

        // Mark success
        db.prepare(`
          UPDATE creators SET last_fetched = datetime('now'), fetch_failures = 0
          WHERE id = ?
        `).run(creator.id)

        allVideos.push(...videos)
        logger.info(`  creator: ${platform}/${creator.handle} → ${videos.length} videos`)
      } catch (err) {
        // Increment failure count
        db.prepare(`
          UPDATE creators SET fetch_failures = fetch_failures + 1
          WHERE id = ?
        `).run(creator.id)

        const failures = (creator.fetch_failures || 0) + 1
        if (failures >= MAX_CREATOR_FAILURES) {
          db.prepare('UPDATE creators SET active = 0 WHERE id = ?').run(creator.id)
          logger.warn(`  creator: auto-disabled ${platform}/${creator.handle} after ${failures} failures`)
        } else {
          logger.warn(`  creator: ${platform}/${creator.handle} failed (${failures}/${MAX_CREATOR_FAILURES}): ${err.message}`)
        }
      }
    }

    return allVideos
  }

  // ----------------------------------------------------------
  // Auto-seed creators from subscription_backups when table is empty for a platform
  // ----------------------------------------------------------

  _seedFromBackups(platform) {
    const URL_GENERATORS = {
      reddit:    (h) => `https://www.reddit.com/r/${h}/hot.json?limit=15`,
      tiktok:    (h) => `https://www.tiktok.com/@${h.replace(/^@/, '')}`,
      instagram: (h) => `https://www.instagram.com/${h.replace(/^@/, '')}/reels/`,
      twitter:   (h) => `https://x.com/${h.replace(/^@/, '')}/media`,
    }

    const urlGen = URL_GENERATORS[platform]
    if (!urlGen) return 0

    try {
      const backups = db.prepare(`
        SELECT handle, display_name FROM subscription_backups
        WHERE platform = ?
        ORDER BY RANDOM()
        LIMIT 50
      `).all(platform)

      if (backups.length === 0) return 0

      const insert = db.prepare(
        'INSERT OR IGNORE INTO creators (platform, handle, url, label) VALUES (?, ?, ?, ?)'
      )

      let added = 0
      for (const b of backups) {
        const result = insert.run(platform, b.handle, urlGen(b.handle), b.display_name || b.handle)
        if (result.changes > 0) added++
      }

      if (added > 0) {
        logger.info(`  creator: auto-seeded ${added} ${platform} creators from subscription_backups`)
      }
      return added
    } catch (err) {
      logger.warn(`  creator: failed to seed from backups: ${err.message}`)
      return 0
    }
  }

  // ----------------------------------------------------------
  // Reddit: public JSON API
  // ----------------------------------------------------------

  async _fetchReddit(creator) {
    const url = creator.url || `https://www.reddit.com/r/${creator.handle}/hot.json?limit=15`

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'FeedDeck/1.0 (content aggregator)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    })

    if (!resp.ok) {
      throw new Error(`Reddit API ${resp.status}: ${resp.statusText}`)
    }

    const data = await resp.json()
    const posts = data?.data?.children || []
    const videos = []

    for (const post of posts) {
      const p = post.data
      if (!p || p.stickied) continue

      // Native Reddit video
      if (p.is_video && p.media?.reddit_video?.fallback_url) {
        videos.push({
          id: `reddit_${p.id}`,
          url: `https://www.reddit.com${p.permalink}`,
          title: p.title || 'Untitled',
          thumbnail: p.thumbnail && p.thumbnail !== 'default' ? p.thumbnail : '',
          duration: p.media.reddit_video.duration || 0,
          source: 'reddit',
          uploader: `r/${p.subreddit}`,
          view_count: p.ups || 0,
          tags: [],
          orientation: (p.media.reddit_video.height > p.media.reddit_video.width) ? 'vertical' : 'horizontal',
          streamUrl: p.media.reddit_video.fallback_url,
        })
        continue
      }

      // Cross-posted video (YouTube, TikTok, etc.)
      if (p.url && this._isVideoUrl(p.url) && !p.is_self) {
        videos.push({
          id: `reddit_${p.id}`,
          url: p.url,
          title: p.title || 'Untitled',
          thumbnail: p.thumbnail && p.thumbnail !== 'default' ? p.thumbnail : '',
          duration: 0,
          source: 'reddit',
          uploader: `r/${p.subreddit}`,
          view_count: p.ups || 0,
          tags: [],
          orientation: 'horizontal',
        })
      }
    }

    return videos
  }

  _isVideoUrl(url) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '')
      return VIDEO_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))
    } catch {
      return false
    }
  }

  // ----------------------------------------------------------
  // TikTok / Instagram / Twitter: yt-dlp creator pages
  // ----------------------------------------------------------

  async _fetchYtdlpCreator(creator, platform) {
    const playlistEnd = platform === 'instagram' ? 3 : 5

    // yt-dlp --dump-json returns one JSON object per line
    const stdout = await ytdlpExec(
      ['--dump-json', '--playlist-end', String(playlistEnd), '--no-download', '--ignore-errors'],
      creator.url,
      { timeout: YTDLP_TIMEOUT * 2 } // creator pages can be slow
    )

    if (!stdout?.trim()) return []

    const videos = []
    for (const line of stdout.trim().split('\n')) {
      try {
        const raw = JSON.parse(line)
        videos.push(this.normalizeVideo({
          ...raw,
          source: platform,
        }))
      } catch {
        // skip malformed JSON lines
      }
    }

    return videos
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  _siteToPlatform(site) {
    if (!site) return null
    const s = site.replace(/^www\./, '').toLowerCase()
    if (s.includes('reddit')) return 'reddit'
    if (s.includes('tiktok')) return 'tiktok'
    if (s.includes('instagram')) return 'instagram'
    if (s.includes('twitter') || s.includes('x.com')) return 'twitter'
    return null
  }
}
