// ============================================================
// Audiochan Adapter
// audiochan.com is an adult audio hosting platform with a REST API
// at api.audiochan.com. Node.js fetch is blocked by Cloudflare TLS
// fingerprinting, so all requests go through curl (same pattern as
// the Erocast adapter).
//
// We filter by a curated tag-name allowlist so we only pull content
// relevant to the audio surface rather than everything on the platform.
// Filters by tag NAME (not slug — the /audios endpoint strips the slug
// field from tags in list responses; match lowercase name instead).
// ============================================================

import { SourceAdapter } from './base.js'
import { logger } from '../logger.js'
import { boundary } from '../boundary/index.js'
import { randomUUID } from 'crypto'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COOKIE_PATH = join(__dirname, '..', '..', 'cookies', 'audiochan.txt')

const API_BASE = 'https://api.audiochan.com'
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'

// Tags we care about — matched against lowercase tag names in the API response.
// Expand or trim this list to adjust the content filter.
const KEEP_TAG_NAMES = new Set([
  'f4m', 'f4f', 'f4a', 'm4f', 'm4m', 'm4a',
  'gfe', 'bfe', 'girlfriend experience', 'boyfriend experience',
  'mdom', 'fdom', 'dominant', 'submissive',
  'dirty talk', 'comfort', 'sleep', 'asmr',
  'script fill', 'improv',
])

// Max pages to walk per cycle. Each page is 20 items. 3 pages = 60 candidates.
const MAX_PAGES = 3

async function _curlJson(url) {
  const args = [
    '-s', '-L',
    '-A', BROWSER_UA,
    '-H', 'Accept: application/json',
  ]
  if (existsSync(COOKIE_PATH)) {
    args.push('-b', COOKIE_PATH)
  }
  // Append HTTP status code so we can detect non-2xx without a separate probe.
  args.push('-w', '\n###HTTP_STATUS=%{http_code}', url)

  const { outcome, value: raw } = await boundary.exec('curl', args, {
    name: 'audio-audiochan-api',
    timeoutMs: 20_000,
  })
  if (outcome !== 'ok' || !raw) throw new Error(`audiochan curl ${outcome}`)

  const statusMatch = raw.match(/###HTTP_STATUS=(\d+)$/)
  const status = statusMatch ? parseInt(statusMatch[1], 10) : 0
  const body = raw.replace(/\n###HTTP_STATUS=\d+$/, '').trim()

  if (status < 200 || status >= 300) throw new Error(`audiochan HTTP ${status}`)
  return JSON.parse(body)
}

function _hasKeptTag(tags = []) {
  return tags.some(t => KEEP_TAG_NAMES.has((t.name || t.tag || '').toLowerCase().trim()))
}

function _extractTags(tags = [], title = '') {
  const out = []
  for (const t of tags) {
    const name = (t.name || t.tag || '').toLowerCase().trim()
    if (name && !out.includes(name)) out.push(name)
  }
  // Also pull bracket-style tags from title e.g. [F4M]
  const bracketRe = /\[([^\]]{1,40})\]/g
  let m
  while ((m = bracketRe.exec(title)) !== null) {
    const t = m[1].trim().toLowerCase()
    if (t && !out.includes(t)) out.push(t)
  }
  return out.slice(0, 20)
}

export class AudiochanAdapter extends SourceAdapter {
  constructor() {
    super({
      name: 'audiochan',
      supportedDomains: ['audiochan.com', 'api.audiochan.com'],
      capabilities: { search: false, categories: false, trending: true, metadata: false, streamUrl: false },
    })
  }

  // Fetch trending audio, filter by tag allowlist, return normalized audio items.
  async fetchTrending() {
    const items = []

    for (let page = 1; page <= MAX_PAGES; page++) {
      let data
      try {
        data = await _curlJson(`${API_BASE}/audios?sort=trending&page=${page}&limit=20`)
      } catch (err) {
        logger.warn(`audiochan: page ${page} failed: ${err.message}`)
        break
      }

      const tracks = Array.isArray(data?.results) ? data.results
        : Array.isArray(data?.data) ? data.data
        : []

      if (tracks.length === 0) break

      for (const track of tracks) {
        if (track.is_exclusive) continue
        const tags = track.tags || []
        if (!_hasKeptTag(tags)) continue

        const audioUrl = track.audio_file?.url || track.audioFile?.url || track.stream_url || null
        if (!audioUrl) continue

        items.push({
          id: `audiochan_${track.id || randomUUID()}`,
          source_domain: 'audiochan.com',
          url: `https://audiochan.com/tracks/${track.id}`,
          audio_url: audioUrl,
          title: track.title || 'Untitled',
          creator: track.user?.display_name || track.user?.username || 'unknown',
          creator_handle: track.user?.username || null,
          tags: _extractTags(tags, track.title),
          duration_sec: track.duration || null,
          length_label: null,
        })
      }

      if (!data?.next) break
    }

    logger.info(`audiochan: ${items.length} items after tag filter`)
    return items
  }
}
