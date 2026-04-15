// Global singleton ensuring only one video preview plays at a time
// across PosterCard (usePreviewVideo) and row cards (useHoverPreview).

let _cancel = null

// Call before starting any preview. Cancels whatever is currently playing,
// then registers the new cancel function.
export function claimPreview(cancelFn) {
  if (_cancel) _cancel()
  _cancel = cancelFn
}
