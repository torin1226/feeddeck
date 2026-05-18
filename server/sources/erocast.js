// ============================================================
// Erocast Adapter
// erocast.me is a GWA-focused adult audio hosting platform.
// Audio files are served as HLS (.m3u8) playlists from Wasabi S3.
// The site is behind Cloudflare, so requests go through curl.
//
// Discovery strategy: scrape genre listing pages (HTML, curl-
// compatible) and parse embedded `song_data_N` JSON blobs. We
// rotate through a curated genre list each cycle to maintain variety.
// See research in session log 2026-05-17.
// ============================================================

import { SourceAdapter } from './base.js'
import { logger } from '../logger.js'
import { boundary } from '../boundary/index.js'
import { db } from '../database.js'
import { randomUUID } from 'crypto'

const BASE = 'https://erocast.me'
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'

// Genre slugs to rotate through. Order is the rotation priority.
// `gfe` and `bfe` first (highest quality signal), then kink genres.
const GENRE_SLUGS = [
  'gfe', 'bfe', 'fwb', 'narrative', 'improv',
  'ramble-fap', 'fdom', 'mdom', 'fsub', 'msub',
]

// How many genres to pull per cycle (rotate through the full list over time).
const GENRES_PER_CYCLE = 3

// Max items to pull per genre page (the page shows all-time items; newest first).
const ITEMS_PER_GENRE = 15

// Regex to extract embedded song_data blobs from genre page HTML.
// Each track is embedded as: var song_data_12345 = {...};
const SONG_DATA_RE = /var\s+song_data_(\d+)\s*=\s*(\{[\s\S]*?\});\s*(?:var|<\/script>)/g

// Polite delay between genre page fetches.
const FETCH_DELAY_MS = 500

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function _curlHtml(url) {
  const args = [
    '-s', '-L',
    '-A', BROWSER_UA,
    '-H', 'Accept: text/html',
    url,
  ]
  const { outcome, value: html } = await boundary.exec('curl', args, {
    name: 'audio-erocast-genre',
    timeoutMs: 20_000,
  })
  if (outcome !== 'ok' || !html) throw new Error(`erocast curl ${outcome}`)
  return html
}

function _parseSongBlobs(html) {
  const tracks = []
  let m
  SONG_DATA_RE.lastIndex = 0
  while ((m = SONG_DATA_RE.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[2])
      tracks.push(data)
      if (tracks.length >= ITEMS_PER_GENRE) break
    } catch {
      // malformed blob — skip
    }
  }
  return tracks
}

function _normalizeTrack(data) {
  const audioUrl = data.file_url || data.stream_url
  if (!audioUrl) return null

  const tags = []
  // Structured tags array
  if (Array.isArray(data.tags)) {
    for (const t of data.tags) {
      const name = (t.tag || t.name || '').trim().toLowerCase()
      if (name && !tags.includes(name)) tags.push(name)
    }
  }
  // Bracket-style tags from title e.g. [F4M], [ASMR]
  const bracketRe = /\[([^\]]{1,40})\]/g
  let bm
  while ((bm = bracketRe.exec(data.title || '')) !== null) {
    const t = bm[1].trim().toLowerCase()
    if (t && !tags.includes(t)) tags.push(t)
  }

  return {
    id: `erocast_${data.id || randomUUID()}`,
    source_domain: 'erocast.me',
    url: data.permalink_url || `${BASE}/track/${data.id}`,
    audio_url: audioUrl,
    title: data.title || 'Untitled',
    creator: data.user?.name || data.user?.username || 'unknown',
    creator_handle: data.user?.username || null,
    tags: tags.slice(0, 20),
    duration_sec: data.duration || null,
    length_label: null,
  }
}

export class ErocastAdapter extends SourceAdapter {
  constructor() {
    super({
      name: 'erocast',
      supportedDomains: ['erocast.me'],
      capabilities: { search: false, categories: true, trending: false, metadata: false, streamUrl: false },
    })
    // Tracks which genre index we last fetched so we rotate each cycle.
    this._genreOffset = 0
  }

  async fetchCategories() {
    const items = []

    // Pick next N genres in rotation
    const genreBatch = []
    for (let i = 0; i < GENRES_PER_CYCLE; i++) {
      genreBatch.push(GENRE_SLUGS[(this._genreOffset + i) % GENRE_SLUGS.length])
    }
    this._genreOffset = (this._genreOffset + GENRES_PER_CYCLE) % GENRE_SLUGS.length

    // Skip URLs already in the cache to avoid hammering per-track pages
    for (const slug of genreBatch) {
      try {
        const html = await _curlHtml(`${BASE}/genre/${slug}`)
        const tracks = _parseSongBlobs(html)

        // Filter already-cached URLs
        const urls = tracks.map(t => t.permalink_url || `${BASE}/track/${t.id}`).filter(Boolean)
        const existingUrls = urls.length > 0
          ? new Set(
              db.prepare(`SELECT url FROM audio_cache WHERE url IN (${urls.map(() => '?').join(',')})`)
                .all(...urls).map(r => r.url)
            )
          : new Set()

        for (const track of tracks) {
          const url = track.permalink_url || `${BASE}/track/${track.id}`
          if (existingUrls.has(url)) continue
          const item = _normalizeTrack(track)
          if (item) items.push(item)
        }

        logger.info(`erocast: genre/${slug} → ${tracks.length} tracks, ${items.length} total so far`)
        await sleep(FETCH_DELAY_MS)
      } catch (err) {
        logger.warn(`erocast: genre/${slug} failed: ${err.message}`)
      }
    }

    return items
  }
}
