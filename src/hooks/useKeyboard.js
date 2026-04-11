import { useEffect } from 'react'
import useModeStore from '../stores/modeStore'
import useQueueStore from '../stores/queueStore'
import useDeviceStore from '../stores/deviceStore'

// ============================================================
// useKeyboard Hook
// Global keyboard shortcuts.
// CRITICAL: Escape always goes TO SFW (panic key, never toggle).
// Also collapses the floating queue.
// ============================================================

// Shared ref so FloatingQueue can register its collapse callback
export const queueCollapseRef = { current: null }

export default function useKeyboard() {
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't capture when typing in inputs
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      switch (e.key) {
        // PANIC KEY — always go to SFW, never toggle
        // Also collapse the queue panel
        case 'Escape':
          e.preventDefault()
          useModeStore.getState().activateSFW()
          queueCollapseRef.current?.()
          break

        // N — skip to next in queue
        case 'n':
        case 'N': {
          // Only handle globally when NOT in the video player
          // (VideoPlayer has its own N handler)
          const vid = document.querySelector('video')
          if (vid) break // Let VideoPlayer handle it
          e.preventDefault()
          useQueueStore.getState().advance()
          break
        }

        // Ctrl+M — toggle mobile preview mode
        case 'm':
        case 'M':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            useDeviceStore.getState().toggleMobilePreview()
          }
          break

        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
