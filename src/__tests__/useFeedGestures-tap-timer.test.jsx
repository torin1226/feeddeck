import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

import useFeedGestures from '../hooks/useFeedGestures'

// React 18 requires this global so act() doesn't warn under vitest/jsdom.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// ============================================================
// useFeedGestures — tap-delay timer cleanup regression suite.
//
// Before today, the single-tap delay setTimeout was not captured into
// a ref, so:
//   - Component unmount during the 300ms tap window left the timer to
//     fire past unmount, calling onTap on a destroyed handler.
//   - Rapid taps stacked timers instead of replacing the prior one.
// Both shapes match the May 4 known-issues entry on orphan-setTimeout-
// in-handlers. These tests pin the new behavior.
// ============================================================

// Minimal helper to dispatch a touch sequence the hook listens for.
function fireTouch(el, type, x, y) {
  const touch = { clientX: x, clientY: y }
  const event = new Event(type, { bubbles: true, cancelable: true })
  // Hook reads e.touches[0] / e.changedTouches[0].
  Object.defineProperty(event, 'touches', { value: [touch] })
  Object.defineProperty(event, 'changedTouches', { value: [touch] })
  el.dispatchEvent(event)
}

function TestHarness({ onTap, containerRef }) {
  useFeedGestures({
    containerRef,
    onSwipeLeft: () => {},
    onSwipeRight: () => {},
    onSwipeUp: () => {},
    onDoubleTap: () => {},
    onTap,
    onLongPress: () => {},
  })
  return null
}

describe('useFeedGestures tap-delay timer cleanup', () => {
  let root
  let container
  let target

  beforeEach(() => {
    vi.useFakeTimers()
    target = document.createElement('div')
    document.body.appendChild(target)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    document.body.removeChild(container)
    document.body.removeChild(target)
    vi.useRealTimers()
  })

  function mount(onTap) {
    const containerRef = createRef()
    containerRef.current = target
    act(() => {
      root.render(<TestHarness onTap={onTap} containerRef={containerRef} />)
    })
  }

  it('does NOT fire onTap when component unmounts during tap-delay window', () => {
    const onTap = vi.fn()
    mount(onTap)

    fireTouch(target, 'touchstart', 100, 100)
    fireTouch(target, 'touchend', 100, 100)

    // Unmount before the 300ms tap delay elapses.
    act(() => {
      root.unmount()
    })

    // Advance past the tap-delay threshold. A pre-fix orphan timer would
    // call onTap here; the captured-ref + cleanup must prevent that.
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(onTap).not.toHaveBeenCalled()
  })

  it('only fires onTap once when many taps land in a short window', () => {
    // Rapid taps with the SAME timestamp would have stacked timers
    // pre-fix; clear-before-schedule means only the most recent timer
    // remains in flight and onTap fires at most once per resolved tap.
    const onTap = vi.fn()
    mount(onTap)

    for (let i = 0; i < 5; i++) {
      fireTouch(target, 'touchstart', 100, 100)
      fireTouch(target, 'touchend', 100, 100)
      // Small gap, well under DOUBLE_TAP_MS (300).
      act(() => { vi.advanceTimersByTime(30) })
    }

    // Drain the timer queue.
    act(() => { vi.advanceTimersByTime(500) })

    // The tap-delay logic gates on `Date.now() - lastTapTime.current
    // >= DOUBLE_TAP_MS - 10`, so only the LAST scheduled timer can
    // satisfy that — the prior timers were cleared before the next
    // scheduled. Net effect: <= 1 onTap call.
    expect(onTap.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('fires onTap normally for a single tap that completes before unmount', () => {
    const onTap = vi.fn()
    mount(onTap)

    fireTouch(target, 'touchstart', 100, 100)
    fireTouch(target, 'touchend', 100, 100)

    // Let the tap-delay timer fire while still mounted.
    act(() => { vi.advanceTimersByTime(500) })

    expect(onTap).toHaveBeenCalledTimes(1)
  })
})
