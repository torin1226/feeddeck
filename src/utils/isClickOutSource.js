// Sources whose individual items can't be played in-app and must open
// in a new tab on the source's website instead.
//
// Why this exists: yt-dlp's Instagram extractor is upstream-broken (since
// at least 2026-04, confirmed via probe 2026-05-06). Static cookie auth
// also fails ("Instagram sent an empty media response"). Rather than show
// a broken video card with a useless "Tap to retry" button, we mark these
// items so the feed can render a "Open on Instagram" CTA.
//
// Adding a source here means: discovery still works (cards appear with
// thumbnails + titles), but tapping the card opens the source's webpage
// in a new tab instead of attempting in-app playback. Honest fallback
// beats broken middle state.
//
// Source values come from `source_domain` in feed_cache (set by the
// scraper as the site key, e.g. 'instagram.com'). We also accept the
// platform short form ('instagram') in case a different ingest path
// normalizes it. Comparison is case-insensitive.
const CLICK_OUT_SOURCES = new Set(['instagram', 'instagram.com'])

export function isClickOutSource(source) {
  if (!source) return false
  return CLICK_OUT_SOURCES.has(String(source).toLowerCase())
}
