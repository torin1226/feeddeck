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
const DATA_DIR = join(__dirname, '..', 'data')
const COOKIES_TMP = join(DATA_DIR, '.cookie-tmp')

// Mode-based cookie files (fallback when per-domain file is missing)
const MODE_COOKIE_FILES = {
  social: join(DATA_DIR, 'cookies-social.txt'),
  nsfw: join(DATA_DIR, 'cookies-nsfw.txt'),
}
// Legacy combined file (last-resort fallback)
const LEGACY_COOKIE_FILE = join(DATA_DIR, 'cookies.txt')

// Which mode each domain belongs to (for mode-based fallback)
const DOMAIN_MODE = {
  'youtube.com': 'social',
  'youtu.be': 'social',
  'tiktok.com': 'social',
  'instagram.com': 'social',
  'pornhub.com': 'nsfw',
  'fikfap.com': 'nsfw',
  'redgifs.com': 'nsfw',
  'xvideos.com': 'nsfw',
  'spankbang.com': 'nsfw',
  'redtube.com': 'nsfw',
  'xhamster.com': 'nsfw',
  'youporn.com': 'nsfw',
}

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

  // Resolve cookie file: per-domain → mode-based → legacy → none
  const cookiePath = _resolveCookiePath(config, domain)
  if (!cookiePath) return []

  return _tempCopyArgs(cookiePath)
}

/**
 * Resolve the best cookie file for a domain.
 * Priority: per-domain file → mode-based file → legacy cookies.txt
 */
function _resolveCookiePath(config, domain) {
  // 1. Per-domain cookie file (most specific)
  if (config?.file) {
    const fullPath = join(COOKIES_DIR, config.file)
    if (existsSync(fullPath)) return fullPath
  }

  // 2. Mode-based cookie file
  const mode = DOMAIN_MODE[domain]
  if (mode && MODE_COOKIE_FILES[mode] && existsSync(MODE_COOKIE_FILES[mode])) {
    return MODE_COOKIE_FILES[mode]
  }

  // 3. Legacy combined cookies.txt
  if (existsSync(LEGACY_COOKIE_FILE)) return LEGACY_COOKIE_FILE

  return null
}

/**
 * Copy cookie file to a temp path and return yt-dlp args.
 * Avoids PermissionError when multiple yt-dlp processes share the same file.
 */
function _tempCopyArgs(cookiePath) {
  try {
    const tmpName = `${randomBytes(4).toString('hex')}-cookies.txt`
    const tmpPath = join(COOKIES_TMP, tmpName)
    copyFileSync(cookiePath, tmpPath)
    activeTempFiles.add(tmpPath)
    setTimeout(() => {
      activeTempFiles.delete(tmpPath)
      try { unlinkSync(tmpPath) } catch {}
    }, 180_000)
    return ['--cookies', tmpPath]
  } catch (err) {
    logger.warn(`Cookie temp copy failed: ${err.message}`)
    return ['--cookies', cookiePath]
  }
}

export { COOKIE_MAP, MODE_COOKIE_FILES, LEGACY_COOKIE_FILE }
