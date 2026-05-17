// ============================================================
// Cookie Health Check
// Lightweight probes to verify cookies are valid for key
// domains. Runs on server start and via /api/cookies/health.
// ============================================================

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getCookieArgs } from './cookies.js'
import { boundary } from './boundary/index.js'
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
 * Returns { youtube: { status, message }, pornhub: { status, message }, instagram: { ... }, ... }
 * Status: 'healthy' | 'expired' | 'missing' | 'error'
 */
export async function checkCookieHealth() {
  const results = {}

  for (const [key, probe] of Object.entries(PROBES)) {
    results[key] = await _probeOneDomain(key, probe)
  }

  // Instagram uses a fetch-based probe (yt-dlp extractor is currently broken upstream)
  results.instagram = await _probeInstagram()

  return results
}

// Map a yt-dlp domain (e.g. youtube.com, youtu.be, pornhub.com) to a probe key.
const DOMAIN_TO_PROBE_KEY = {
  'youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'pornhub.com': 'pornhub',
  'instagram.com': 'instagram',
}

/**
 * Probe a single cookie domain. Used by ytdlp.js to verify that a stderr
 * "cookies are no longer valid" warning is real before poisoning the skip set.
 * Returns the same shape as a single entry in checkCookieHealth(), or null if
 * the domain has no configured probe (caller should fall back to TTL-only).
 */
export async function probeCookieForDomain(domain) {
  const probeKey = DOMAIN_TO_PROBE_KEY[domain]
  if (!probeKey) return null
  if (probeKey === 'instagram') return _probeInstagram()
  if (!PROBES[probeKey]) return null
  return _probeOneDomain(probeKey, PROBES[probeKey])
}

export { DOMAIN_TO_PROBE_KEY }

async function _probeOneDomain(key, probe) {
  // Check if cookies exist for this domain
  const cookieArgs = getCookieArgs(probe.testUrl)
  if (cookieArgs.length === 0) {
    return { status: 'missing', message: `No cookie file found for ${probe.label}` }
  }

  const args = [
    '--js-runtimes', 'node',
    ...cookieArgs,
    '--dump-json',
    '--playlist-end', '1',
    '--no-download',
    '--no-warnings',
    probe.testUrl,
  ]

  // Routed through boundary.exec (M7 Sprint 2). Static boundary name —
  // all yt-dlp cookie probes (YouTube, PornHub, others) aggregate under
  // one tag. Granular per-domain breakdown would inflate the tally Map
  // without diagnostic value (the result struct already reports per-
  // domain status to the caller).
  const { outcome, value: stdout, stderr, error } = await boundary.exec('yt-dlp', args, {
    name: 'cookie-health-ytdlp',
    timeoutMs: PROBE_TIMEOUT,
  })

  if (outcome === 'ok') {
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
  }

  // outcome !== 'ok' — classify into the same status taxonomy the caller expects.
  const errStderr = error?.stderr || stderr || ''
  const errMsg = error?.message || ''
  const combined = errMsg + ' ' + errStderr

  // Rate-limit is not a cookie issue — auth works, server just throttled.
  if (outcome === 'rate_limited' || /rate.?limit|429|try again later/i.test(combined)) {
    return { status: 'healthy', message: `${probe.label} cookies valid (rate-limited, but auth works)` }
  }

  // Check for expired-cookie signals in error output
  for (const pattern of probe.expiredPatterns) {
    if (pattern.test(combined)) {
      return { status: 'expired', message: `${probe.label} cookies expired — re-import in Settings` }
    }
  }
  if (outcome === 'auth_failed') {
    return { status: 'expired', message: `${probe.label} cookies expired — re-import in Settings` }
  }

  // HYDRATION: prefer the first "ERROR: ..." line from stderr (yt-dlp's actual
  // failure reason) over the verbose Node "Command failed: ..." prefix that
  // includes the entire command line. The old 100-char cap truncated mid-path
  // and made stale-URL bugs look like cookie path bugs.
  const ytErr = errStderr.split('\n').find(l => l.startsWith('ERROR:'))
  const detail = ytErr ? ytErr.replace(/^ERROR:\s*/, '') : (errMsg || outcome)
  return { status: 'error', message: `${probe.label} probe failed: ${detail.substring(0, 250)}` }
}

// Instagram probe: uses fetch() with parsed cookies because yt-dlp's instagram extractor
// is currently broken upstream. Checks if the session cookie grants access to the
// accounts/edit page (only reachable when logged in).
async function _probeInstagram() {
  const cookiePath = join(__dirname, '..', 'cookies', 'instagram.txt')
  let text
  try { text = readFileSync(cookiePath, 'utf-8') } catch {
    return { status: 'missing', message: 'Instagram cookie file not found (cookies/instagram.txt)' }
  }

  // Parse Netscape cookies into a Cookie header string
  const pairs = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const parts = t.split('\t')
    if (parts.length < 7) continue
    const [, , , , , name, value] = parts
    if (name && value) pairs.push(`${name}=${value}`)
  }

  if (pairs.length === 0) {
    return { status: 'missing', message: 'Instagram cookie file is empty or malformed' }
  }

  // Routed through boundary.fetch (M7 Sprint 2). Uses the wrap's
  // `finalUrl` extension because session-expiry detection requires the
  // URL after redirects (login bounce).
  const { outcome, status, finalUrl, error } = await boundary.fetch('https://www.instagram.com/accounts/edit/', {
    name: 'cookie-health-ig-probe',
    timeoutMs: PROBE_TIMEOUT,
    acceptHtml: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
      'Cookie': pairs.join('; '),
      'Accept': 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  })

  if (outcome === 'ok') {
    if (finalUrl && finalUrl.includes('/accounts/login')) {
      return { status: 'expired', message: 'Instagram cookies expired — re-export from Arc browser' }
    }
    return { status: 'healthy', message: 'Instagram cookies valid' }
  }
  if (outcome === 'auth_failed') {
    return { status: 'expired', message: 'Instagram cookies expired — re-export from Arc browser' }
  }
  const detail = error?.message?.substring(0, 200) || status || outcome
  return { status: 'error', message: `Instagram probe ${outcome}: ${detail}` }
}
