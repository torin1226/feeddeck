import { useRef, useEffect } from 'react'

// ============================================================
// useFeedGestures
// Touch + mouse gesture detection for the swipe feed.
// Detects: horizontal swipes (left/right), double-tap, long-press.
// Vertical swipes are handled natively by CSS scroll-snap.
// ============================================================

const SWIPE_THRESHOLD = 50     // px minimum for horizontal swipe
const SWIPE_ANGLE_MAX = 30     // degrees — must be clearly horizontal
const DOUBLE_TAP_MS = 300      // max time between taps

export default function useFeedGestures({
  containerRef,
  onSwipeLeft,
  onSwipeRight,
  onDoubleTap,
  onTap,
  onLongPress,
}) {
  const touchStart = useRef(null)
  const lastTapTime = useRef(0)
  const longPressTimer = useRef(null)
  const tapTimer = useRef(null)
  const gestureConsumed = useRef(false)

  const callbacksRef = useRef({ onSwipeLeft, onSwipeRight, onDoubleTap, onTap, onLongPress })
  useEffect(() => {
    callbacksRef.current = { onSwipeLeft, onSwipeRight, onDoubleTap, onTap, onLongPress }
  }, [onSwipeLeft, onSwipeRight, onDoubleTap, onTap, onLongPress])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function handleTouchStart(e) {
      const touch = e.touches[0]
      touchStart.current = { x: touch.clientX, y: touch.clientY, time: Date.now() }
      gestureConsumed.current = false

      // Long-press disabled for now (was interfering with playback)
      // longPressTimer.current = setTimeout(() => {
      //   gestureConsumed.current = true
      //   callbacksRef.current.onLongPress?.(e)
      // }, LONG_PRESS_MS)
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
      const dist = Math.sqrt(dx * dx + dy * dy)
      const angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI)

      touchStart.current = null

      // Check for horizontal swipe
      if (dist >= SWIPE_THRESHOLD) {
        const isHorizontal = angle < SWIPE_ANGLE_MAX || angle > (180 - SWIPE_ANGLE_MAX)
        if (isHorizontal) {
          if (dx < 0) {
            callbacksRef.current.onSwipeLeft?.(e)
          } else {
            callbacksRef.current.onSwipeRight?.(e)
          }
          return
        }
        // Vertical swipe — let scroll-snap handle it
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
        clearTimeout(tapTimer.current)
        tapTimer.current = setTimeout(() => {
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

    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', handleTouchEnd)
      el.removeEventListener('touchcancel', handleTouchCancel)
      clearTimeout(longPressTimer.current)
      clearTimeout(tapTimer.current)
    }
  }, [containerRef])
}
