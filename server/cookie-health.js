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
    testUrl: 'https://www.pornhub.com/view_video.php?viewkey=ph5f8b3c7a21a28',
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

    return { status: 'error', message: `${probe.label} probe failed: ${msg.substring(0, 100)}` }
  }
}
