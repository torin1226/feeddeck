// ============================================================
// Cookie Health Check
// Lightweight probes to verify cookies are valid for key
// domains. Runs on server start and via /api/cookies/health.
// ============================================================

import { execFile } from 'child_process'
import { promisify } from 'util'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { getCookieArgs } from './cookies.js'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))

const PROBE_TIMEOUT = 15_000 // 15 seconds max per probe

// Probe configs: lightweight yt-dlp commands that verify cookie auth
const PROBES = {
  youtube: {
    label: 'YouTube',
    // Use a public video as a low-cost test — dump-json with playlist-end 1
    testUrl: 'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
    // Patterns that indicate expired/invalid cookies
    expiredPatterns: [
      /cookies are no longer valid/i,
      /login required/i,
      /sign in/i,
      /This content isn't available/i,
    ],
  },
  pornhub: {
    label: 'PornHub',
    // HYDRATION: use a category page, not a specific video. Individual videos get
    // taken down (the previous probe URL `view_video.php?viewkey=ph5f8b3c7a21a28`
    // started returning 404 in April 2026). The /video?o=tr trending page always
    // exists as long as PH is reachable, and yt-dlp can extract playlist entries.
    testUrl: 'https://www.pornhub.com/video?o=tr',
    expiredPatterns: [
      /login required/i,
      /cookies.*invalid/i,
    ],
  },
}

/**
 * Check cookie health for all configured domains.
 * Returns { youtube: { status, message }, pornhub: { status, message }, ... }
 * Status: 'healthy' | 'expired' | 'missing' | 'error'
 */
export async function checkCookieHealth() {
  const results = {}

  for (const [key, probe] of Object.entries(PROBES)) {
    results[key] = await _probeOneDomain(key, probe)
  }

  return results
}

// Map a yt-dlp domain (e.g. youtube.com, youtu.be, pornhub.com) to a probe key.
const DOMAIN_TO_PROBE_KEY = {
  'youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'pornhub.com': 'pornhub',
}

/**
 * Probe a single cookie domain. Used by ytdlp.js to verify that a stderr
 * "cookies are no longer valid" warning is real before poisoning the skip set.
 * Returns the same shape as a single entry in checkCookieHealth(), or null if
 * the domain has no configured probe (caller should fall back to TTL-only).
 */
export async function probeCookieForDomain(domain) {
  const probeKey = DOMAIN_TO_PROBE_KEY[domain]
  if (!probeKey || !PROBES[probeKey]) return null
  return _probeOneDomain(probeKey, PROBES[probeKey])
}

export { DOMAIN_TO_PROBE_KEY }

async function _probeOneDomain(key, probe) {
  // Check if cookies exist for this domain
  const cookieArgs = getCookieArgs(probe.testUrl)
  if (cookieArgs.length === 0) {
    return { status: 'missing', message: `No cookie file found for ${probe.label}` }
  }

  try {
    const args = [
      '--js-runtimes', 'node',
      ...cookieArgs,
      '--dump-json',
      '--playlist-end', '1',
      '--no-download',
      '--no-warnings',
      probe.testUrl,
    ]

    const { stdout, stderr } = await execFileAsync('yt-dlp', args, {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT,
      windowsHide: true,
    })

    // If we got valid JSON back, cookies are working
    try {
      JSON.parse(stdout.trim().split('\n')[0])
      return { status: 'healthy', message: `${probe.label} cookies valid` }
    } catch {
      // Got output but not JSON — might be an error message
      const combined = (stdout + ' ' + (stderr || '')).trim()
      for (const pattern of probe.expiredPatterns) {
        if (pattern.test(combined)) {
          return { status: 'expired', message: `${probe.label} cookies expired — re-import in Settings` }
        }
      }
      return { status: 'error', message: `${probe.label} returned unexpected output` }
    }
  } catch (err) {
    const msg = err.message || ''
    const stderr = err.stderr || ''
    const combined = msg + ' ' + stderr

    // Check for expired cookie signals in error output
    for (const pattern of probe.expiredPatterns) {
      if (pattern.test(combined)) {
        return { status: 'expired', message: `${probe.label} cookies expired — re-import in Settings` }
      }
    }

    // Rate-limit is not a cookie issue
    if (/rate.?limit|429|try again later/i.test(combined)) {
      return { status: 'healthy', message: `${probe.label} cookies valid (rate-limited, but auth works)` }
    }

    // HYDRATION: prefer the first "ERROR: ..." line from stderr (yt-dlp's actual
    // failure reason) over the verbose Node "Command failed: ..." prefix that
    // includes the entire command line. The old 100-char cap truncated mid-path
    // and made stale-URL bugs look like cookie path bugs.
    const ytErr = stderr.split('\n').find(l => l.startsWith('ERROR:'))
    const detail = ytErr ? ytErr.replace(/^ERROR:\s*/, '') : msg
    return { status: 'error', message: `${probe.label} probe failed: ${detail.substring(0, 250)}` }
  }
}
