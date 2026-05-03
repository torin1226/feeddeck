import { memo, forwardRef } from 'react'

// ============================================================
// DetailPlayer
// Player frame for the watch page. Always renders the same
// <video> DOM instance; the wrapper's positioning class is
// driven by `mode` so transitions to fullscreen / PIP keep
// playback continuous.
//
// Modes:
//   - "standard"   : in-page, native <video controls>
//   - "fullscreen" : fixed inset-0 z-50; native controls hidden
//                    so a parent <FullscreenOverlay> can render
//                    custom chrome.
// ============================================================

const PIP_CLASSES =
  'fixed top-5 right-5 left-auto bottom-auto w-[32%] aspect-video rounded-xl overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.7)]'

const FS_CLASSES =
  'fixed inset-0 rounded-none'

const STANDARD_CLASSES =
  'relative aspect-video rounded-xl'

const DetailPlayer = forwardRef(function DetailPlayer({
  videoRef,
  poster,
  streamLoading,
  streamError,
  onRetry,
  ariaTitle,
  mode = 'standard',
  pipMode = false,
  children,
}, wrapperRef) {
  const isFullscreen = mode === 'fullscreen'
  const wrapClass = `${
    isFullscreen
      ? (pipMode ? PIP_CLASSES : FS_CLASSES)
      : STANDARD_CLASSES
  } bg-black overflow-hidden transition-[top,right,bottom,left,width,height,border-radius] duration-400 ease-[cubic-bezier(0.4,0,0.2,1)] z-[60]`

  return (
    <div ref={wrapperRef} className={wrapClass} data-mode={mode} data-pip={pipMode || undefined}>
      <video
        ref={videoRef}
        poster={poster || undefined}
        className="w-full h-full object-contain"
        controls={!isFullscreen}
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

      {children}
    </div>
  )
})

export default memo(DetailPlayer)
