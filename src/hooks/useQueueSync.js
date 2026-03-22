import { useEffect, useRef } from 'react'
import useQueueStore from '../stores/queueStore'

// ============================================================
// useQueueSync
// Polling hook that keeps the queue in sync with the server.
// Fetches every 3s, pauses when tab is hidden, fetches
// immediately on visibility change (tab refocus).
// ============================================================

const POLL_INTERVAL = 3000

export default function useQueueSync() {
  const fetchQueue = useQueueStore(s => s.fetchQueue)
  const intervalRef = useRef(null)

  useEffect(() => {
    // Initial fetch
    fetchQueue()

    // Start polling
    function startPolling() {
      stopPolling()
      intervalRef.current = setInterval(fetchQueue, POLL_INTERVAL)
    }

    function stopPolling() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    function handleVisibility() {
      if (document.hidden) {
        stopPolling()
      } else {
        // Fetch immediately on tab refocus, then resume polling
        fetchQueue()
        startPolling()
      }
    }

    startPolling()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [fetchQueue])
}
