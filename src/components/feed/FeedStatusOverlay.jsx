import useFeedStore from '../../stores/feedStore'

// Returns a status string describing which placeholder UI the feed should
// render before any video slots can show, or null when slots should render.
// Centralises the logic so ForYouFeed and RemixFeed agree on the order of
// checks (loading wins, then error+empty, then plain empty).
export function getFeedStatus({ initialized, loading, error, isEmpty }) {
  if (!initialized && loading) return 'loading'
  if (initialized && isEmpty && error) return 'error'
  if (initialized && isEmpty) return 'empty'
  return null
}

// Shared loading / error / empty placeholder for the swipe feed surfaces.
// Owns the Retry behaviour so both feeds use the same reset+reinit dance.
export default function FeedStatusOverlay({ status, error }) {
  if (status === 'loading') {
    return (
      <div className="h-dvh w-full bg-black flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
      </div>
    )
  }

  if (status === 'error') {
    const onRetry = () => {
      useFeedStore.getState().resetFeed()
      // Defer init by a tick so the store's reset commit settles before
      // initFeed picks up the post-reset state.
      setTimeout(() => useFeedStore.getState().initFeed(), 100)
    }
    return (
      <div className="h-dvh w-full bg-black flex flex-col items-center justify-center gap-3">
        <div className="text-2xl">&#9888;</div>
        <div className="text-white/50 text-sm">{error}</div>
        <button
          onClick={onRetry}
          className="mt-2 px-5 py-2 rounded-full bg-accent text-white text-sm font-medium active:scale-95 transition-transform"
        >
          Retry
        </button>
      </div>
    )
  }

  if (status === 'empty') {
    return (
      <div className="h-dvh w-full bg-black flex items-center justify-center">
        <div className="text-white/50 text-sm">No videos in feed</div>
      </div>
    )
  }

  return null
}
