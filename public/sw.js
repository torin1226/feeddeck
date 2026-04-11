// ============================================================
// FeedDeck Service Worker — Video Segment Cache
// Caches the first ~500KB of each preloaded video response so
// swipe transitions start from cache instantly while the rest
// streams in from the network.
//
// Strategy:
// - Only caches /api/proxy-stream responses (video bytes)
// - Uses a dedicated cache with size and entry limits
// - Stale entries evicted by LRU when limit exceeded
// - Non-video requests always go to network (no offline shell)
// ============================================================

const CACHE_NAME = 'fd-video-segments-v1'
const MAX_CACHE_ENTRIES = 50        // Max cached video segments
const MAX_SEGMENT_BYTES = 512_000   // ~500KB per video segment
const PROXY_STREAM_PATH = '/api/proxy-stream'

// -----------------------------------------------------------
// Install: skip waiting so new SW activates immediately
// -----------------------------------------------------------
self.addEventListener('install', () => {
  self.skipWaiting()
})

// -----------------------------------------------------------
// Activate: claim all clients and clean up old caches
// -----------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('fd-video-') && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
})

// -----------------------------------------------------------
// Fetch: intercept proxy-stream requests for cache-first video
// -----------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Only intercept proxy-stream video requests
  if (!url.pathname.startsWith(PROXY_STREAM_PATH)) return

  // Don't cache range requests (seeking) — let those go to network
  if (event.request.headers.get('range')) return

  event.respondWith(handleVideoRequest(event.request))
})

async function handleVideoRequest(request) {
  const cache = await caches.open(CACHE_NAME)

  // 1. Check cache first
  const cached = await cache.match(request)
  if (cached) {
    // Return cached segment immediately, also refresh in background
    refreshCache(request, cache)
    return cached
  }

  // 2. Cache miss: fetch from network, cache the first segment
  try {
    const networkResponse = await fetch(request)

    // Only cache successful video responses
    if (networkResponse.ok && isVideoResponse(networkResponse)) {
      // Clone the response and cache the first segment
      cacheVideoSegment(request, networkResponse.clone(), cache)
    }

    return networkResponse
  } catch (err) {
    // Network failure with no cache — let the error propagate
    throw err
  }
}

// Cache the first MAX_SEGMENT_BYTES of a video response
async function cacheVideoSegment(request, response, cache) {
  try {
    const reader = response.body.getReader()
    const chunks = []
    let totalBytes = 0

    // Read up to MAX_SEGMENT_BYTES
    while (totalBytes < MAX_SEGMENT_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      totalBytes += value.byteLength
    }

    // Cancel the rest of the stream (we only want the initial segment)
    reader.cancel()

    // Combine chunks into a single buffer
    const segment = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      segment.set(chunk, offset)
      offset += chunk.byteLength
    }

    // Create a new response with just the cached segment
    const headers = new Headers(response.headers)
    headers.set('x-fd-cached', 'segment')
    headers.set('content-length', String(totalBytes))

    const cachedResponse = new Response(segment, {
      status: 200,
      statusText: 'OK',
      headers,
    })

    // Enforce cache entry limit before adding
    await enforceLimit(cache)
    await cache.put(request, cachedResponse)
  } catch {
    // Caching is best-effort — failures are silent
  }
}

// Background refresh: fetch new segment without blocking the response
async function refreshCache(request, cache) {
  try {
    const networkResponse = await fetch(request)
    if (networkResponse.ok && isVideoResponse(networkResponse)) {
      await cacheVideoSegment(request, networkResponse, cache)
    }
  } catch {
    // Background refresh failure is silent
  }
}

// Check if the response is actually video content
function isVideoResponse(response) {
  const ct = response.headers.get('content-type') || ''
  return ct.startsWith('video/') || ct === 'application/octet-stream'
}

// Evict oldest entries when cache exceeds MAX_CACHE_ENTRIES
async function enforceLimit(cache) {
  const keys = await cache.keys()
  if (keys.length >= MAX_CACHE_ENTRIES) {
    // Delete oldest entries (first in list = oldest)
    const toDelete = keys.length - MAX_CACHE_ENTRIES + 1
    for (let i = 0; i < toDelete; i++) {
      await cache.delete(keys[i])
    }
  }
}

// -----------------------------------------------------------
// Message handler: allow the app to send cache management commands
// -----------------------------------------------------------
self.addEventListener('message', (event) => {
  if (event.data?.type === 'PRECACHE_VIDEO') {
    // App wants to pre-cache a video URL (used by feed preloader)
    const url = event.data.url
    if (url) {
      precacheVideo(url)
    }
  } else if (event.data?.type === 'CLEAR_VIDEO_CACHE') {
    caches.delete(CACHE_NAME)
  }
})

// Pre-cache a video segment by URL (triggered by app's preload logic)
async function precacheVideo(url) {
  try {
    const cache = await caches.open(CACHE_NAME)
    const existing = await cache.match(url)
    if (existing) return // Already cached

    const response = await fetch(url)
    if (response.ok && isVideoResponse(response)) {
      await cacheVideoSegment(new Request(url), response, cache)
    }
  } catch {
    // Pre-cache failure is silent
  }
}
