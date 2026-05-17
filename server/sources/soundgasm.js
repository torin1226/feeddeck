// ============================================================
// Soundgasm Adapter
// Soundgasm.net hosts free audio porn posts under /u/{user}/{slug}.
// Each user page lists titles linking to per-post pages, and the
// post page embeds a direct m4a URL on media.soundgasm.net.
//
// This adapter implements `__creators__` discovery scoped to
// site='soundgasm.net'. It returns normalized audio items the
// audio-fetcher writes to audio_cache. See plan:
// generic-exploring-lampson.md.
// ============================================================

import { SourceAdapter } from './base.js'
import { logger } from '../logger.js'
import { db } from '../database.js'
import { boundary } from '../boundary/index.js'
import { randomUUID } from 'crypto'

const SOUNDGASM_USER_RE = /<div class="sound-details">\s*<a href="(https:\/\/soundgasm\.net\/u\/[^"/]+\/[^"]+)">([\s\S]*?)<\/a>/g
const MEDIA_URL_RE = /https:\/\/media\.soundgasm\.net\/sounds\/[a-f0-9]+\.(?:m4a|mp3|wav)/i
const DESCRIPTION_RE = /<div class="jp-description"[^>]*>\s*<p class="jp-description"[^>]*>([\s\S]*?)<\/p>/

// How many soundgasm creators to refresh per cycle. Evergreen audio means
// we don't need to hammer; per-creator pages rarely change once posted.
const CREATORS_PER_CYCLE = 3

// Max posts to pull per creator page on each cycle. Their pages list every
// post the user has ever made; we walk newest-first and skip already-cached
// URLs to avoid hammering the per-post page on every cycle.
const POSTS_PER_CREATOR = 8

// Polite delay between per-post page fetches (each post needs its own GET
// to extract the media URL). 250ms ≈ 4 req/sec which is well under any
// reasonable rate limit.
const FETCH_DELAY_MS = 250

const UA = 'Mozilla/5.0 (FeedDeck-audio/1.0; +https://github.com/feeddeck)'

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

export class SoundgasmAdapter extends SourceAdapter {
  constructor() {
    super({
      name: 'soundgasm',
      supportedDomains: ['soundgasm.net'],
      capabilities: {
        search: true,
        categories: false,
        trending: false,
        metadata: true,
        streamUrl: true,
      },
    })
  }

  // search('__creators__', { site: 'soundgasm.net' }) walks active soundgasm
  // creators and pulls their newest posts. The shared adapter contract takes
  // an options bag for site / limit / category filters; soundgasm only handles
  // the __creators__ sentinel today so options is unused.
  async search(query, _options = {}) {
    if (query !== '__creators__') {
      throw new Error('SoundgasmAdapter only handles __creators__ queries')
    }

    const creators = db.prepare(`
      SELECT * FROM creators
      WHERE platform = 'soundgasm' AND active = 1 AND surface = 'audio'
      ORDER BY last_fetched ASC NULLS FIRST
      LIMIT ?
    `).all(CREATORS_PER_CYCLE)

    if (creators.length === 0) {
      logger.info('  soundgasm: no active audio creators configured')
      return []
    }

    const items = []
    for (const creator of creators) {
      try {
        const fetched = await this._fetchCreator(creator)
        items.push(...fetched)
        db.prepare(`
          UPDATE creators SET last_fetched = datetime('now'), fetch_failures = 0
          WHERE id = ?
        `).run(creator.id)
        logger.info(`  soundgasm: ${creator.handle} → ${fetched.length} items`)
      } catch (err) {
        db.prepare(`
          UPDATE creators SET fetch_failures = fetch_failures + 1 WHERE id = ?
        `).run(creator.id)
        logger.warn(`  soundgasm: ${creator.handle} failed: ${err.message}`)
      }
    }
    return items
  }

  // Fetch a creator's user page, list per-post URLs, then fetch each post page
  // to extract the direct media URL. Skip posts already in audio_cache so the
  // common case (re-running the cycle) is cheap.
  async _fetchCreator(creator) {
    const userUrl = creator.url || `https://soundgasm.net/u/${creator.handle}`

    const { outcome: pageOutcome, value: html } = await boundary.fetch(userUrl, {
      name: 'audio-soundgasm-user',
      timeoutMs: 15_000,
      headers: { 'User-Agent': UA },
    })
    if (pageOutcome !== 'ok' || !html) {
      throw new Error(`User page ${pageOutcome}`)
    }

    // Regex match the post listing. The listing is in newest-first order on
    // soundgasm so the first POSTS_PER_CREATOR are the most recent.
    const postLinks = []
    let m
    while ((m = SOUNDGASM_USER_RE.exec(html)) !== null) {
      postLinks.push({ url: m[1], title: this._decode(m[2]) })
      if (postLinks.length >= POSTS_PER_CREATOR) break
    }

    if (postLinks.length === 0) {
      throw new Error('No post links found on user page (regex mismatch — site may have changed)')
    }

    // Skip posts already cached (URL UNIQUE constraint would reject them
    // anyway, but skipping saves the per-post GET).
    const existingUrls = new Set(
      db.prepare(`SELECT url FROM audio_cache WHERE url IN (${postLinks.map(() => '?').join(',')})`)
        .all(...postLinks.map(p => p.url))
        .map(r => r.url)
    )
    const fresh = postLinks.filter(p => !existingUrls.has(p.url))

    const items = []
    for (const post of fresh) {
      try {
        const item = await this._fetchPost(post, creator)
        if (item) items.push(item)
        await sleep(FETCH_DELAY_MS)
      } catch (err) {
        logger.warn(`  soundgasm: post ${post.url} failed: ${err.message}`)
      }
    }
    return items
  }

  async _fetchPost(post, creator) {
    const { outcome, value: html } = await boundary.fetch(post.url, {
      name: 'audio-soundgasm-post',
      timeoutMs: 15_000,
      headers: { 'User-Agent': UA },
    })
    if (outcome !== 'ok' || !html) {
      throw new Error(`Post page ${outcome}`)
    }

    const mediaMatch = html.match(MEDIA_URL_RE)
    if (!mediaMatch) return null

    const descMatch = html.match(DESCRIPTION_RE)
    const description = descMatch ? this._decode(descMatch[1].replace(/<[^>]+>/g, '')).trim() : ''

    return {
      id: `soundgasm_${randomUUID()}`,
      source_domain: 'soundgasm.net',
      url: post.url,
      audio_url: mediaMatch[0],
      title: post.title,
      creator: creator.label || creator.handle,
      creator_handle: creator.handle,
      tags: this._extractTags(post.title, description),
      duration_sec: null,
      length_label: null,
    }
  }

  // Extract bracketed tags like [F4M], [Incest], [Loving] from the title.
  // Soundgasm posts follow this convention almost universally.
  _extractTags(title, description = '') {
    const tags = []
    const combined = `${title} ${description}`
    const tagRe = /\[([^\]]{1,40})\]/g
    let m
    while ((m = tagRe.exec(combined)) !== null) {
      const t = m[1].trim().toLowerCase()
      if (t && !tags.includes(t)) tags.push(t)
    }
    return tags.slice(0, 20)
  }

  _decode(s) {
    return s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, ' ')
  }

  // Resolve a single soundgasm.net/u/{user}/{slug} URL → direct media URL.
  // Used by the PDF backfill script and by metadata fallbacks.
  async getStreamUrl(url) {
    const { outcome, value: html } = await boundary.fetch(url, {
      name: 'audio-soundgasm-resolve',
      timeoutMs: 15_000,
      headers: { 'User-Agent': UA },
    })
    if (outcome !== 'ok' || !html) throw new Error(`soundgasm ${outcome}`)
    const m = html.match(MEDIA_URL_RE)
    if (!m) throw new Error('No media URL on page')
    return m[0]
  }

  async extractMetadata(url) {
    const { outcome, value: html } = await boundary.fetch(url, {
      name: 'audio-soundgasm-resolve',
      timeoutMs: 15_000,
      headers: { 'User-Agent': UA },
    })
    if (outcome !== 'ok' || !html) throw new Error(`soundgasm ${outcome}`)
    const titleMatch = html.match(/<div class="jp-title"[^>]*>([\s\S]*?)<\/div>/)
    const mediaMatch = html.match(MEDIA_URL_RE)
    if (!mediaMatch) throw new Error('No media URL on page')
    const userMatch = url.match(/\/u\/([^/]+)\//)
    return {
      url,
      audio_url: mediaMatch[0],
      title: titleMatch ? this._decode(titleMatch[1].replace(/<[^>]+>/g, '')).trim() : 'Untitled',
      creator: userMatch ? userMatch[1] : null,
      source: 'soundgasm',
    }
  }
}
