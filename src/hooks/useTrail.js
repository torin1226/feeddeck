import { useEffect, useRef, useState } from 'react'

// ============================================================
// useTrail
// On /watch/:id mount, POST a "seed" request to the backend
// (which fires two yt-dlp searches in the background and
// persists results), then poll /api/recommendations/trail
// every 1.5s for ~10s until the pool hydrates with rows for
// this seed. After that, stop polling.
//
// Exposes:
//   { trail, hydrated, loading, error }
//
// `trail` always reflects the latest pool snapshot for the
// current seed (can be empty during the polling window).
// `hydrated` flips true the first time we get a non-empty pool.
// ============================================================

const POLL_INTERVAL_MS = 2000
// Cold yt-dlp searches against YouTube can take 20-45s when cookies are
// stale. Poll for ~60s before giving up — the search is happening in the
// background, the user just doesn't see results until then.
const MAX_POLLS = 30
const FETCH_TIMEOUT_MS = 6000

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

export default function useTrail(seedItem) {
  const [trail, setTrail] = useState([])
  const [hydrated, setHydrated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const seededRef = useRef(null)

  const seedUrl = seedItem?.url

  useEffect(() => {
    // Reset when the seed changes
    setTrail([])
    setHydrated(false)
    setError(null)
    if (!seedUrl) return undefined

    // Avoid double-seeding the same URL within a single mount lifecycle.
    if (seededRef.current === seedUrl) return undefined
    seededRef.current = seedUrl

    let cancelled = false
    let polls = 0
    let timer = null

    const seedBody = {
      videoUrl: seedUrl,
      title: seedItem?.title || '',
      tags: Array.isArray(seedItem?.tags) ? seedItem.tags : [],
      uploader: seedItem?.uploader || '',
      channelUrl: seedItem?.channelUrl || seedItem?.channel_url || '',
    }

    setLoading(true)
    fetch('/api/recommendations/trail/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(seedBody),
    }).catch(() => { /* non-fatal — polling will just return empty */ })

    async function pollOnce() {
      if (cancelled) return
      try {
        const res = await withTimeout(
          fetch(`/api/recommendations/trail?seedVideoUrl=${encodeURIComponent(seedUrl)}&limit=24`),
          FETCH_TIMEOUT_MS,
        )
        if (cancelled) return
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const items = data?.items || []
        setTrail(items)
        if (items.length > 0 && !hydrated) {
          setHydrated(true)
        }
        // Stop early once we have a meaningful pool (>= 6 entries) — most of
        // the rail can render. We still allow more polls if the first ones
        // came back empty, since yt-dlp can take a beat.
        if (items.length >= 6) {
          setLoading(false)
          return
        }
      } catch (err) {
        if (!cancelled) setError(err.message || String(err))
      }
      polls++
      if (polls < MAX_POLLS && !cancelled) {
        timer = setTimeout(pollOnce, POLL_INTERVAL_MS)
      } else {
        if (!cancelled) setLoading(false)
      }
    }

    // First poll fires after a short delay so the seed has a chance to start.
    timer = setTimeout(pollOnce, 600)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedUrl])

  return { trail, hydrated, loading, error }
}
