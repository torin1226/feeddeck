# 5c.2 Poster Shelf — Design Spec

**Date:** 2026-04-12
**Status:** Approved for implementation
**Scope:** Unified build of backlog 5c.2 + 5c.2a + 5c.2b
**Replaces:** BrowseSection.jsx + TheatreRow.jsx on HomePage
**Reference mockup:** `old reviews/feeddeck-poster-shelf-v2.html`
**Decision doc:** `_memory/decisions/2026-04-12-5c2-poster-shelf-option-b.md`

---

## Summary

Replace the 3-TheatreRow homepage (BrowseSection → TheatreRow×3) with a single full-viewport poster carousel. Tall cards fill the screen, focus expansion widens the active card, a glass info panel anchors to the focused card, and categories hydrate lazily into an infinite flat pool. The carousel scrolls forever.

## Design Decisions (Pre-Resolved)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Info panel positioning | Card-anchored (not viewport) | Build it right from the start; avoids 5c.2a rework |
| Progress dots | Windowed (~15 visible) from day one | Pool grows infinitely; simple dots won't scale |
| Build strategy | Unified (5c.2 + 5c.2a + 5c.2b) | Avoids building a simpler version then gutting it |
| homeStore changes | Minor — add `orient` to `mapVideo` | PosterShelf reads `categories[]` and builds its own pool |
| Focus state tiers | 4-tier (focused/neighbor/near/far) | Evolved from backlog's 2-tier spec; more refined depth effect |
| Track centering timing | 450ms `--ease-spring` | Updated from backlog's 400ms to match mockup CSS |
| Navigation debounce | Both `goTo` (280ms) and wheel (350ms) | Prevents jank from rapid keyboard mashing and scroll gestures |

---

## Component Architecture

### Files Created

| File | Purpose |
|------|---------|
| `src/components/home/PosterShelf.jsx` | Carousel engine — pool, navigation, hydration, layout |
| `src/components/home/PosterCard.jsx` | Individual card — focus expansion, aspect ratios, badges |
| `src/components/home/PosterInfoPanel.jsx` | Card-anchored glass panel — metadata, actions |
| `src/components/home/PosterPeekRow.jsx` | Next-category preview row |
| `src/components/home/ProgressDots.jsx` | Windowed dot indicator |
| `src/components/home/CategoryDivider.jsx` | Vertical pill between category sections |

### Files Modified

| File | Change |
|------|--------|
| `src/pages/HomePage.jsx` | Replace `BrowseSection` import/render with `PosterShelf`; add `SkeletonPosterShelf` loading state |
| `src/stores/homeStore.js` | Add `orient` field to `mapVideo` and `makeItem` |

### Dead Code (Keep, Don't Delete)

- `BrowseSection.jsx` — may be used on Library page later
- `TheatreRow.jsx` — same; keep for potential reuse

---

## Data Model: Orient Field

The card sizing system requires an `orient` property (`"h"` or `"v"`) on each video item. This does not exist in the current homeStore data.

### Strategy: Derive from thumbnail aspect ratio

Add `orient` to `mapVideo()` in homeStore.js:

```js
// In mapVideo: derive orient from thumbnail dimensions
// API homepage_cache has width/height from yt-dlp metadata
// Heuristic: if height > width, vertical ("v"); else horizontal ("h")
// Default to "h" when no dimension data available
orient: (v.height && v.width && v.height > v.width) ? 'v' : 'h',
```

Also add to `makeItem()` (placeholder generator):
```js
orient: Math.random() > 0.6 ? 'v' : 'h',  // ~40% vertical for visual variety
```

**If the API doesn't provide width/height yet:** Default all to `"h"` and add a TODO to enrich homepage_cache with dimension metadata from yt-dlp's `--print width,height`. This is non-blocking — horizontal-only still looks good; it just doesn't showcase the mixed-aspect feature until dimensions are available.

---

## Data Flow

```
homeStore.categories[]
  → PosterShelf builds pool[] on mount/update
    pool = flat array of { ...videoItem, _cat, _catLabel, orient } + { _divider, _catLabel }
  → First 2 categories hydrated on mount
  → More hydrated when activeIndex is within 3 of pool end
  → After all categories exhausted, wrap catIndex % categories.length

activeIndex (state in PosterShelf)
  → PosterCard receives `dist` prop (|index - activeIndex|)
  → PosterInfoPanel receives focused item + card DOM ref for positioning
  → ProgressDots receives activeIndex + pool real-card indices
  → Shelf label receives current category label
  → PosterPeekRow receives next unloaded category
```

---

## Page Layout & HeroSection Coexistence

The current page renders HeroSection (100vh) then BrowseSection below it. PosterShelf replaces BrowseSection in the same position — **below the hero, scrollable into view**. It does NOT share the hero's viewport.

```
┌──────────────────────────────────┐
│  Header (56px, fixed)            │
├──────────────────────────────────┤
│                                  │
│  HeroSection (100vh)             │  ← User sees this first
│  Ken Burns bg, title, carousel   │
│                                  │
├──────────────────────────────────┤
│                                  │
│  PosterShelf (100vh)             │  ← User scrolls down to this
│  Full-viewport poster carousel   │
│                                  │
└──────────────────────────────────┘
```

- In theatre mode: PosterShelf hides (same `!theatreMode &&` guard currently on BrowseSection)
- HeroSection stays exactly as-is — no changes

---

## PosterShelf.jsx

The main container and carousel engine.

### Layout

- Takes full viewport height: `height: 100vh`
- Flex column: shelf label → track → progress dots → peek row
- `overflow: hidden` on the track wrapper

### Pool Construction

```js
// pool[] is a flat array built from homeStore.categories
// Each entry: { ...videoItem, _cat: categoryIndex, _catLabel: string }
// Dividers: { _divider: true, _catLabel: string, _cat: categoryIndex }
// Dividers inserted between categories (not before first)
```

- `hydrateCategory(catIndex)` appends a category's items + divider to the pool
- First 2 categories hydrated on mount
- When `activeIndex >= pool.length - 3`, hydrate next category
- After all categories exhausted: wrap `catIndex % categories.length`

### Navigation

**General debounce:** `goTo()` has a 280ms debounce flag. All navigation inputs go through `goTo()`, so this prevents visual jank from any rapid input source.

**Keyboard:** ArrowLeft/ArrowRight move to prev/next real card (skip dividers).

**Scroll wheel:** Additional accumulated delta with 65px threshold. One-card-at-a-time with separate 350ms cooldown (stacks with goTo debounce). Decay timer (100ms interval, ×0.85) prevents mid-gesture accumulation. Uses `{ passive: false }` only on the track wrapper element.

**Arrow buttons:** Glass-elevated buttons (`opacity: 0` → `opacity: 1` on track hover). Left at 12px, right at 12px from edges. 52×52px, 16px border-radius.

**Click:** Any card click sets it as focused.

### Track Centering

```js
// Calculate translateX to center the active card
let offset = 0
for (let i = 0; i < activeIndex; i++) {
  offset += getCardWidth(i, activeIndex) + GAP
}
const activeW = getCardWidth(activeIndex, activeIndex)
const viewW = trackWrap.clientWidth
const tx = -(offset - (viewW / 2 - activeW / 2))
// Apply via transform with --ease-spring 450ms
```

### Shelf Label

- Category label displayed above track
- Cross-fades (250ms opacity transition) when focused card's `_catLabel` changes
- Uses `opacity: 0` → swap text → `opacity: 1` pattern

---

## PosterCard.jsx

### Sizing

| Aspect | Default Width | Focused Width | Height |
|--------|--------------|---------------|--------|
| Horizontal (`orient: "h"`) | 420px | 600px | `calc(100vh - 200px)` |
| Vertical (`orient: "v"`) | 320px | 420px | `calc(100vh - 200px)` |

- Uniform 20px gap between all cards
- `object-fit: cover` + `object-position: center` on images
- Width transitions use `--ease-spring` (450ms)

### Focus States (CSS-Driven via `--dist` Variable)

4-tier system (evolved from backlog's 2-tier for more refined depth):

| State | `--dist` | Opacity | Scale | Filter |
|-------|----------|---------|-------|--------|
| Focused | 0 | 1.0 | 1.0 | brightness(1) |
| Neighbor (±1) | 1 | 0.82 | 0.98 | brightness(0.82) |
| Near (±2) | 2 | 0.64 | 0.96 | brightness(0.64) |
| Far (3+) | 3+ | clamp(0.15, ...) | clamp(...) | clamp(0.4, ...) |

Formula: `--dim: calc(1 - var(--dist) * 0.18)`

### Focused Card Extras

- Accent border + glow: `border-color: var(--accent)`, `box-shadow: 0 0 48px rgba(244,63,94,0.18)`
- `z-index: 10`
- Overlay gradient hidden (`opacity: 0`) — info panel takes over metadata display

### Badges

- **Duration:** Top-right, `rgba(0,0,0,0.6)` + `backdrop-filter: blur(8px)`, 8px border-radius
- **Orientation:** Top-left, "Short" label on vertical content only, same glass style

### Entrance Animation (from 5c.2a)

- Cards stagger left-to-right on mount: 40ms offset per card
- Each card: slide 16px from left + fade in
- Glass border shimmer on focused card: single light sweep on mount (1.5s, `--ease-out`)
- **Reduced motion:** Wrap all animations in `@media (prefers-reduced-motion: reduce)` to disable them

---

## PosterInfoPanel.jsx

### Positioning (Card-Anchored via Ref)

The info panel is rendered inside PosterShelf (not inside PosterCard) but positioned to track the focused card:

1. Each PosterCard exposes a ref to its DOM node
2. PosterShelf passes the focused card's ref to PosterInfoPanel
3. PosterInfoPanel uses `getBoundingClientRect()` of the card ref to position itself:
   - Horizontally centered on the card
   - Vertically anchored to the card's bottom edge
4. Position recalculates on: focus change, window resize (via ResizeObserver), and track transform change
5. Uses `position: absolute` within the track wrapper, with `left` and `bottom` computed from the card rect
6. During rapid navigation, panel fades out immediately (no stale positioning)

### Surface

- Glass elevated: `rgba(10,10,12,0.50)` bg, `backdrop-filter: blur(24px)`, glass border + top highlight
- Max width: 420px
- Slides up from `translateY(20px)` → `translateY(-24px)` on focus (350ms, `--ease-out`)
- Fades out when card loses focus

### Content (Staggered Entrance)

| Element | Delay | Content |
|---------|-------|---------|
| Tags | 0ms | Year, genre, duration as pills |
| Title | 60ms | `clamp(20px, 2.2vw, 30px)`, Space Grotesk 700 |
| Meta | 120ms | Rating, views, creator with dot separators |
| Description | 180ms | 2-line clamp, 12px Inter |
| Action buttons | 240ms | Play (accent), Theatre (glass), Queue (+), Favorite (heart) |

### Action Button Behaviors

- **Play:** `homeStore.setHeroItem(item)` + `homeStore.setTheatreMode(true)` — scrolls to hero and plays
- **Theatre:** Same as Play (alias for the primary action)
- **Queue (+):** `queueStore.addToQueue(item)`
- **Favorite (heart):** `POST /api/library/favorite?id=...` (same as existing card interactions)

### Duplicate Metadata Cleanup (from 5c.2a)

- When a card is focused, its `.poster-overlay` fades to `opacity: 0`
- Info panel becomes sole metadata source for the active card
- Unfocused cards retain their overlay title/creator/views

### markViewed Trigger

`markViewed(id)` is called when the user clicks Play/Theatre in the info panel — the moment they commit to watching. Merely focusing a card does not mark it viewed.

---

## PosterPeekRow.jsx

- Below progress dots, `padding: 16px 48px 20px`
- Label: next unloaded category name, 10px uppercase, 45% opacity
- Thumbnail track: flex row, 12px gap, 72px height
- Thumbnail opacity: 30%, hover: 60%
- Horizontal items: 96px wide; vertical items: 48px wide
- Right edge fade mask: `mask-image: linear-gradient(to right, black 65%, transparent 100%)`
- **Click behavior:** Hydrates the next category, jumps to its first card

### Dynamic Updates

- When a new category hydrates, peek row updates to show the *next* unloaded category
- Wraps around when all categories have been shown

---

## ProgressDots.jsx

### Windowed Display

- Show ~15 dots centered on active card (not all cards)
- Window: 7 before active + active + 7 after
- Dots rebuild when new categories are appended
- Only count real cards (skip dividers in pool)

### Styling

- Active dot: 24px wide pill, 3px border-radius, accent color
- Inactive: 6px circle, `rgba(255,255,255, 0.10)`
- Hover: `rgba(255,255,255, 0.25)`
- Transitions: 350ms `--ease-spring`
- Click: navigates to that card

---

## CategoryDivider.jsx

- Injected between category sections in the pool
- `writing-mode: vertical-lr` + `transform: rotate(180deg)`
- 32px wide, full card height
- 10px uppercase text, 30% opacity
- Vertical gradient line: `linear-gradient(to bottom, transparent, var(--glass-border), transparent)`
- Navigation (arrows/keys/wheel) skips over dividers automatically

---

## Loading & Error States

### Loading (before categories arrive)

Add a `SkeletonPosterShelf` to the Skeletons component:
- Full viewport height below hero
- 3-4 shimmer rectangles at card dimensions (420px × card height) with 20px gaps
- Centered horizontally with the middle one slightly larger (simulating focus)
- Uses existing `animate-shimmer` keyframes

### Error (fetchError set, categories empty)

- PosterShelf receives placeholder data from `homeStore.generateData()` — this already fires as a fallback
- PosterShelf renders normally with placeholder content
- The existing fetchError banner at the top of HomePage handles user notification + retry

---

## Performance Optimizations

### DOM Virtualization

Only render cards within ±6 of `activeIndex`. Cards outside this window are replaced with spacer `<div>`s that preserve their width (so `translateX` math stays correct). When `activeIndex` moves, the render window shifts.

- Render window: `activeIndex - 6` to `activeIndex + 6` (13 cards max)
- Why ±6: covers visible viewport at minimum screen width (1280px) plus buffer for smooth spring animation overshoot
- Spacers: `<div style="width: ${cardWidth}px; flex-shrink: 0" />` for each offscreen card
- Pool entries still exist in the array — only DOM rendering is virtualized

### React.memo on PosterCard

```jsx
export default React.memo(PosterCard, (prev, next) => {
  return prev.dist === next.dist && prev.item === next.item
})
```

Most cards don't change on navigation — only when their `dist` changes (entering/leaving the visible range or shifting relative to focus).

### Lazy Image Loading

- `loading="eager"` on active ±3 cards
- `loading="lazy"` on all others
- Prevents burst of image fetches when a new category hydrates 5+ cards at once

### CSS-Driven Animations

All dim/scale/opacity/width transitions are CSS-only via the `--dist` custom property. React only sets `style={{ '--dist': dist }}` — the browser handles interpolation on the GPU. No requestAnimationFrame loops for visual state.

---

## Integration Points

### With HeroSection

- PosterShelf renders below HeroSection (same position as current BrowseSection)
- HeroSection is 100vh; PosterShelf is 100vh — user scrolls from hero into shelf
- Clicking Play/Theatre in info panel: `homeStore.setHeroItem(item)` + `homeStore.setTheatreMode(true)`, then `window.scrollTo({ top: 0, behavior: 'smooth' })` to bring hero into view
- In theatre mode, PosterShelf hides (same `!theatreMode &&` guard currently on BrowseSection)

### With homeStore

- Reads `categories[]` — minor change to add `orient` field
- Calls `markViewed(id)` when Play/Theatre button is clicked in info panel
- Pool construction is local to PosterShelf (not stored in homeStore)

### With Feed Transition

- BrowseSection's "scroll to end → navigate to /feed" behavior is NOT carried over
- Feed is accessible via the header nav link
- If desired later, can add a sentinel at the end of the carousel that triggers feed transition

---

## Accessibility

Deferred to backlog 5.1 (Accessibility P0), but the following are low-cost to include now:

- `role="region"` + `aria-roledescription="carousel"` on PosterShelf
- `aria-label` on arrow buttons ("Previous", "Next")
- Arrow keys already provide keyboard navigation
- `@media (prefers-reduced-motion: reduce)` disables all animations and transitions

Full ARIA (live regions, screen reader announcements, roving tabindex) is tracked in 5.1.

---

## CSS Tokens Used

All from existing `index.css` glass system:

- `--glass-bg`, `--glass-border`, `--glass-highlight` (Layer 1 — cards)
- `--glass-bg-elevated`, `--glass-shadow` (Layer 2 — arrows, info panel)
- `--glass-accent-bg`, `--glass-accent-border`, `--glass-glow-accent` (accent surfaces)
- `--ease-spring`, `--ease-out` (motion)
- `--color-accent`, `--color-accent-hover` (buttons)
- Typography: Space Grotesk for display, Inter for body (already loaded)

No new CSS variables needed.

---

## Keyboard Hint

Fixed element at bottom-right of PosterShelf (from mockup):
- Shows arrow key icons + "browse" label, "Enter" + "play" label
- 10px text, muted color, 35% opacity
- Non-interactive, informational only

---

## What's NOT Included

- **Touch/swipe support** — listed in 5c.2a as a gap, deferred to mobile work
- **Background API refill** — backlog 5c.2b lines 790-793 list specific refresh requirements; deferred to production hardening. The wrap-around hydration (re-showing categories) works for MVP
- **Feed transition from carousel end** — intentionally dropped; feed accessible via nav
- **Light mode adaptation** — that's 5c.10, a separate task
- **Full ARIA/screen reader support** — tracked in backlog 5.1
