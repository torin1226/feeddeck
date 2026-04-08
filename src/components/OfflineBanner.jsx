import useQueueStore from '../stores/queueStore'

// ============================================================
// OfflineBanner
// Shows a small banner when the queue server is unreachable.
// Auto-hides when connection is restored (online state from store).
// ============================================================

export default function OfflineBanner() {
  const online = useQueueStore(s => s.online)

  if (online) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-system flex items-center justify-center py-1.5 bg-amber-600/90 text-white text-xs font-medium backdrop-blur-sm">
      Server unreachable — queue changes won't sync
    </div>
  )
}
