// ============================================================
// Mode Firewall Middleware
// ============================================================
// Final-stage output filter that strips any video item from a
// response whose source URL doesn't match the request's mode.
//
// This is the belt-and-suspenders layer: even if a route is buggy
// and forgets to filter by mode, this middleware catches the leak
// before bytes hit the wire.
//
// Activation: any request that declares a mode via `?mode=social`
// or `?mode=nsfw` opts in. Requests without a mode parameter pass
// through unfiltered (admin/debug endpoints, mode-agnostic routes).
//
// Filter rules:
//   - If item has a `url`/`video_url`/`source` field, run inferMode
//     on it. If the inferred mode != request mode, drop the item.
//   - Items without any URL-like field pass through (can't classify).
//   - Filtering applies recursively to known video-array keys
//     (videos, ratings, queue, items, results, history).
// ============================================================

import { inferMode } from './utils.js'
import { logger } from './logger.js'

// Keys whose values are arrays of video-like objects we should filter.
// If we discover new ones, add them here.
const VIDEO_ARRAY_KEYS = new Set([
  'videos',
  'ratings',
  'queue',
  'items',
  'results',
  'history',
  'feed',
  'liked',
  'recommendations',
])

/** Pull a URL-like string off any video-shaped object. */
function urlOf(item) {
  if (!item || typeof item !== 'object') return null
  return item.url || item.video_url || item.streamUrl || item.stream_url || item.source || null
}

/** Does this item belong in the requested mode? */
function itemMatchesMode(item, requestMode) {
  const url = urlOf(item)
  // No URL → can't classify → allow (could be a tag, a preference, an aggregate)
  if (!url) return true
  // If the item declares an explicit mode field, trust it over URL inference
  // (server-side routes can stamp mode on rows without URLs, e.g. ratings)
  if (item.mode === 'social' || item.mode === 'nsfw') {
    return item.mode === requestMode
  }
  return inferMode(url) === requestMode
}

/** Recursively filter known video-array keys in a payload. */
function filterPayload(payload, requestMode, depth = 0) {
  if (depth > 4 || payload == null) return payload
  if (Array.isArray(payload)) {
    return payload.filter((it) => itemMatchesMode(it, requestMode))
  }
  if (typeof payload !== 'object') return payload
  // Mutate in place is fine: Express has already serialized the response
  // intent and we're between handler and send.
  for (const key of Object.keys(payload)) {
    const val = payload[key]
    if (Array.isArray(val) && VIDEO_ARRAY_KEYS.has(key)) {
      const before = val.length
      payload[key] = val.filter((it) => itemMatchesMode(it, requestMode))
      const dropped = before - payload[key].length
      if (dropped > 0) {
        logger.warn('[firewall] dropped cross-mode items', {
          key,
          dropped,
          requestMode,
        })
      }
    }
    // Recurse into nested objects/arrays one level
    else if (val && typeof val === 'object') {
      payload[key] = filterPayload(val, requestMode, depth + 1)
    }
  }
  return payload
}

/**
 * Express middleware. Wraps res.json so every JSON payload is filtered
 * by mode before being serialized.
 */
export function modeFirewall(req, res, next) {
  // Resolve declared mode. Query > header > body. Anything else: skip.
  const declared =
    req.query?.mode ||
    req.get('x-feeddeck-mode') ||
    req.body?.mode ||
    null
  if (declared !== 'social' && declared !== 'nsfw') {
    return next()
  }
  const origJson = res.json.bind(res)
  res.json = function patchedJson(payload) {
    try {
      const filtered = filterPayload(payload, declared)
      return origJson(filtered)
    } catch (err) {
      logger.error('[firewall] filter error -- returning unfiltered payload', { error: err.message })
      return origJson(payload)
    }
  }
  next()
}
