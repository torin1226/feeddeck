// ============================================================
// FeedDeck Service Worker — Video Segment Cache
// Caches the first ~500KB of proxy-stream responses so swipe
// transitions start from cache instantly. The rest streams
// from the network in the background.
// ============================================================

const CACHE_NAME = 'fd-video-segments-v1'
const MAX_CACHE_BYTES = 500 * 1024 // 500KB per video
const MAX_CACHE_ENTRIES = 30 // Limit total cached videos

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Only intercept proxy-stream requests (video data)
  if (!url.pathname.startsWith('/api/proxy-stream')) return

  // Don't cache range requests (seeking) — let those go straight to network
  if (request.headers.get('Range')) return

  event.respondWith(handleVideoRequest(request))
})

async function handleVideoRequest(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)

  if (cached) {
    // Serve cached segment instantly, fetch full response in background
    refreshInBackground(request, cache)
    return cached
  }

  // Not cached — fetch from network, cache the first segment
  try {
    const response = await fetch(request)

    if (response.ok && response.body) {
      // Clone for caching — we'll store a truncated version
      const cloned = response.clone()
      cacheSegment(cloned, request, cache)
    }

    return response
  } catch (err) {
    // Network failure — return whatever we have or a 503
    return new Response('Video unavailable offline', { status: 503 })
  }
}

// Cache just the first MAX_CACHE_BYTES of the response
async function cacheSegment(response, request, cache) {
  try {
    const reader = response.body.getReader()
    const chunks = []
    let totalBytes = 0

    while (totalBytes < MAX_CACHE_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      totalBytes += value.byteLength
    }

    reader.cancel() // Stop reading — we only need the first segment

    // Merge chunks into a single buffer
    const merged = new Uint8Array(Math.min(totalBytes, MAX_CACHE_BYTES))
    let offset = 0
    for (const chunk of chunks) {
      const end = Math.min(chunk.byteLength, MAX_CACHE_BYTES - offset)
      merged.set(chunk.subarray(0, end), offset)
      offset += end
      if (offset >= MAX_CACHE_BYTES) break
    }

    // Build a partial response with correct headers
    const headers = new Headers()
    headers.set('Content-Type', response.headers.get('Content-Type') || 'video/mp4')
    headers.set('Content-Length', String(merged.byteLength))
    headers.set('X-FD-Cached', 'segment')

    const cachedResponse = new Response(merged.buffer, {
      status: 200,
      headers,
    })

    await cache.put(request, cachedResponse)
    await evictOldEntries(cache)
  } catch {
    // Caching failed silently — no impact on playback
  }
}

// Background refresh: re-fetch full response to update cache with fresh segment
function refreshInBackground(request, cache) {
  fetch(request).then(async (response) => {
    if (response.ok && response.body) {
      await cacheSegment(response.clone(), request, cache)
    }
  }).catch(() => {})
}

// Keep cache size bounded — remove oldest entries when over limit
async function evictOldEntries(cache) {
  const keys = await cache.keys()
  if (keys.length <= MAX_CACHE_ENTRIES) return

  // Remove oldest entries (first in list)
  const toRemove = keys.length - MAX_CACHE_ENTRIES
  for (let i = 0; i < toRemove; i++) {
    await cache.delete(keys[i])
  }
}
