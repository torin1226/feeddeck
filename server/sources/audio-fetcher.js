// ============================================================
// Audio Fetcher
// Orchestrates fetching for the audio surface (separate from the
// video feed). Reads audio creators from the creators table where
// surface='audio', dispatches each to the right adapter, and
// writes results to audio_cache.
//
// Why this is separate from CreatorAdapter: audio items are a
// different shape (no thumbnail/orientation/view_count), live in a
// different table (audio_cache vs feed_cache), and have a different
// lifecycle (evergreen, taste-ordered, no fetched_at DESC sort).
// Keeping the dispatch separate avoids muddying the video path.
// See plan: generic-exploring-lampson.md.
// ============================================================

import { logger } from '../logger.js'
import { db } from '../database.js'
import { randomUUID } from 'crypto'
import { recomputeAudioScores } from '../scoring.js'

const REDDIT_POSTS_PER_CREATOR = 25
const SOUNDGASM_LINK_RE = /https?:\/\/soundgasm\.net\/u\/[^\s)"<]+/g
const REDDIT_UA = 'FeedDeck-audio/1.0 (content aggregator)'

// Soft cap on total audio_cache rows. On insert overflow we evict in this
// order: rated-down → watched=1 → oldest-fetched unrated. Keeps the table
// from growing unbounded as we add more audio subreddits.
const AUDIO_CACHE_SOFT_CAP = 5000

const MAX_CREATOR_FAILURES = 5

/**
 * Run one audio fetch cycle: pull from each active audio creator round-robin,
 * extract audio links, persist to audio_cache. Returns count inserted.
 */
export async function fetchAudioCycle(registry) {
  const creators = db.prepare(`
    SELECT * FROM creators
    WHERE surface = 'audio' AND active = 1
    ORDER BY last_fetched ASC NULLS FIRST
    LIMIT 10
  `).all()

  if (creators.length === 0) {
    logger.info('audio-fetcher: no active audio creators configured')
    return 0
  }

  let totalInserted = 0
  const insertedCreators = new Set()

  for (const creator of creators) {
    try {
      let items = []
      if (creator.platform === 'reddit') {
        items = await fetchRedditAudioCreator(creator, registry)
      } else if (creator.platform === 'soundgasm') {
        items = await fetchSoundgasmAudioCreator(creator, registry)
      } else {
        logger.warn(`audio-fetcher: unsupported platform ${creator.platform} for creator ${creator.handle}`)
        continue
      }

      const inserted = persistAudioItems(items)
      totalInserted += inserted
      if (inserted > 0) insertedCreators.add(items[0]?.creator)

      db.prepare(`
        UPDATE creators SET last_fetched = datetime('now'), fetch_failures = 0
        WHERE id = ?
      `).run(creator.id)

      logger.info(`audio-fetcher: ${creator.platform}/${creator.handle} → ${items.length} extracted, ${inserted} inserted`)
    } catch (err) {
      const failures = (creator.fetch_failures || 0) + 1
      db.prepare(`UPDATE creators SET fetch_failures = ? WHERE id = ?`).run(failures, creator.id)
      if (failures >= MAX_CREATOR_FAILURES) {
        db.prepare('UPDATE creators SET active = 0 WHERE id = ?').run(creator.id)
        logger.warn(`audio-fetcher: auto-disabled ${creator.platform}/${creator.handle} after ${failures} failures`)
      } else {
        logger.warn(`audio-fetcher: ${creator.platform}/${creator.handle} failed (${failures}/${MAX_CREATOR_FAILURES}): ${err.message}`)
      }
    }
  }

  if (totalInserted > 0) {
    // Recompute scores for any creators we just added rows for so the new
    // items get ordered against the existing taste profile immediately.
    for (const c of insertedCreators) {
      if (c) recomputeAudioScores(c)
    }
    enforceAudioCacheCap()
  }

  return totalInserted
}

/**
 * Pull a subreddit's hot posts and extract soundgasm.net links. Audio
 * subreddits (r/FreeAudioPorn, r/gonewildaudio, r/GWASapphic, ...) post
 * almost exclusively as self-posts with soundgasm URLs in selftext —
 * confirmed by probe before this code was written.
 */
async function fetchRedditAudioCreator(creator, registry) {
  const url = creator.url || `https://www.reddit.com/r/${creator.handle}/hot.json?limit=${REDDIT_POSTS_PER_CREATOR}`

  const resp = await fetch(url, {
    headers: {
      'User-Agent': REDDIT_UA,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!resp.ok) throw new Error(`Reddit API ${resp.status}`)

  const data = await resp.json()
  const posts = data?.data?.children || []
  const items = []

  // Resolve soundgasm URLs in parallel with a small concurrency cap so we
  // don't hammer media.soundgasm.net.
  const soundgasmAdapter = registry?.adapters?.find?.(a => a.name === 'soundgasm')

  for (const post of posts) {
    const p = post.data
    if (!p || p.stickied) continue

    // Candidate soundgasm URLs from the post (url field + selftext links).
    const urls = new Set()
    if (p.url && p.url.includes('soundgasm.net/u/')) urls.add(p.url)
    if (p.selftext) {
      for (const m of p.selftext.matchAll(SOUNDGASM_LINK_RE)) urls.add(m[0])
    }

    if (urls.size === 0) continue

    // Prefer the first soundgasm URL (most posts only link one anyway).
    const firstUrl = Array.from(urls)[0].replace(/[)\].,]+$/, '')

    let audioUrl = null
    if (soundgasmAdapter) {
      try {
        audioUrl = await soundgasmAdapter.getStreamUrl(firstUrl)
      } catch (err) {
        logger.warn(`audio-fetcher: failed to resolve ${firstUrl}: ${err.message}`)
        continue
      }
    }

    items.push({
      id: `audio_reddit_${p.id}`,
      source_domain: 'reddit.com',
      url: `https://www.reddit.com${p.permalink}`,
      audio_url: audioUrl,
      title: cleanTitle(p.title || 'Untitled'),
      creator: p.author || 'unknown',
      creator_handle: `u/${p.author || 'unknown'}`,
      tags: extractTags(p.title, p.link_flair_text),
      duration_sec: null,
      length_label: null,
    })
  }

  return items
}

async function fetchSoundgasmAudioCreator(creator, registry) {
  const adapter = registry?.adapters?.find?.(a => a.name === 'soundgasm')
  if (!adapter) throw new Error('SoundgasmAdapter not registered')
  // SoundgasmAdapter.search drives round-robin itself; for direct per-creator
  // dispatch we call its private fetcher.
  return await adapter._fetchCreator(creator)
}

function persistAudioItems(items) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO audio_cache
      (id, source_domain, url, audio_url, title, creator, creator_handle,
       tags, duration_sec, length_label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  let count = 0
  for (const item of items) {
    if (!item.audio_url) continue
    try {
      const result = insert.run(
        item.id || `audio_${randomUUID()}`,
        item.source_domain,
        item.url,
        item.audio_url,
        item.title,
        item.creator,
        item.creator_handle || null,
        JSON.stringify(item.tags || []),
        item.duration_sec || null,
        item.length_label || null,
      )
      if (result.changes > 0) count++
    } catch (err) {
      logger.warn(`audio-fetcher: insert failed for ${item.url}: ${err.message}`)
    }
  }
  return count
}

function enforceAudioCacheCap() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM audio_cache').get()
  if (n <= AUDIO_CACHE_SOFT_CAP) return

  const over = n - AUDIO_CACHE_SOFT_CAP
  // Evict rated-down first, then watched, then oldest-unrated. Done in a
  // single DELETE with priority ordering via CASE in ORDER BY.
  db.prepare(`
    DELETE FROM audio_cache WHERE id IN (
      SELECT id FROM audio_cache
      ORDER BY
        CASE WHEN rated = -1 THEN 0
             WHEN watched = 1 THEN 1
             ELSE 2 END ASC,
        fetched_at ASC
      LIMIT ?
    )
  `).run(over)
  logger.info(`audio-fetcher: evicted ${over} rows to enforce soft cap (${AUDIO_CACHE_SOFT_CAP})`)
}

function cleanTitle(t) {
  // Strip leading/trailing whitespace + zero-width chars.
  return String(t).replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
}

function extractTags(title, flair) {
  const tags = []
  const tagRe = /\[([^\]]{1,40})\]/g
  let m
  while ((m = tagRe.exec(title || '')) !== null) {
    const t = m[1].trim().toLowerCase()
    if (t && !tags.includes(t)) tags.push(t)
  }
  if (flair && typeof flair === 'string') {
    const f = flair.trim().toLowerCase()
    if (f && !tags.includes(f)) tags.push(f)
  }
  return tags.slice(0, 20)
}
