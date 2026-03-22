import { useRef, useEffect } from 'react'

// ============================================================
// useFeaturedScroll
//
// Scroll-driven 4-phase animation for the featured section.
// Uses CSS sticky positioning + scroll-position interpolation.
// Only animates compositor-friendly properties (transform, opacity,
// border-radius).
//
// Phase 1 (0 → 0.20):    Full-bleed hold, overlay fades in
// Phase 2 (0.20 → 0.40): Zoom out to carousel, sides fade in, chrome in
// Phase 3 (0.40 → 0.90): Carousel hold (interactive)
// Phase 4 (0.90 → 1.0):  Exit — scale down, fade, chrome out
// ============================================================

const P1_END = 0.20
const P2_END = 0.40
const P3_END = 0.90
const FC_INTERVAL = 5000

const CAROUSEL_TRANSITION =
  'transform 0.55s cubic-bezier(0.25,0.46,0.45,0.94), opacity 0.55s ease'

const OFFSETS = [
  { dx: -68, scale: 0.72, opacity: 0.5, z: 5 },
  { dx: -36, scale: 0.84, opacity: 0.7, z: 7 },
  { dx: 0,   scale: 1.0,  opacity: 1.0, z: 10 },
  { dx: 36,  scale: 0.84, opacity: 0.7, z: 7 },
  { dx: 68,  scale: 0.72, opacity: 0.5, z: 5 },
]

function lerp(a, b, t) { return a + (b - a) * t }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

export default function useFeaturedScroll({
  zoneRef,
  _stickyRef,
  cardsRef,
  chromeRef,
  overlayRef,
  activeIndex,
  totalCards,
  onPhase4Enter,
  onPhase4Leave,
  advanceFeatured,
  setFeaturedIndex,
}) {
  const rafPending = useRef(false)
  const prevPhase4 = useRef(false)
  const fullbleedScale = useRef(1)
  const activeIdxRef = useRef(activeIndex)
  const totalCardsRef = useRef(totalCards)
  const callbacksRef = useRef({ onPhase4Enter, onPhase4Leave, advanceFeatured, setFeaturedIndex })
  const autoIntervalRef = useRef(null)
  const prevTotalRef = useRef(totalCards)
  const reducedMotion = useRef(false)
  const videoRef = useRef(null)
  const phase2Timer = useRef(null)
  const prevInPhase2 = useRef(false)

  activeIdxRef.current = activeIndex
  totalCardsRef.current = totalCards
  useEffect(() => {
    callbacksRef.current = { onPhase4Enter, onPhase4Leave, advanceFeatured, setFeaturedIndex }
  }, [onPhase4Enter, onPhase4Leave, advanceFeatured, setFeaturedIndex])

  // ── Helpers ──

  function computeScale() {
    const vw = window.innerWidth
    const cardW = vw * 0.62
    fullbleedScale.current = vw / cardW
  }

  function getProgress() {
    const zone = zoneRef.current
    if (!zone) return 0
    const rect = zone.getBoundingClientRect()
    const scrollBuffer = zone.offsetHeight - window.innerHeight
    if (scrollBuffer <= 0) return 0
    return clamp(-rect.top / scrollBuffer, 0, 1)
  }

  // ── Chrome / Overlay helpers ──

  function setChromeOpacity(opacity) {
    const chrome = chromeRef.current
    if (!chrome) return
    const op = String(opacity)
    const pe = opacity > 0 ? 'auto' : 'none'
    const els = [chrome.header, chrome.arrowL, chrome.arrowR, chrome.dots, chrome.progress]
    els.forEach(el => {
      if (!el) return
      el.style.opacity = op
      el.style.pointerEvents = pe
    })
  }

  function setOverlayOpacity(opacity) {
    const overlay = overlayRef?.current
    if (!overlay) return
    overlay.style.opacity = String(opacity)
    overlay.style.pointerEvents = opacity > 0.5 ? 'auto' : 'none'
  }

  // ── Progress bar / auto-advance ──

  function resetProgressBar() {
    const bar = chromeRef.current?.progressBar
    if (!bar) return
    bar.style.transition = 'none'
    bar.style.width = '0%'
    requestAnimationFrame(() => {
      bar.style.transition = `width ${FC_INTERVAL}ms linear`
      bar.style.width = '100%'
    })
  }

  function _startAutoAdvance() {
    stopAutoAdvance()
    autoIntervalRef.current = setInterval(() => {
      callbacksRef.current.advanceFeatured?.()
    }, FC_INTERVAL)
    resetProgressBar()
  }

  function stopAutoAdvance() {
    if (autoIntervalRef.current) {
      clearInterval(autoIntervalRef.current)
      autoIntervalRef.current = null
    }
  }

  // ── Apply carousel (Phase 4 layout with transitions) ──

  function applyCarousel() {
    const cards = cardsRef.current
    const idx = activeIdxRef.current
    if (!cards || cards.length === 0) return

    cards.forEach((card, i) => {
      if (!card) return
      const offset = i - idx
      card.style.transition = CAROUSEL_TRANSITION

      if (offset === 0) {
        card.style.transform = 'scale(1)'
        card.style.opacity = '1'
        card.style.borderRadius = '16px'
        card.style.zIndex = '10'
        card.style.pointerEvents = 'auto'
      } else {
        const clamped = clamp(offset, -2, 2)
        const pos = OFFSETS[clamped + 2]
        const vis = Math.abs(offset) <= 2
        card.style.transform = `translateX(${pos.dx}%) scale(${pos.scale})`
        card.style.opacity = vis ? `${pos.opacity}` : '0'
        card.style.borderRadius = '16px'
        card.style.zIndex = vis ? `${pos.z}` : '0'
        card.style.pointerEvents = vis ? 'auto' : 'none'
      }
    })

    setChromeOpacity(1)
    setOverlayOpacity(1)
  }

  // ── Core: applyProgress ──

  function applyProgress(p) {
    const cards = cardsRef.current
    const idx = activeIdxRef.current
    if (!cards || cards.filter(Boolean).length === 0) return

    // Reduced motion: jump to Phase 3 midpoint
    if (reducedMotion.current && p > 0) p = 0.65

    const fb = fullbleedScale.current
    let activeScale, radius, activeOpacity, sideProgress, chromeOpacity, overlayOpacity
    let exitScale = 1
    let exitOpacity = 1

    if (p <= P1_END) {
      // Phase 1: full-bleed hold, overlay fades in
      const t = p / P1_END
      activeScale = fb
      radius = 0
      activeOpacity = 1
      sideProgress = 0
      chromeOpacity = 0
      overlayOpacity = t
    } else if (p <= P2_END) {
      // Phase 2: zoom out to carousel, sides fade in, chrome in, overlay out
      const t = (p - P1_END) / (P2_END - P1_END)
      activeScale = lerp(fb, 1.0, t)
      radius = lerp(0, 16, t)
      activeOpacity = 1
      sideProgress = t
      chromeOpacity = t
      overlayOpacity = lerp(1, 0, t)
    } else if (p <= P3_END) {
      // Phase 3: carousel hold — overlay visible on active card
      activeScale = 1.0
      radius = 16
      activeOpacity = 1
      sideProgress = 1
      chromeOpacity = 1
      overlayOpacity = 1
    } else {
      // Phase 4: exit
      const t = (p - P3_END) / (1 - P3_END)
      activeScale = 1.0
      radius = 16
      activeOpacity = 1
      sideProgress = 1
      exitScale = lerp(1, 0.97, t)
      exitOpacity = lerp(1, 0.85, t)
      chromeOpacity = lerp(1, 0, t)
      overlayOpacity = 0
    }

    // Clear carousel transitions before applying scroll-driven values
    cards.forEach((card, i) => {
      if (!card) return
      card.style.transition = 'none'
      const offset = i - idx

      if (offset === 0) {
        card.style.transform = `scale(${activeScale * exitScale})`
        card.style.opacity = `${activeOpacity * exitOpacity}`
        card.style.borderRadius = `${radius}px`
        card.style.zIndex = '10'
        card.style.pointerEvents = 'auto'
      } else {
        const clamped = clamp(offset, -2, 2)
        const pos = OFFSETS[clamped + 2]
        const sideScale = lerp(0.5, pos.scale, sideProgress) * exitScale
        const sideOp = Math.abs(offset) > 2
          ? 0
          : lerp(0, pos.opacity, sideProgress) * exitOpacity

        card.style.transform = `translateX(${pos.dx}%) scale(${sideScale})`
        card.style.opacity = `${sideOp}`
        card.style.borderRadius = '16px'
        card.style.zIndex = Math.abs(offset) > 2 ? '0' : `${pos.z}`
        card.style.pointerEvents = sideOp > 0.3 ? 'auto' : 'none'
      }
    })

    setChromeOpacity(chromeOpacity)
    setOverlayOpacity(overlayOpacity)
  }

  // ── Scroll handler (rAF-batched) ──

  function handleScroll() {
    if (rafPending.current) return
    rafPending.current = true

    requestAnimationFrame(() => {
      rafPending.current = false
      const p = getProgress()
      applyProgress(p)

      // Phase 1 video playback (full-bleed hold)
      const inPhase1 = p <= P1_END
      if (inPhase1 && !prevInPhase2.current) {
        prevInPhase2.current = true
        clearTimeout(phase2Timer.current)
        phase2Timer.current = setTimeout(() => {
          const video = videoRef.current
          if (video && video.readyState >= 2) {
            video.muted = true
            video.play().catch(() => {})
          }
        }, 300)
      } else if (!inPhase1 && prevInPhase2.current) {
        prevInPhase2.current = false
        clearTimeout(phase2Timer.current)
        const video = videoRef.current
        if (video) video.pause()
      }

      // Phase 3 enter/leave detection (carousel hold) + scroll-driven cycling
      const inPhase3 = p >= P2_END && p <= P3_END
      if (inPhase3 && !prevPhase4.current) {
        prevPhase4.current = true
        callbacksRef.current.onPhase4Enter?.()
      } else if (!inPhase3 && prevPhase4.current) {
        prevPhase4.current = false
        callbacksRef.current.onPhase4Leave?.()
      }

      // Scroll-driven card cycling within Phase 3
      if (inPhase3) {
        const total = totalCardsRef.current
        if (total > 0) {
          const t = (p - P2_END) / (P3_END - P2_END)
          const scrollIdx = Math.min(Math.floor(t * total), total - 1)
          if (scrollIdx !== activeIdxRef.current) {
            callbacksRef.current.setFeaturedIndex?.(scrollIdx)
          }
        }
      }
    })
  }

  // ── Setup ──

  useEffect(() => {
    reducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    computeScale()
    applyProgress(0)

    const onResize = () => {
      computeScale()
      const p = getProgress()
      applyProgress(p)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', onResize)
      stopAutoAdvance()
      clearTimeout(phase2Timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Late-mount watcher: recompute when cards go from 0 → N
  useEffect(() => {
    if (prevTotalRef.current === 0 && totalCards > 0) {
      computeScale()
      applyProgress(getProgress())
    }
    prevTotalRef.current = totalCards
  }, [totalCards])

  // activeIndex watcher: update carousel if in Phase 4
  useEffect(() => {
    if (prevPhase4.current) {
      applyCarousel()
      resetProgressBar()
    }
  }, [activeIndex])

  return {
    isInteractive: () => prevPhase4.current,
    navigateTo: (idx) => {
      if (prevPhase4.current) {
        activeIdxRef.current = idx
        applyCarousel()
      }
    },
    setVideoRef: (el) => { videoRef.current = el },
  }
}
