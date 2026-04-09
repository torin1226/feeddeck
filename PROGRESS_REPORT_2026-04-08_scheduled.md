# Progress Report — 2026-04-08 (Scheduled Daily Run)

## Work Completed

### 5 Backlog Items Addressed

1. **P0: Truncated source files (verified resolved)** — Checked 10 key source files; all intact. Discovered `src/index.css` was truncated mid-keyframe (`@keyframes fadeIn` had no closing brace). Fixed by completing the keyframe and removing duplicate view transition CSS rules that existed earlier in the file.

2. **P0: Theatre mode loading state** — Replaced the plain "Loading stream..." text with a proper centered spinner (animated border-spin) inside a backdrop-blur container. Added `role="status"` and `aria-live="polite"` for screen readers.

3. **P0: Hero Like button** — The heart button in HeroSection had no `onClick`. Wired it to `libraryStore.toggleFavorite()`, added visual state feedback (filled heart `♥` in accent color when favorited, hollow `♡` when not). Extracted repeated `.find()` call into a single `isFavorite` variable to avoid 4x O(n) scans per render.

4. **P0: Touch actions on VideoCard** — Added long-press (600ms) handler using `onTouchStart`/`onTouchEnd`/`onTouchMove`. Opens context menu at touch position. Prevents the normal `onClick` from firing after a long-press via a ref flag. Touch move cancels the timer to avoid false triggers during scroll.

5. **P1: Toast feedback for queue operations** — Created a minimal global toast system:
   - `toastStore.js` — Single zustand atom (`toast`, `showToast`, `clearToast`)
   - `GlobalToast.jsx` — Renders a fixed-position pill toast with fade-in/out animation, auto-dismisses after 2s
   - Wired into `AppShell.jsx` as a global overlay
   - Added `showToast('Added to queue')` in VideoCard, HeroSection, ContextMenu, and MobileSwipeView
   - Added `showToast('Playing next')` in ContextMenu's "Play Next" action
   - Fixed race condition for rapid successive toasts (reset visibility before re-animating)

### Bonus: CSS Fix
- Fixed `index.css` truncation that caused `vite build` to fail with "Unclosed block" error
- Removed duplicate `::view-transition-*` rules (lines 107-148 already had them; lines 240-261 were duplicates with inconsistent keyframe names)

## Files Changed

| File | Change |
|------|--------|
| `src/components/home/HeroSection.jsx` | Loading spinner, Like button, toast on queue add |
| `src/components/VideoCard.jsx` | Long-press touch handler, toast on queue add |
| `src/components/ContextMenu.jsx` | Toast on queue add / play next |
| `src/components/MobileSwipeView.jsx` | Toast on queue add |
| `src/components/AppShell.jsx` | GlobalToast integration |
| `src/components/GlobalToast.jsx` | **NEW** — Global toast renderer |
| `src/stores/toastStore.js` | **NEW** — Toast state atom |
| `src/index.css` | Fixed truncated keyframe, removed duplicate rules |
| `BACKLOG.md` | Updated task statuses |

## Build Status
- `vite build` passes (1.64s)
- Only warning: hls.js chunk >500KB (pre-existing, tracked in backlog)

## QA Notes
- Preview browser QA blocked: zustand `persist` middleware's `onRehydrateStorage` callback does not fire in the headless preview environment, causing the app to stay on the hydration gate (`_hydrated: false` → blank screen). This is a pre-existing environment limitation, not caused by these changes.
- All changes verified via code review (automated code-reviewer agent)

## Potential Issues to Watch

1. **HeroSection re-renders on any library change** — The `useLibraryStore(s => s.videos)` selector returns the full videos array. Any library mutation (add, favorite, rate) triggers a HeroSection re-render. For a small library this is fine, but could become a performance concern at scale. Consider a targeted selector.

2. **Long-press threshold on VideoCard** — 600ms was chosen as a balance between "feels intentional" and "doesn't feel laggy." The feed's long-press uses 800ms. If users find 600ms too fast (accidental triggers) or too slow, adjust.

3. **Toast z-index** — `z-toast` is used (from Tailwind config). If the toast appears behind modals or the floating queue in edge cases, may need z-index adjustment.

4. **Random year in HeroSection** — Line 281 generates `2020 + Math.floor(Math.random() * 6)` on every render. This will flicker when the component re-renders (e.g., toggling favorite now triggers re-render). Pre-existing issue but more visible now.

## Future Improvements

1. **Settings action feedback** — Extend the new toast system to show success/error toasts for source add, tag preference changes, and cookie import (replace `alert()` calls in SettingsPage).

2. **Undo support in toasts** — The current toast is `pointer-events-none`. Adding an "Undo" button for queue add would require making it interactive and adding a `removeFromQueue` call.

3. **Pre-resolve hero stream URL** — Currently, stream URL is resolved on Play click. Resolving when `heroItem` is set (on carousel card click) would eliminate the 2-3s delay entirely.

4. **Library loading skeleton** — The next P1 item. Show skeleton grid while `loadFromServer()` runs on LibraryPage.

5. **Persist watchedIds from server** — Hydrate the client-side `watchedIds` Set from `/api/feed/watched` on app load so the feed doesn't re-show already-watched videos after page refresh.

6. **Fix zustand hydration in preview environment** — The `onRehydrateStorage` callback not firing blocks all automated QA via the preview tool. Investigate if adding a timeout fallback would help.
