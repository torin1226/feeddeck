import { useEffect, useRef } from 'react'
import useQueueStore from '../stores/queueStore'

// ============================================================
// useQueueSync
// Polling hook that keeps the queue in sync with the server.
// Exponential backoff on failure: 3s → 6s → 12s → 30s → 60s cap.
// Resets to 3s on success. Pauses when tab is hidden.
// ============================================================

const BASE_INTERVAL = 3000
const MAX_INTERVAL = 60000
const BACKOFF_FACTOR = 2

export default function useQueueSync() {
  const fetchQueue = useQueueStore(s => s.fetchQueue)
  const timeoutRef = useRef(null)
  const intervalRef = useRef(BASE_INTERVAL)

  useEffect(() => {
    function stopPolling() {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }

    function scheduleNext() {
      stopPolling()
      timeoutRef.current = setTimeout(poll, intervalRef.current)
    }

    async function poll() {
      const ok = await fetchQueue()
      if (ok !== false) {
        // Success: reset to base interval
        intervalRef.current = BASE_INTERVAL
      } else {
        // Failure: exponential backoff
        intervalRef.current = Math.min(intervalRef.current * BACKOFF_FACTOR, MAX_INTERVAL)
      }
      if (!document.hidden) {
        scheduleNext()
      }
    }

    function handleVisibility() {
      if (document.hidden) {
        stopPolling()
      } else {
        // Reset backoff on tab refocus, fetch immediately
        intervalRef.current = BASE_INTERVAL
        poll()
      }
    }

    // Initial fetch
    poll()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [fetchQueue])
}
