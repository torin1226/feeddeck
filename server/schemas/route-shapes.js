// Response-shape contract manifests for getMode(req) routes.
//
// Background: 2026-05-14 commit 07a9e52 fixed a 19-day silent dead-code bug
// where homeStore parsed /api/tags/preferences as { liked, disliked } but the
// server has returned { preferences: [{tag, preference}] } since the April 25
// firewall commit. No layer caught the drift because there was no shape contract.
//
// This manifest is the second half of the route-shape work started by the
// 2026-05-14 auto-2 session (commit ab7422b) which shipped the runtime mode-leak
// recorder for /api/debug/mode-leaks. That recorder catches the missing-mode
// class of bug; this manifest catches the response-shape class.
//
// Each entry maps a "METHOD /path" key to the canonical top-level keys the
// route returns on its success path. The companion test
// server/__tests__/route-shape-contracts.test.js exercises every entry against
// a real in-memory boot of the route and asserts shape match.
//
// To add a new route: add the key here, then the test file's `ROUTES` array.
// Drift is caught at vitest run time. Routes that return different shapes for
// different query params (rare on the getMode set) need their variants listed
// separately or an `oneOf` extension to assertResponseShape.

export const ROUTE_SHAPES = {
  'GET /api/tags/preferences': { keys: ['preferences'] },
  'GET /api/tags/popular': { keys: ['tags'] },
  'GET /api/ratings/history': { keys: ['ratings'] },
  'GET /api/videos': { keys: ['videos'] },
  'GET /api/videos/favorites': { keys: ['videos'] },
  'GET /api/videos/watch-later': { keys: ['videos'] },
}

// Assert the actual response body matches the manifest entry for the route.
// Throws on drift. Used by the contract test file. Exported separately so
// future zod-style runtime enforcement can wrap it without re-defining the
// manifest.
export function assertResponseShape(method, path, actual) {
  const key = `${method} ${path}`
  const manifest = ROUTE_SHAPES[key]
  if (!manifest) {
    throw new Error(`No response-shape manifest for ${key}`)
  }
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
    throw new Error(
      `Response shape drift on ${key}: expected object with keys [${manifest.keys.join(',')}] but got ${actual === null ? 'null' : Array.isArray(actual) ? 'array' : typeof actual}`
    )
  }
  const actualKeys = Object.keys(actual).sort()
  const expectedKeys = [...manifest.keys].sort()
  if (actualKeys.join(',') !== expectedKeys.join(',')) {
    throw new Error(
      `Response shape drift on ${key}: expected keys [${expectedKeys.join(',')}] but got [${actualKeys.join(',')}]`
    )
  }
}
