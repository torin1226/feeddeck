import { useEffect, useState } from 'react'

// ============================================================
// useAmbientColor
// Samples the dominant color of an image via canvas. Returns
// `[r, g, b]` or null. Used by HeroSection to tint the gradient
// overlay with the thumbnail's ambient hue.
//
// Fails silently when the canvas is CORS-tainted (most non-YT
// CDNs). Caller falls back to the default gradient palette.
// ============================================================

const SAMPLE_SIZE = 24
// Bound the module-level cache so a long browse session can't grow the
// map without limit. Same shape as useFocusPreview's URL_CACHE_CAP — FIFO
// eviction past this size. Hero items churn through many thumbnails over
// a session and rgb-tuple values are tiny but the keys (image URLs) add
// up. 200 keeps the working set warm without unbounded growth.
const CACHE_CAP = 200
const cache = new Map()

function cacheSet(url, value) {
  // Re-insert to move to the tail of the Map (Map preserves insertion
  // order so the oldest entry is always at the head for eviction).
  if (cache.has(url)) cache.delete(url)
  cache.set(url, value)
  while (cache.size > CACHE_CAP) {
    cache.delete(cache.keys().next().value)
  }
}

function sample(img) {
  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_SIZE
  canvas.height = SAMPLE_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
  let data
  try {
    data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
  } catch {
    return null
  }

  let r = 0, g = 0, b = 0, weightSum = 0
  for (let i = 0; i < data.length; i += 4) {
    const pr = data[i], pg = data[i + 1], pb = data[i + 2]
    const max = Math.max(pr, pg, pb)
    const min = Math.min(pr, pg, pb)
    const lum = (max + min) / 2
    const sat = max === 0 ? 0 : (max - min) / max
    // Bias toward saturated mid-luminance pixels — these carry the "look"
    // of the image. Floor of 0.05 keeps low-contrast frames from sampling
    // to NaN.
    const lumWeight = 1 - Math.abs(lum - 128) / 128
    const w = sat * lumWeight + 0.05
    r += pr * w
    g += pg * w
    b += pb * w
    weightSum += w
  }
  if (weightSum === 0) return null
  return [Math.round(r / weightSum), Math.round(g / weightSum), Math.round(b / weightSum)]
}

export default function useAmbientColor(url) {
  const [color, setColor] = useState(() => (url && cache.has(url) ? cache.get(url) : null))

  useEffect(() => {
    if (!url) { setColor(null); return }
    if (cache.has(url)) { setColor(cache.get(url)); return }

    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (cancelled) return
      const rgb = sample(img)
      cacheSet(url, rgb)
      setColor(rgb)
    }
    img.onerror = () => {
      if (cancelled) return
      cacheSet(url, null)
      setColor(null)
    }
    img.src = url

    return () => { cancelled = true }
  }, [url])

  return color
}

// Test helpers — only used by useAmbientColor.test.js to drive the cache
// directly without orchestrating Image() loads in jsdom.
export const _CACHE_CAP_FOR_TESTS = CACHE_CAP

export function _cacheSetForTests(url, value) {
  cacheSet(url, value)
}

export function _peekCacheForTests() {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  }
}

export function _resetCacheForTests() {
  cache.clear()
}
