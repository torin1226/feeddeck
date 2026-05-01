import { memo } from 'react'

// ============================================================
// DetailPlayer
// Player frame for the watch page. Owns the <video> element
// and a thin loading/error overlay. Native controls handle
// play/pause/seek for the standard view; Phase 3 layers a
// custom chrome on top for fullscreen mode.
// ============================================================

function DetailPlayer({
  videoRef,
  poster,
  streamLoading,
  streamError,
  onRetry,
  ariaTitle,
}) {
  return (
    <div
      className="relative bg-black rounded-xl overflow-hidden"
      style={{ aspectRatio: '16 / 9' }}
    >
      <video
        ref={videoRef}
        poster={poster || undefined}
        className="w-full h-full object-contain"
        controls
        autoPlay
        muted
        playsInline
        aria-label={ariaTitle || 'Video player'}
      />
      {streamLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 text-text-muted gap-2 pointer-events-none">
          <div className="w-8 h-8 border-2 border-text-muted border-t-white rounded-full animate-spin" />
          <p className="text-sm">Loading stream...</p>
        </div>
      )}
      {!streamLoading && streamError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-text-muted gap-3">
          <p className="text-sm">Could not load stream</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="px-4 py-1.5 rounded-full text-xs font-semibold bg-white/10 border border-white/20 text-text-primary hover:bg-white/20 transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default memo(DetailPlayer)
