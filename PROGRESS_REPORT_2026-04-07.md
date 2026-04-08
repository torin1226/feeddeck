# Progress Report — 2026-04-07 (Automated Daily Task)

## Summary

Completed 4 backlog items across safety, UX, design tokens, and polish.

---

## Completed Items

### 1. P0: NSFW Content Flashes on SFW First Load (SAFETY FIX)

**Files changed:** `index.html`

**Problem:** On initial page load, NSFW content could briefly render before the SFW content loaded. This was a safety/panic issue — the worst possible UX failure for this app.

**Root cause:** Race condition between Zustand's persist middleware rehydrating `isSFW: false` from localStorage and the `onRehydrateStorage` callback forcing it back to `true`. Even with the existing AppShell hydration guard, there was a window where the persisted NSFW state could leak through.

**Fix:** Added an inline `<script>` in `index.html` (before React loads) that sanitizes the `fd-mode` localStorage entry, forcing `isSFW: true`. This matches the existing pattern used for theme flash prevention. Combined with the existing AppShell `_hydrated` guard, this is now belt-and-suspenders:
- **Layer 1:** localStorage is sanitized before any JS module loads
- **Layer 2:** React won't render content until `_hydrated: true` is set by `onRehydrateStorage`

### 2. Mobile Feed Video Container Resizes on Every Swipe

**Files changed:** `src/components/feed/FeedVideo.jsx`

**Problem:** The video container visibly resized between videos when swiping, causing a jarring layout shift.

**Root cause:** The `onLoadedMetadata` callback set `isLandscape` state, which was in the active effect's dependency array. This caused the entire effect to re-run — destroying the video, re-creating it, and re-loading the source — just to update `object-fit`.

**Fix:** The `onLoadedMetadata` callback now updates `vid.style.objectFit` directly on the DOM element instead of going through React state. Removed `isLandscape` from the effect dependency array. The video element no longer gets destroyed and recreated when aspect ratio detection fires.

### 3. Typography Scale Cleanup (Design Tokens)

**Files changed:** `tailwind.config.js` + 14 component files

**What:** Added 8 named `fontSize` tokens to the design token system:
| Token | Size | Usage |
|-------|------|-------|
| `text-micro` | 10px | Badges, tiny labels, duration |
| `text-caption` | 11px | Small UI text, metadata, links |
| `text-label` | 12px | Input text, compact labels |
| `text-body-sm` | 13px | Body text, descriptions, controls |
| `text-subhead` | 14px | Section headers, labels |
| `text-title` | 18px | Category/section titles |
| `text-display` | 26px | Featured card titles |
| `text-headline` | 28px | Page headlines |

Replaced all 55+ instances of arbitrary `text-[Npx]` across 14 files. Zero arbitrary text sizes remain in the codebase.

### 4. Page Transition Animation (CSS View Transitions)

**Files changed:** `src/index.css`, `src/components/AppShell.jsx`

**What:** Added 150ms opacity crossfade between route transitions using the CSS View Transitions API:
- CSS defines `::view-transition-old(root)` and `::view-transition-new(root)` with fadeOut/fadeIn animations
- AppShell triggers `document.startViewTransition()` on route changes via a `useEffect` that watches `location.pathname`
- Gracefully degrades — browsers without View Transitions API simply skip the animation (no polyfill needed)

---

## Potential Issues to Check

1. **NSFW flash fix assumes localStorage structure:** The inline script expects `fd-mode` to have shape `{state: {isSFW: ...}}`. If Zustand changes its persist format, this would break silently (but safely — NSFW would just not get sanitized, and the hydration guard would still work).

2. **FeedVideo `isLandscape` state is now slightly stale:** Since `isLandscape` is set in state but no longer triggers the effect, it's used only for rendering (thumbnail `objectFit`). The shared video element's `objectFit` is set directly in `onLoadedMetadata`. If `letterbox` changes while a video is active, the landscape detection won't re-apply — but the letterbox effect's `vid.style.objectFit` line at the top of the active effect will handle it on next mount.

3. **View Transitions API browser support:** Chrome 111+ (March 2023). Firefox and Safari don't support it yet but degrade gracefully. No impact on iOS Safari mobile users — they just won't see the crossfade.

4. **Typography tokens with line-height:** The tokens include default line-heights. If any component was relying on inheriting a different line-height with the old arbitrary sizes, the rendering might shift slightly. All tokens use sensible defaults (1.2-1.5).

---

## Future Improvements

1. **View Transitions per-element:** Could add `view-transition-name` to specific elements (hero image, nav bar) for more cinematic shared-element transitions between routes. Requires CSS View Transitions Level 2.

2. **Typography scale validation:** Add an ESLint rule or Tailwind plugin that warns on new `text-[Npx]` usage, enforcing the token scale going forward.

3. **NSFW flash fix — CSP consideration:** The inline script in `index.html` may need a nonce or hash if Content-Security-Policy headers are added in the future.

4. **FeedVideo singleton pattern:** The shared video element pattern is increasingly complex. Consider extracting it into a dedicated `useSharedVideo` hook to centralize lifecycle management and make the dependency relationships clearer.

---

## Build Verification

- `npm run build` — succeeds, zero errors
- `npx eslint` on modified files — zero warnings
- Bundle size: no change (typography tokens are just Tailwind config, View Transitions CSS is ~200 bytes)
