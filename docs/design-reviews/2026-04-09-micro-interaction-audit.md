# FeedDeck Design Review — Run 7: Micro-Interaction Audit
**Date:** 2026-04-09
**Lens:** #7 — Micro-Interaction Audit (hover states, click feedback, transition timing, gesture responses)
**Previous Score:** 6.5/10 (run 6, Accessibility Deep Dive)

---

## Screenshots

Fresh screenshots captured from all 4 pages. No visual changes since run 6 (no commits since `1de640d`).

**Visual observations:**
- **Homepage:** Hero with Ken Burns effect, category rows with section headers, demo data (blank thumbs due to sandbox). Layout is solid, but cards feel static at rest.
- **Feed:** Empty state. "No videos in feed" with zero guidance, zero illustration, zero animation. Dead screen.
- **Library:** Clean grid of 12 sample videos with SAMPLE badges, tab filters. Best-looking page. But cards have no visible interaction affordance at rest.
- **Settings:** STILL CRASHING (P0 bug, 3rd consecutive run). Error boundary with "Try Again" and "Reload Page" buttons.

---

## Pillar Scores (Micro-Interaction Lens)

### 1. USEFUL — 3.5/5

The micro-interaction layer makes the app more useful where it exists. The hover preview system (300ms debounce, singleton pattern, waits for `canplay`) is genuinely thoughtful. The queue pulse animation provides clear feedback when content is added. The Ken Burns hero effect creates visual interest that draws the eye.

**But useful micro-interactions are missing where they'd matter most:**
- No loading shimmer→content crossfade (instant swap)
- No skeleton entrance stagger (all cards appear at once)
- No "added to queue" card animation (only the pill pulses)
- No search result entrance animation
- Empty states have zero motion or guidance
- Settings crash means 25% of the app has NO interactions at all

### 2. USABLE — 3.0/5

This is where the micro-interaction lens reveals the most debt.

**What works:**
- `active:scale-95` on feed/theatre buttons gives satisfying click feedback
- Scroll-snap on mobile swipe view is buttery
- Gesture thresholds are well-tuned (50px swipe, 300ms double-tap, 800ms long-press)
- Hover preview debounce prevents flickering
- Heart burst on double-tap is immediate and joyful

**What doesn't work:**
- **15 buttons have `active:scale-95`; ~60+ clickable elements have NO click feedback at all** (nav links, search, mode toggle, category row items on home, library cards, filter tabs, context menu items). Click feels like clicking into a void.
- **Timing tokens exist but are used 0 times.** Config defines `duration-fast` (150ms), `duration-normal` (250ms), `duration-slow` (500ms) plus `ease-spring`, `ease-cinematic`, `ease-smooth`. The actual codebase uses 7+ different hardcoded values (150ms, 200ms, 220ms, 300ms, 400ms, 500ms, 550ms) with no pattern. This means adjusting the "feel" of the app requires editing 30+ files instead of one config.
- **Skeleton→content is an instant swap.** The skeletons are well-designed (directional shimmer, good proportions), but when real data arrives, content pops in with zero transition. Competing apps use 200-300ms fade-in with staggered card reveals.
- **No exit animations.** Modals, menus, toasts appear with `animate-fade-slide-in` but disappear instantly. This creates an asymmetric interaction rhythm that feels unfinished.
- **Drag and drop uses browser default drag image.** The queue reorder works but looks like 2005.

### 3. MODERN — 3.3/5

The animation quality at the top of the page is legitimately premium. Ken Burns, the featured section's scroll-driven 4-phase animation, the heart burst particles, the queue pulse with spring easing. These are Netflix-tier.

But the quality drops sharply below the hero:
- Category row hover is just `scale(1.03)` + shadow. No depth shift, no content peek, no preview expand.
- Library cards are completely static. No hover state, no selection animation, no entrance stagger.
- The feed page (when empty) is a black void with gray text. No ambient animation, no loading hint, no personality.
- View transitions are opacity-only. Netflix uses directional slides + scale for page transitions.
- No micro-animations on state changes (favoriting, rating, adding to playlist). The toast confirms the action but the card itself doesn't react.

**The gap:** The hero feels like a streaming service. Everything below it feels like a prototype.

---

## Detailed Findings

### CRITICAL

#### C1. Animation Timing Tokens Defined But Never Used — 0/132 instances

**Problem:** `tailwind.config.js` defines 6 timing tokens:
```
duration-fast: 150ms    ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)
duration-normal: 250ms  ease-cinematic: cubic-bezier(0.25, 0.46, 0.45, 0.94)
duration-slow: 500ms    ease-smooth: cubic-bezier(0.4, 0, 0.2, 1)
```
**Zero** of these tokens appear in any source file. Instead, 30+ files use raw values: `duration-200`, `duration-300`, `duration-[220ms]`, `duration-500`, hardcoded CSS `0.25s`, `0.55s`, etc.

**Impact:** The timing "system" is decorative. Changing the app's interaction tempo requires editing every file individually. The config gives the illusion of consistency without delivering it.

**Fix:** Global find-and-replace:
| Raw Value | Token | Occurrences |
|-----------|-------|-------------|
| `duration-150`, `duration-[150ms]` | `duration-fast` | ~8 |
| `duration-200`, `duration-[220ms]`, `duration-250`, `duration-300` | `duration-normal` | ~85 |
| `duration-500`, `duration-[400ms]` | `duration-slow` | ~12 |
| Raw cubic-bezier in CSS | `ease-spring` / `ease-cinematic` | ~6 |

**Effort:** 2-3 hours for full migration. HIGH impact on maintainability.

#### C2. 60+ Clickable Elements Lack Click Feedback

**Problem:** Only ~15 elements use `active:scale-95` (mostly feed/theatre controls). The remaining interactive elements (nav links, search, mode toggle, library cards, filter tabs, context menu items, carousel arrows, hero buttons) have hover states but NO click/tap feedback.

**Impact:** Clicks feel unresponsive. Users can't tell if their tap registered on mobile. This is the single biggest "prototype feel" contributor.

**Fix:** Add `active:scale-95 transition-transform` to all clickable elements. For nav links, use `active:text-accent` instead of scale. For context menu items, use `active:bg-white/15`.

**Effort:** 1.5 hours. Mechanical but tedious.

### HIGH

#### H1. No Exit Animations on Modals/Menus/Toasts

**Problem:** All overlays enter with `animate-fade-slide-in` (fadeSlideIn 0.25s ease-out) but disappear by being unmounted instantly (conditional rendering).

**Impact:** Asymmetric transitions feel janky. The brain notices when something appears smoothly but vanishes abruptly. This is a classic "almost polished" tell.

**Fix:** Add exit animations via one of:
1. React state machine: `isClosing` → apply exit animation → `onAnimationEnd` → unmount
2. CSS `@starting-style` (Chrome 117+) for popover/dialog
3. Framer Motion's `AnimatePresence` (new dependency)

Recommend option 1 (zero dependencies, works everywhere). Add a `useExitAnimation` hook:
```js
function useExitAnimation(isOpen, duration = 250) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isExiting, setIsExiting] = useState(false);
  useEffect(() => {
    if (isOpen) { setShouldRender(true); setIsExiting(false); }
    else if (shouldRender) {
      setIsExiting(true);
      setTimeout(() => setShouldRender(false), duration);
    }
  }, [isOpen]);
  return { shouldRender, isExiting };
}
```

**Effort:** 2 hours (hook + apply to 4 overlays: ContextMenu, FloatingQueue expanded, AddVideoModal, FeedFilterSheet).

#### H2. Library Cards Are Completely Static

**Problem:** Library page cards have zero hover state, zero entrance animation, zero selection feedback. They're static rectangles. This is the page users spend the most time on for content management.

Compare to Netflix: library items have hover-expand with metadata peek, delayed preview, and a scale+shadow transition.

**Fix:**
- Add `hover:scale-[1.03] hover:shadow-card-hover transition-all duration-normal ease-smooth` to library cards
- Add staggered entrance via CSS `animation-delay` on card wrappers: `style={{ animationDelay: \`${i * 50}ms\` }}`
- Add `active:scale-[0.97]` for click feedback

**Effort:** 45 minutes.

#### H3. Skeleton→Content Instant Swap

**Problem:** HomePage.jsx shows `SkeletonHero` / `SkeletonCategoryRow` during loading, then instantly swaps to real content. No fade, no stagger.

**Fix:** Wrap content sections in a `.animate-fade-slide-in` container with `style={{ animationDelay }}` for stagger. Each category row should appear 100ms after the previous.

**Effort:** 30 minutes.

#### H4. Feed Empty State Is a Dead Screen

**Problem:** Feed page with no content shows "No videos in feed" as gray text centered on a black void. No animation, no illustration, no suggestion, no personality.

**Fix:** Add:
- Subtle ambient animation (floating dots, gentle pulse, or particle field)
- Branded illustration or icon
- Action prompt ("Add sources in Settings to start your feed")
- Entrance animation when state is reached

**Effort:** 1 hour for a good empty state.

### MEDIUM

#### M1. View Transitions Are Opacity-Only

**Problem:** Page transitions use `fadeIn`/`fadeOut` at 150ms. This is functional but generic. Netflix uses directional slides (left for forward, right for back) with scale.

**Fix:** Update view transition keyframes to include translateX:
```css
::view-transition-old(root) {
  animation: 200ms ease-out both slideOutLeft;
}
::view-transition-new(root) {
  animation: 200ms ease-out both slideInRight;
}
```

**Effort:** 30 minutes.

#### M2. No Card Reaction on Favorite/Queue/Rate

**Problem:** When a user favorites a video or adds to queue, only the toast and queue pill animate. The card itself shows no reaction. The heart icon doesn't pulse, the card doesn't glow.

**Fix:** Add a 300ms accent glow pulse on the card when favorited: `box-shadow: 0 0 0 2px #f43f5e` that fades out. Add a subtle "absorbed into queue" slide animation when queued.

**Effort:** 1 hour.

#### M3. Carousel Arrow Transitions

**Problem:** Category row carousel arrows appear/disappear based on scroll position, but they snap in/out with no transition.

**Fix:** Add `transition-opacity duration-fast` to arrow containers.

**Effort:** 15 minutes.

#### M4. Duplicate View Transition CSS

**Problem:** `::view-transition-old(root)` and `::view-transition-new(root)` are defined twice in index.css (lines 107-120 and 209-213) with slightly different easings (`ease-out` vs `ease-in`). The second definition wins.

**Fix:** Remove the first definition (lines 107-127). Keep lines 209-213.

**Effort:** 5 minutes.

### LOW

#### L1. No Staggered Card Entrance in Category Rows

**Problem:** All cards in a category row appear simultaneously. No cascading reveal.

**Fix:** Apply `animation-delay: calc(var(--card-index) * 60ms)` to each card.

**Effort:** 20 minutes.

#### L2. Scrollbar Thumb Hover Has No Transition

**Problem:** Custom scrollbar thumb color changes instantly on hover (index.css lines 90-95).

**Fix:** `transition: background 0.2s ease` on scrollbar-thumb. (Note: limited browser support for scrollbar transitions.)

**Effort:** 5 minutes.

#### L3. No Long-Press Visual Feedback on Mobile

**Problem:** Long-press gesture (800ms) triggers the source control sheet, but there's no progressive visual indicator during the hold. User doesn't know something is happening until the sheet appears.

**Fix:** Add a radial progress ring that fills during the 800ms hold. Cancel on release.

**Effort:** 1.5 hours (custom component).

---

## What's Working Well (Protect These)

1. **Ken Burns hero effect** — 12s ease-in-out infinite alternate. Cinematic, smooth, and the timing is perfect. Creates visual life without demanding attention.

2. **Queue pulse animation** — Spring easing (`cubic-bezier(0.34, 1.56, 0.64, 1)`) on the pill gives it an organic bounce. The 0.35s duration hits the sweet spot between noticeable and subtle.

3. **Heart burst particles** — The double-tap heart with radial particles is genuinely delightful. Uses CSS custom properties for angle/distance, making it configurable. This is the kind of micro-interaction that makes users smile.

4. **Hover preview system** — The 300ms debounce, singleton pattern, and `canplay` gate prevent the flickering/stuttering that plagues most preview implementations. Well-engineered.

5. **Gesture tuning** — The 50px swipe threshold, 35-degree angle lock, 300ms double-tap window, and 800ms long-press are all within best-practice ranges. No accidental triggers.

6. **Reduced motion support** — The `prefers-reduced-motion: reduce` block kills ALL animations, transitions, and scroll behavior. This is WCAG AAA territory and should never be touched.

---

## Overall Score: 6.5/10 (stable)

The micro-interaction audit reveals a two-tier quality problem. The top of the page (hero, featured section) has genuinely premium animation quality. Below that, interactions range from adequate (category row hover) to absent (library cards, empty states, exit animations).

The biggest systemic issue isn't any single missing animation but rather the **unused token system**. The timing infrastructure exists in config but zero components reference it, creating a maintenance burden and inconsistency that will compound as the app grows.

| Dimension | Score | Trend | Note |
|-----------|-------|-------|------|
| USEFUL | B- | → | Preview system is great; empty/loading states are not |
| USABLE | C+ | → | Click feedback gap is the biggest usability debt |
| MODERN | B- | ↓ 0.1 | Hero is premium; below-fold feels like a prototype |
| **Overall** | **6.5/10** | → stable | Quality ceiling is high, but floor is too low |

**Verdict: One more pass.** The animation foundation is strong but unevenly applied. A focused sprint on token adoption + click feedback + exit animations would unify the interaction quality across the entire app.

---

## Prioritized Fix List (Sprint-Ready)

| # | Fix | Effort | Impact | Files |
|---|-----|--------|--------|-------|
| 1 | Migrate 132 transition instances to timing tokens | 2.5 hr | Systemic consistency, single-config tuning | 30 files |
| 2 | Add `active:scale-95` / click feedback to 60+ elements | 1.5 hr | Every click feels responsive | 15 files |
| 3 | Add exit animations to modals/menus (useExitAnimation hook) | 2 hr | Symmetric open/close, polished feel | 5 files |
| 4 | Library card hover + entrance stagger | 45 min | Library page goes from dead to alive | LibraryPage.jsx |
| 5 | Skeleton→content fade + stagger | 30 min | Loading feels intentional | HomePage.jsx |
| 6 | Feed empty state with animation + CTA | 1 hr | 25% of app stops being a black void | FeedPage.jsx |
| 7 | Card reaction animations (favorite, queue) | 1 hr | Actions feel connected to content | VideoCard.jsx |
| 8 | View transition directional slides | 30 min | Page nav feels spatial | index.css |
| 9 | Remove duplicate view-transition CSS | 5 min | Clean up tech debt | index.css |
| 10 | Carousel arrow fade transition | 15 min | Arrows stop snapping in/out | CategoryRow.jsx |

**Total estimated effort: ~10 hours** for a transformative interaction quality upgrade.

---

## Notes for Next Run

**Next lens:** #8 — Content Strategy (how content is categorized, surfaced, and rotated; freshness signals)

**What changed since last run:** Nothing. No commits since `1de640d`. Settings crash still present (P0, now unfixed for 3 consecutive runs). All findings from runs 5 and 6 still apply.

**Process note:** This micro-interaction audit combined automated grep counts (132 transition instances, 0 token usages, 15 active: states) with visual screenshot review and code reading. The grep-first approach from run 6 continues to be effective for quantifiable issues. For qualitative assessment (animation quality, timing feel), code reading is still necessary.

**Key insight for future audits:** The token adoption metric (0/132) is the kind of single number that tells a story. Consider tracking a "token adoption %" across runs as a leading indicator of design system health.
