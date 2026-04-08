import { useRef, useEffect } from 'react'

// ============================================================
// useFeedGestures
// Unified gesture hook for ALL feed tabs (ForYou, Remix, mobile).
//
// Gesture map (2026-03-27):
//   Swipe right → next video
//   Swipe left  → previous video
//   Swipe up    → open source URL
//   Double-tap  → heart/like
//   Tap         → play/pause
//   Long-press  → source control sheet
// ============================================================

const SWIPE_THRESHOLD = 50     // px minimum for swipe
const SWIPE_ANGLE_MAX = 35     // degrees — must be clearly horizontal/vertical
const DOUBLE_TAP_MS = 300      // max time between taps
const LONG_PRESS_MS = 800      // long-press threshold (high to avoid conflict with scrolling)

export default function useFeedGestures({
  containerRef,
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onDoubleTap,
  onTap,
  onLongPress,
}) {
  const touchStart = useRef(null)
  const lastTapTime = useRef(0)
  const longPressTimer = useRef(null)
  const gestureConsumed = useRef(false)

  const callbacksRef = useRef({ onSwipeLeft, onSwipeRight, onSwipeUp, onDoubleTap, onTap, onLongPress })
  useEffect(() => {
    callbacksRef.current = { onSwipeLeft, onSwipeRight, onSwipeUp, onDoubleTap, onTap, onLongPress }
  }, [onSwipeLeft, onSwipeRight, onSwipeUp, onDoubleTap, onTap, onLongPress])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function handleTouchStart(e) {
      const touch = e.touches[0]
      touchStart.current = { x: touch.clientX, y: touch.clientY, time: Date.now() }
      gestureConsumed.current = false

      // Long-press detection
      longPressTimer.current = setTimeout(() => {
        gestureConsumed.current = true
        callbacksRef.current.onLongPress?.(e)
      }, LONG_PRESS_MS)
    }

    function handleTouchMove(e) {
      if (!touchStart.current) return
      const touch = e.touches[0]
      const dx = touch.clientX - touchStart.current.x
      const dy = touch.clientY - touchStart.current.y

      // If moved enough, cancel long-press
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        clearTimeout(longPressTimer.current)
      }
    }

    function handleTouchEnd(e) {
      clearTimeout(longPressTimer.current)
      if (!touchStart.current || gestureConsumed.current) {
        touchStart.current = null
        return
      }

      const touch = e.changedTouches[0]
      const dx = touch.clientX - touchStart.current.x
      const dy = touch.clientY - touchStart.current.y
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)
      const dist = Math.sqrt(dx * dx + dy * dy)

      touchStart.current = null

      if (dist >= SWIPE_THRESHOLD) {
        // Determine if horizontal or vertical swipe
        if (absDx > absDy) {
          // Horizontal — check angle is clearly horizontal
          const angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI)
          if (angle < SWIPE_ANGLE_MAX || angle > (180 - SWIPE_ANGLE_MAX)) {
            if (dx < 0) {
              callbacksRef.current.onSwipeLeft?.(e) // previous video
            } else {
              callbacksRef.current.onSwipeRight?.(e) // next video
            }
            return
          }
        } else {
          // Vertical — check it's a clear upward swipe
          if (dy < -SWIPE_THRESHOLD) {
            callbacksRef.current.onSwipeUp?.(e) // open source URL
            return
          }
          // Downward swipe — let scroll-snap handle it
          return
        }
        return
      }

      // Small movement = tap or double-tap
      const now = Date.now()
      if (now - lastTapTime.current < DOUBLE_TAP_MS) {
        lastTapTime.current = 0
        callbacksRef.current.onDoubleTap?.(e)
      } else {
        lastTapTime.current = now
        // Delay single tap to distinguish from double-tap
        setTimeout(() => {
          if (Date.now() - lastTapTime.current >= DOUBLE_TAP_MS - 10) {
            callbacksRef.current.onTap?.(e)
          }
        }, DOUBLE_TAP_MS)
      }
    }

    function handleTouchCancel() {
      clearTimeout(longPressTimer.current)
      touchStart.current = null
    }

    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: true })
    el.addEventListener('touchend', handleTouchEnd, { passive: true })
    el.addEventListener('touchcancel', handleTouchCancel, { passive: true })

    const timer = longPressTimer.current
    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', handleTouchEnd)
      el.removeEventListener('touchcancel', handleTouchCancel)
      clearTimeout(timer)
    }
  }, [containerRef])
}
