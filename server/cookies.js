// ============================================================
// Cookie Routing
// Maps URL domains to the correct cookie file or browser
// for authenticated yt-dlp requests. Each site gets its own
// cookie source to prevent cross-contamination between modes.
// ============================================================

import { existsSync, copyFileSync, mkdirSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { randomBytes } from 'crypto'
import { logger } from './logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COOKIES_DIR = join(__dirname, '..', 'cookies')
const COOKIES_TMP = join(__dirname, '..', 'data', '.cookie-tmp')

// Ensure temp dir exists for cookie copies
try { mkdirSync(COOKIES_TMP, { recursive: true }) } catch {}

// Clean up stale temp cookie files on startup
try {
  const { readdirSync } = await import('fs')
  for (const f of readdirSync(COOKIES_TMP)) {
    try { unlinkSync(join(COOKIES_TMP, f)) } catch {}
  }
} catch {}

// Active temp files: track so we don't delete while in use
const activeTempFiles = new Set()

const COOKIE_MAP = {
  // Social — explicit cookie files
  'youtube.com':    { file: 'youtube.txt' },
  'youtu.be':       { file: 'youtube.txt' },
  'tiktok.com':     { file: 'tiktok.txt' },

  // NSFW — explicit cookie files
  'pornhub.com':    { file: 'pornhub.txt' },
  'fikfap.com':     { file: 'fikfap.txt' },
  'redgifs.com':    { file: 'redgifs.txt' },

  // NSFW — no cookies needed for public content
  // 'xvideos.com':  { browser: 'chrome' },
  // 'spankbang.com': { browser: 'chrome' },
  // 'redtube.com':  { browser: 'chrome' },
  // 'xnxx.com':     { browser: 'chrome' },
}

/**
 * Returns yt-dlp cookie arguments for a given URL.
 * Handles regular URLs, yt-dlp search strings (ytsearch:...), and unknown domains.
 * @param {string} url - URL or yt-dlp search string
 * @returns {string[]} yt-dlp args (e.g. ['--cookies', '/path/to/file'] or [])
 */
export function getCookieArgs(url) {
  if (!url) return []

  let domain

  // Handle yt-dlp search strings (ytsearch10:cats, ytsearchdate5:music, etc.)
  if (/^ytsearch\w*:/i.test(url)) {
    domain = 'youtube.com'
  } else {
    try {
      domain = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return []
    }
  }

  // Find matching entry (exact or suffix match for subdomains)
  let config = COOKIE_MAP[domain]
  if (!config) {
    for (const [key, val] of Object.entries(COOKIE_MAP)) {
      if (domain.endsWith('.' + key)) {
        config = val
        break
      }
    }
  }

  if (!config) return []

  if (config.file) {
    const fullPath = join(COOKIES_DIR, config.file)
    if (existsSync(fullPath)) {
      // Copy to temp file to avoid PermissionError when multiple yt-dlp
      // processes try to write back to the same cookie file concurrently.
      // Use unique random name per call; cleanup after 3 minutes (yt-dlp
      // search can take up to 2min).
      try {
        const tmpName = `${randomBytes(4).toString('hex')}-${config.file}`
        const tmpPath = join(COOKIES_TMP, tmpName)
        copyFileSync(fullPath, tmpPath)
        activeTempFiles.add(tmpPath)
        setTimeout(() => {
          activeTempFiles.delete(tmpPath)
          try { unlinkSync(tmpPath) } catch {}
        }, 180_000)
        return ['--cookies', tmpPath]
      } catch (err) {
        logger.warn(`Cookie temp copy failed for ${config.file}: ${err.message}`)
        // Fallback to original — may PermissionError on concurrent writes
        return ['--cookies', fullPath]
      }
    }
    logger.warn(`Cookie file missing: ${config.file} (expected at ${fullPath})`)
    return []
  }

  if (config.browser) {
    return ['--cookies-from-browser', config.browser]
  }

  return []
}

export { COOKIE_MAP }
