// ============================================================
// Cookie Routing
// Maps URL domains to the correct cookie file or browser
// for authenticated yt-dlp requests. Each site gets its own
// cookie source to prevent cross-contamination between modes.
// ============================================================

import { existsSync, copyFileSync, mkdirSync, unlinkSync, readdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { randomBytes } from 'crypto'
import { logger } from './logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COOKIES_DIR = join(__dirname, '..', 'cookies')
const DATA_DIR = join(__dirname, '..', 'data')
// Use /tmp in Docker (avoids permission issues with mounted volumes), fallback to data dir locally
const COOKIES_TMP = process.env.COOKIE_TMP_DIR || join(DATA_DIR, '.cookie-tmp')
// Temp files are cleaned up on server startup (see below), not on a timer.
// Timer-based cleanup caused PermissionError on Windows when yt-dlp tried to
// save cookies back to a file that was deleted while still open.

// Mode-based cookie files (fallback when per-domain file is missing)
const MODE_COOKIE_FILES = {
  social: join(DATA_DIR, 'cookies-social.txt'),
  nsfw: join(DATA_DIR, 'cookies-nsfw.txt'),
}
// Legacy combined file (last-resort fallback)
const LEGACY_COOKIE_FILE = join(DATA_DIR, 'cookies.txt')

// Ensure temp dir exists for cookie copies
try { mkdirSync(COOKIES_TMP, { recursive: true }) } catch {}

// Clean up stale temp cookie files on startup
try {
  for (const f of readdirSync(COOKIES_TMP)) {
    try { unlinkSync(join(COOKIES_TMP, f)) } catch {}
  }
} catch {}

const COOKIE_MAP = {
  // Social — explicit cookie files
  'youtube.com':    { file: 'youtube.txt', mode: 'social' },
  'youtu.be':       { file: 'youtube.txt', mode: 'social' },
  'tiktok.com':     { file: 'tiktok.txt', mode: 'social' },
  'instagram.com':  { file: 'instagram.txt', mode: 'social' },

  'twitter.com':    { file: 'twitter.txt', mode: 'social' },
  'x.com':          { file: 'twitter.txt', mode: 'social' },

  // NSFW — explicit cookie files
  'pornhub.com':    { file: 'pornhub.txt', mode: 'nsfw' },
  'fikfap.com':     { file: 'fikfap.txt', mode: 'nsfw' },
  'redgifs.com':    { file: 'redgifs.txt', mode: 'nsfw' },

  // NSFW — no per-domain cookies, fall back to mode file
  'xvideos.com':    { mode: 'nsfw' },
  'spankbang.com':  { mode: 'nsfw' },
  'redtube.com':    { mode: 'nsfw' },
  'xhamster.com':   { mode: 'nsfw' },
  'youporn.com':    { mode: 'nsfw' },
  'xnxx.com':       { mode: 'nsfw' },
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
  const cookiePath = _resolveCookiePath(config)
  if (!cookiePath) return []

  return _tempCopyArgs(cookiePath)
}

/**
 * Resolve the best cookie file for a domain config.
 * Priority: per-domain file → mode-based file → legacy cookies.txt
 */
function _resolveCookiePath(config) {
  // 1. Per-domain cookie file (most specific)
  if (config?.file) {
    const fullPath = join(COOKIES_DIR, config.file)
    if (existsSync(fullPath)) return fullPath
  }

  // 2. Mode-based cookie file
  if (config?.mode && MODE_COOKIE_FILES[config.mode] && existsSync(MODE_COOKIE_FILES[config.mode])) {
    return MODE_COOKIE_FILES[config.mode]
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
    // No timer-based cleanup — files are cleaned up on next server startup.
    // Deleting while yt-dlp is still running causes PermissionError on Windows.
    return ['--cookies', tmpPath]
  } catch (err) {
    logger.warn(`Cookie temp copy failed: ${err.message}`)
    return ['--cookies', cookiePath]
  }
}

/**
 * Parse a Netscape cookie file and return { name: value } pairs for a given domain.
 * Uses the same resolution logic as getCookieArgs (per-domain → mode → legacy).
 * @param {string} domain - e.g. 'x.com', 'youtube.com'
 * @returns {{ cookies: Record<string, string>, cookiePath: string|null }}
 */
export function parseCookieFile(domain) {
  const config = COOKIE_MAP[domain]
  const cookiePath = _resolveCookiePath(config)
  if (!cookiePath) return { cookies: {}, cookiePath: null }

  try {
    const text = readFileSync(cookiePath, 'utf-8')
    const cookies = {}
    for (const line of text.split('\n')) {
      if (!line || line.startsWith('#') || line.startsWith(' ')) continue
      const parts = line.split('\t')
      if (parts.length < 7) continue
      const [cookieDomain, , , , , name, rawValue] = parts
      const value = rawValue?.trim() // strip \r from Windows line endings
      // Match exact domain or parent domain (e.g. .x.com matches x.com)
      const clean = cookieDomain.trim().replace(/^\./, '')
      if (clean === domain || domain.endsWith('.' + clean) || clean.endsWith('.' + domain)) {
        cookies[name.trim()] = value
      }
    }
    return { cookies, cookiePath }
  } catch (err) {
    logger.warn(`parseCookieFile(${domain}): ${err.message}`)
    return { cookies: {}, cookiePath }
  }
}

export { COOKIE_MAP, MODE_COOKIE_FILES, LEGACY_COOKIE_FILE }
