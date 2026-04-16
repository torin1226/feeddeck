# FeedDeck Design Review — Run 6: Accessibility Deep Dive
**Date:** 2026-04-09
**Lens:** #6 — Accessibility Deep Dive (WCAG 2.1 AA)
**Previous Score:** 6.7/10 (run 5, Performance & Bundle)

---

## Screenshots

Captured fresh screenshots of all 4 pages on this run. Stored in `screenshots/2026-04-09-*.png`.

**Visual observations from screenshots:**
- **Homepage:** Hero renders well, category rows have section headers ("Trending Today", "Design Deep Dives", "Engineering", "TikTok Picks"), but rows appear empty (mock data, no thumbnails due to sandbox image blocking). Layout and typography look solid.
- **Feed:** Empty state "No videos in feed" — plain gray text, no illustration, no suggested action. For You / Remix toggle at top. Home icon top-left.
- **Library:** Best-looking page. Clean grid of 12 sample videos with play icons, durations, titles. Tab filters (All, Favorites, Watch History, Watch Later, Top Rated). Header with search icon and SOCIAL MODE badge.
- **Settings:** STILL CRASHING. Error boundary shows "Something went wrong / The Settings section crashed / Cannot read properties of undefined (reading 'map')". P0 bug from run 5 still unresolved.

---

## Pillar Scores (Accessibility Lens)

### 1. USEFUL — 3.2/5
The app has content hierarchy that works at a glance: hero → category rows → library grid. But from an accessibility standpoint, "useful" means the information architecture is also navigable non-visually. Right now it's not. Screen reader users hit a wall: card grids have role="button" divs with no accessible names, category rows have no landmark structure, and the hero metadata is purely visual. The search icon in the header opens nothing — it's decorative. Settings is completely broken (crash). The feed empty state offers zero guidance.

**Key gap:** A blind user cannot browse, discover, or manage content. The app is useful only for sighted mouse/trackpad users.

### 2. USABLE — 2.8/5
This is where the accessibility lens hurts most.

**What works:**
- Skip-nav link exists and is styled correctly (`:focus` reveals it)
- Global `*:focus-visible` provides a rose-colored outline (good)
- `*:focus:not(:focus-visible)` correctly hides ring for mouse users
- `prefers-reduced-motion: reduce` comprehensively kills all animations
- `aria-live="polite"` on toast components (GlobalToast, FeedToast)
- `aria-live="assertive"` on ModeToggle announcements
- Queue lists use semantic `<ul>/<li>`
- Input fields in SettingsPage and Header use `focus:outline-none focus-visible:outline` pattern correctly

**What doesn't:**
- **47 instances of `text-white/20` through `text-white/50`** across 15 files — all fail WCAG AA contrast
- **3 inputs with `outline-none` and NO focus-visible fallback** (HomeHeader, HeroCarousel, FeedFilterSheet)
- **0 focus traps** in modals (AddVideoModal imports useFocusTrap but ContextMenu and FeedFilterSheet don't)
- **No `role="dialog"` or `aria-modal="true"`** on any modal/overlay
- **Hover-only UI patterns** (queue remove button is `opacity-0 group-hover:opacity-100` with no `focus-within` fallback)
- **No keyboard arrow navigation** in category row carousels or video quality dropdown

### 3. MODERN — 3.5/5
The visual layer remains the strongest part. Dark theme with Inter + Space Grotesk is clean. Design tokens in tailwind.config.js are well-structured (z-index scale, shadows, border-radius, animation timing). The Ken Burns hero effect, heart burst animations, and view transitions give it cinematic personality.

But "modern" in 2026 means accessibility IS the design standard, not an afterthought. Netflix, HBO Max, Disney+ — all pass WCAG AA. The low-contrast text choices (white at 20-50% opacity) are actually a dated pattern from early dark-mode designs circa 2019. Modern dark UIs use distinct gray steps (not opacity) for better contrast control.

---

## Detailed Findings

### CRITICAL (Must Fix)

#### C1. Color Contrast Failures — 47 instances across 15 files
**Problem:** `text-white/50` on `#111113` background = effective color `#888888` on `#111113` = contrast ratio ~4.0:1. Fails WCAG AA 4.5:1 for normal text. `text-white/25` and `text-white/30` are worse (~2.0-2.8:1).

**Worst offenders:**
| File | Count | Sample classes |
|------|-------|---------------|
| FeedFilterSheet.jsx | 14 | `text-white/40`, `text-white/25`, `text-white/30` |
| FloatingQueue.jsx | 9 | `text-white/50`, `text-white/40` |
| ContextMenu.jsx | 6 | `text-white/50` for keyboard shortcuts |
| MobileSwipeView.jsx | 3 | `text-white/30` |
| NextUpDialog.jsx | 3 | `text-white/40` |

**Fix:** Replace opacity-based text colors with solid grays from the token system. Add three Tailwind token colors:
```
text-dim: '#71717a'     // 4.6:1 on #111113 — passes AA for normal text
text-subtle: '#a1a1aa'  // 7.0:1 on #111113 — comfortable read
text-hint: '#52525b'    // 3.1:1 on #111113 — large text only (18px+)
```

#### C2. Settings Page Crash — P0 (Unresolved since run 5)
**Problem:** `Cannot read properties of undefined (reading 'map')` — null guard missing on categories/sources array.
**Impact:** 100% of users cannot access Settings. Error boundary catches it, but "Try Again" loops back to crash.
**Fix:** Add `?? []` fallback: `(settings.categories ?? []).map(...)` and same for sources.

#### C3. Zero Modal Focus Traps
**Problem:** AddVideoModal imports useFocusTrap but ContextMenu and FeedFilterSheet don't. None have `role="dialog"` or `aria-modal="true"`. Tab escapes all modals.
**Impact:** Keyboard/screen reader users can interact with obscured background content while a modal is "open".
**Fix:** Add to all modal containers:
```jsx
<div role="dialog" aria-modal="true" aria-label="[Modal purpose]" ref={focusTrapRef}>
```

### HIGH

#### H1. Inputs Without Focus Indicators — 3 files
**Problem:** `outline-none` with no `focus-visible:outline` fallback in:
- `HomeHeader.jsx:201` — search input
- `HeroCarousel.jsx:116` — search input
- `FeedFilterSheet.jsx:210` — filter search

**Fix:** Add `focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgba(244,63,94,0.5)] focus-visible:outline-offset-2` (pattern already used in SettingsPage and Header).

#### H2. Card Buttons Without Accessible Names — CategoryRow, ContinueWatchingRow, HeroCarousel
**Problem:** `<div role="button" tabIndex={0} onClick={...}>` wraps an image with alt text, but the accessible name doesn't propagate to the button role. Screen reader: "button" (no label).
**Fix:** Add `aria-label={item.title}` to each role="button" div.

#### H3. Hover-Only Interactive Elements
**Problem:** Queue remove buttons use `opacity-0 group-hover:opacity-100` — keyboard users who tab to them see nothing.
**Fix:** Add `group-focus-within:opacity-100` alongside `group-hover:opacity-100`.

#### H4. No Keyboard Navigation in Carousels
**Problem:** Category rows scroll horizontally but arrow keys don't navigate between cards. Only mouse scroll/drag works.
**Fix:** Add `onKeyDown` handler: Left/Right arrows move focus between cards, Home/End jump to first/last.

### MEDIUM

#### M1. No `<main>` Landmark on Feed or Library Pages
**Problem:** AppShell wraps routes in a div, not `<main id="main-content">`. The skip-nav link targets `#main-content` but the element may not exist on all pages.
**Fix:** Wrap route outlet in `<main id="main-content">`.

#### M2. Heading Hierarchy Gaps
**Problem:** Some category row titles use styled divs instead of `<h2>` or `<h3>`. Screen readers can't navigate by heading.
**Fix:** Use semantic headings: `<h2>` for section titles on home page, `<h3>` for sub-sections.

#### M3. Video Player Quality Dropdown Inaccessible
**Problem:** Custom quality selector has no `aria-expanded`, `aria-haspopup`, or arrow key navigation.
**Fix:** Add ARIA attributes and keyboard support per WAI-ARIA Listbox pattern.

#### M4. Feed Empty State Provides No Guidance
**Problem:** "No videos in feed" with no action, no illustration, no accessible description.
**Fix:** Add a branded empty state with a suggestion ("Add videos from the Library" with a link).

### LOW

#### L1. No Caption/Subtitle Support
**Problem:** VideoPlayer uses native `<video controls>` but no `<track>` elements for captions.
**Impact:** Deaf/HoH users can't access content. Not fixable without caption data from backend.

#### L2. Decorative Icons Missing `aria-hidden`
**Problem:** Emoji icons in ContextMenu ("♥", "▶", "+") are read by screen readers.
**Fix:** Add `aria-hidden="true"` to decorative icon spans.

#### L3. Touch Targets Below 44px
**Problem:** Some VideoPlayer buttons and filter toggles are smaller than the 44x44px WCAG minimum.
**Fix:** Add padding to increase touch area while keeping visual size.

---

## What's Working Well (Protect These)

1. **Global focus-visible system** — The `*:focus-visible` rule in index.css with rose-colored ring is excellent. Consistent, visible, and correctly hidden for mouse users. This is better than most production apps.

2. **Reduced motion support** — The `prefers-reduced-motion: reduce` block in index.css is comprehensive (kills all animations, transitions, and scroll behavior). This is WCAG AAA territory.

3. **aria-live toast announcements** — Both GlobalToast and FeedToast use `role="status" aria-live="polite"`, and ModeToggle uses `aria-live="assertive"` with sr-only text. Screen readers will announce state changes.

4. **Design token system** — The z-index scale, shadow hierarchy, and animation timing tokens in tailwind.config.js create structural consistency. When a11y fixes are applied, they can use these tokens.

---

## Overall Score: 6.5/10 (down from 6.7)

The performance wins from run 5 are intact, but the accessibility lens reveals foundational gaps. The score dips slightly because this audit exposes real usability failures for keyboard and screen reader users that were invisible in previous code-only reviews.

| Dimension | Score | Trend |
|-----------|-------|-------|
| USEFUL | B- | → (stable) |
| USABLE | C+ | ↓ (a11y gaps exposed) |
| MODERN | B | → (visual strong, a11y behind) |
| **Overall** | **6.5/10** | ↓ 0.2 from run 5 |

**Verdict: One more pass.** The visual and structural foundation is sound. The accessibility fixes are largely mechanical (add attributes, swap colors, add event handlers) rather than architectural. A focused sprint of 8-10 targeted fixes would bring this to competitive parity with Netflix/HBO Max on accessibility.

---

## Prioritized Fix List (Sprint-Ready)

| # | Fix | Effort | Impact | Files |
|---|-----|--------|--------|-------|
| 1 | Fix Settings crash (null guard) | 15 min | P0 — unblocks entire page | SettingsPage.jsx |
| 2 | Replace text-white/N with solid token colors | 1 hr | 47 contrast violations fixed | 15 files |
| 3 | Add focus-visible to 3 bare outline-none inputs | 15 min | Keyboard users can see focus | HomeHeader, HeroCarousel, FeedFilterSheet |
| 4 | Add role="dialog" + aria-modal + focus traps to modals | 45 min | Screen reader modal semantics | AddVideoModal, ContextMenu, FeedFilterSheet |
| 5 | Add aria-label to role="button" card divs | 30 min | Screen readers announce card names | CategoryRow, ContinueWatchingRow, HeroCarousel |
| 6 | Show hover buttons on focus-within | 10 min | Keyboard users see remove buttons | QueueSidebar, FloatingQueue |
| 7 | Wrap route outlet in `<main id="main-content">` | 10 min | Skip-nav works, landmarks correct | AppShell.jsx |
| 8 | Add semantic headings to category rows | 20 min | Heading navigation for SR users | CategoryRow, HomePage |
| 9 | Add aria-hidden to decorative icons | 15 min | Clean SR announcements | ContextMenu, various |
| 10 | Add keyboard arrow nav to carousels | 1 hr | Full keyboard browsing | CategoryRow |

**Total estimated effort: ~4.5 hours** for a massive accessibility jump.

---

## Before/After: Key Changes Visualized

### Context Menu — Contrast Fix
**BEFORE (current):** Keyboard shortcuts in `text-white/50` on dark background. Ratio ~4.0:1. Fails AA.
```
┌──────────────────────────────┐
│ + Add to Queue      Ctrl+Q   │  ← "Ctrl+Q" in rgba(255,255,255,0.5)
│ ▶ Play Now          Enter    │    barely visible, fails 4.5:1
│ ♥ Like              Ctrl+L   │
│ ⏱ Watch Later       Ctrl+W   │
│ ─────────────────────────── │
│   Share...                   │
│   Remove                     │
└──────────────────────────────┘
```

**AFTER (proposed):** Shortcuts in solid `#a1a1aa` (text-subtle token). Ratio 7.0:1. Passes AA comfortably.
```
┌──────────────────────────────┐
│ + Add to Queue      Ctrl+Q   │  ← "Ctrl+Q" in #a1a1aa
│ ▶ Play Now          Enter    │    clear, readable, 7.0:1
│ ♥ Like              Ctrl+L   │    icons get aria-hidden="true"
│ ⏱ Watch Later       Ctrl+W   │
│ ─────────────────────────── │
│   Share...                   │
│   Remove                     │
└──────────────────────────────┘
```
**What to notice:** The shortcuts become readable without changing the dark aesthetic. The visual hierarchy is preserved (primary text stays white, secondary text uses a distinct gray step).

### Feed Filter Sheet — Focus & Contrast
**BEFORE:** Search input has `outline-none` with no focus-visible. Label text at `text-white/40` (~3.1:1).
```
┌─ Feed Filters ─────────────────────┐
│                                     │
│  🔍 Search sources...               │  ← no focus ring when tabbed to
│                                     │
│  Categories          ← text-white/40, barely readable
│  □ Design  □ Tech  □ Culture        │
│                                     │
└─────────────────────────────────────┘
```

**AFTER:** Rose focus ring on input, labels in `#a1a1aa`.
```
┌─ Feed Filters ─────────────────────┐
│  role="dialog" aria-modal="true"    │
│  🔍 Search sources...  [rose ring]  │  ← visible focus indicator
│                                     │
│  Categories          ← #a1a1aa, 7.0:1
│  □ Design  □ Tech  □ Culture        │
│  Tab traps inside this panel        │
└─────────────────────────────────────┘
```
**What to notice:** The filter sheet becomes a proper dialog with focus management. Labels jump from invisible to comfortably readable.

### Queue Sidebar — Hidden Buttons Fix
**BEFORE:** Remove (✕) button invisible until hover. Keyboard user tabs to it, sees nothing.
```
┌─ Queue (3) ────────────┐
│ ☰ Video Title 1        │  ← ✕ hidden, only shows on hover
│ ☰ Video Title 2        │
│ ☰ Video Title 3        │
└────────────────────────┘
```

**AFTER:** Remove button visible on focus-within.
```
┌─ Queue (3) ────────────┐
│ ☰ Video Title 1    [✕] │  ← visible when item or ✕ has focus
│ ☰ Video Title 2        │
│ ☰ Video Title 3        │
└────────────────────────┘
```
**What to notice:** The ✕ appears whenever keyboard focus is within the queue item row, not just on mouse hover. Visual design stays clean (hidden by default) but keyboard users aren't locked out.

---

## Notes for Next Run

**Next lens:** #7 — Micro-interaction Audit (hover states, click feedback, transition timing, gesture responses)

**What changed since last run:**
- No code changes detected since run 5 (last commit: `1de640d feat: design review fixes`)
- Settings crash still present (P0, unfixed)
- All run 5 findings still apply

**Process optimization note:** This accessibility audit took a different approach from previous runs — instead of reading code and inferring issues, I counted actual WCAG violations with regex patterns across the codebase. The `text-white/N` count (47 instances in 15 files) gives a precise scope for the contrast fix. Recommend this grep-first approach for future audits where quantifiable metrics are possible.

**Rotation note:** After lenses 6-8 complete, consider repeating lens 4 (Competitive Comparison) — Netflix and HBO Max ship accessibility updates quarterly, so the gap analysis will have shifted by then.
