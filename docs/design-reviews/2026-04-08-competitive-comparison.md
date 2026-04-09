# FeedDeck Design Review — April 8, 2026

**Reviewer:** Claude (automated daily audit)
**Session:** Run 4 — Competitive Comparison
**Lens:** Pattern-by-pattern comparison against Netflix and HBO Max (live page structure analysis)
**Method:** Live accessibility tree audit of Netflix browse + HBO Max home, deep code read of 10 FeedDeck components, cross-reference against previous 3 reviews
**Screenshot status:** Beelink unreachable (ports 3000, 3001). Netflix page structure captured via read_page. HBO Max page structure captured via read_page. Netflix screenshot timed out (heavy renderer).

---

## Executive Summary

Previous runs audited architecture (6.5), edge cases (6.0), and user journeys (6.2). This run does the competitive comparison that was queued as lens 4 — comparing FeedDeck's specific UI patterns against Netflix and HBO Max, pattern by pattern.

The verdict: FeedDeck has the visual foundation of a premium streaming app, but it's missing the **information architecture and personalization signals** that make Netflix and HBO Max feel intelligent. The app looks like a streaming service; it doesn't yet *behave* like one. The biggest gaps aren't visual — they're structural: no Continue Watching on the homepage, no personalized row titles, no Top 10 social proof, no content detail modal, and no hero autoplay. These are the patterns that make users feel like the app knows them.

Since the last review (April 7), 5 P0/P1 items were fixed: theatre loading spinner, hero Like button, touch long-press, global toast system, and CSS truncation fix. The interaction layer is measurably better. But the competitive gap analysis reveals a new class of issues that previous lenses missed entirely.

**Overall Score: 6.5/10** (up from 6.2 — interaction fixes landed, but competitive gaps now properly accounted for)

---

## Pattern-by-Pattern Competitive Analysis

### Pattern 1: Hero / Billboard

| Feature | Netflix | HBO Max | FeedDeck | Gap |
|---------|---------|---------|----------|-----|
| Auto-play video | Yes (muted, immediate) | Yes (muted, with mute toggle) | No (requires Theatre mode click) | **Critical** |
| Hero carousel / rotation | Yes (cycles featured titles) | Yes (Next/Prev buttons) | Yes (HeroCarousel component) | Parity |
| Maturity rating badge | Yes (TV-MA etc.) | Yes | No | Medium |
| Play + secondary CTA | Play + More Info | Play + Details | Play + Theatre | Parity (different model) |
| Content-aware gradient | Yes (pulled from artwork) | Yes | No (static CSS variable gradient) | **High** |
| Description text | Truncated synopsis | Truncated synopsis | Yes (line-clamp-2) | Parity |
| Year / genre / duration tags | Yes (accurate metadata) | Yes | Random year (`2020 + Math.random()`) | **Bug** |
| Mute toggle on preview | No (auto-mutes) | Yes (explicit button) | No (no hero autoplay) | Medium |

**Verdict:** FeedDeck's hero has strong visual craft (Ken Burns, dual-layer background, vignette) but lacks the most important behavioral pattern: **auto-playing the hero video on page load**. Every major streaming service auto-plays the featured title muted. This is the single biggest "this doesn't feel like Netflix" gap. The random year is a visible placeholder bug.

### Pattern 2: Category Rows / Carousels

| Feature | Netflix | HBO Max | FeedDeck | Gap |
|---------|---------|---------|----------|-----|
| Row count on homepage | 8+ visible | 25+ categories | 3-5 categories | **Low variety** |
| Row titles personalized | "Today's Top Picks for You" | "Because You Watched [title]" | Generic source-based labels | **Critical** |
| Top 10 numbered list | Yes (with large rank numbers) | Yes ("Top 10 Series/Movies Today") | No | **High** |
| Continue Watching row | 2nd row (prominent) | 3rd row | Not on homepage (Library only) | **Critical** |
| Card hover expansion | Expands with synopsis + match% + buttons | Hover shows title overlay | Scale 1.03 + play overlay | Medium |
| Carousel arrows | Left/right chevrons on hover | Left/right chevrons | None (scroll-only) | Medium |
| "See all" / "More titles" | "See more titles" button | "More titles in [row]" button | "See all" toggle (inline expand) | Parity (different) |
| Edge fade mask | Yes | Yes | Yes (CSS mask-image gradient) | Parity |

**Verdict:** FeedDeck's category rows work mechanically but lack **information architecture sophistication**. Netflix has 8+ row types on first load; HBO Max has 25+. FeedDeck shows 3-5 generic categories. The critical missing patterns: Continue Watching on homepage, personalized "Because You Watched X" rows, and Top 10 social proof. These aren't just visual — they're the primary discovery mechanism on both platforms.

### Pattern 3: Navigation

| Feature | Netflix | HBO Max | FeedDeck | Gap |
|---------|---------|---------|----------|-----|
| Primary nav items | Home, Shows, Movies, Games, New & Popular, My List, Browse by Languages | Home, Series, Movies, HBO, Sports | Home, Feed, Library | **Sparse** |
| Search prominence | Icon in header (always visible) | Link in header | Exists in store, no UI | **Critical** |
| Genre filtering | Via nav dropdown | Via "Browse by Genre" row | Feed filter sheet | Medium |
| Profile/settings | Profile avatar dropdown | Profile avatar menu | No profiles (single user) | N/A (by design) |
| Notifications | Bell icon with badge | None visible | None | N/A |

**Verdict:** Navigation is sparse by design (single-user tool), but the complete absence of search UI is a competitive gap. Both Netflix and HBO Max treat search as a primary navigation element. FeedDeck has the store infrastructure (`feedStore.searchQuery`) but zero UI to access it.

### Pattern 4: Content Cards

| Feature | Netflix | HBO Max | FeedDeck | Gap |
|---------|---------|---------|----------|-----|
| Card aspect ratio | 16:9 landscape | Portrait poster (2:3) | 16:9 landscape | Parity with Netflix |
| Hover preview video | Yes (plays clip after ~1s delay) | No (static hover) | Yes (shared video element per row) | **Advantage** |
| Card info on hover | Expands: synopsis, match%, year, rating, buttons | Title overlay | Title + channel + views below card | Different model |
| Context actions | Add to My List, Like, Not for Me, Play | Add to My List | Queue, Rate, Favorite, Source (right-click/long-press) | Parity |
| Progress indicator | Yes (red bar on Continue Watching) | Yes (blue bar) | No (progress in Library only) | **High** |
| Duration badge | Yes | No | Yes | Advantage over HBO |

**Verdict:** FeedDeck's card model is functional. The hover video preview is actually ahead of HBO Max. But the missing **progress indicator bar** on cards is a significant gap — it's how Netflix communicates "you were watching this" at a glance. The card info below the thumbnail (title + channel + views) is more YouTube than Netflix, which may be intentional given the multi-source nature, but feels dense.

### Pattern 5: Content Detail / Info Modal

| Feature | Netflix | HBO Max | FeedDeck | Gap |
|---------|---------|---------|----------|-----|
| Detail modal/page | Yes ("More Info" opens modal) | Yes (click opens detail page) | None (click plays in Theatre) | **High** |
| Episode list | Yes (in modal) | Yes (in detail page) | N/A (video clips, not series) | N/A |
| Related content | "More Like This" tab | "You May Also Like" | None | **High** |
| Content metadata | Cast, genres, maturity, audio options | Cast, year, rating, audio | Genre, duration, random year, views | Medium |

**Verdict:** FeedDeck goes straight from browse to play with no intermediate detail view. This is a conscious design choice (it's a video clip aggregator, not a series platform), but it means there's no "More Like This" discovery path. Users see a thumbnail, click, and either commit to watching or don't. A lightweight detail card or expanded hover state could bridge this gap.

### Pattern 6: Loading & Transition States

| Feature | Netflix | HBO Max | FeedDeck | Gap |
|---------|---------|---------|----------|-----|
| Skeleton loading | Content-shaped placeholders | Shimmer rectangles | Directional shimmer skeletons | Parity |
| Skeleton → content transition | 200ms opacity crossfade | Smooth fade | Instant swap (no crossfade) | **Medium** |
| Hero load sequence | Poster → video auto-starts | Poster → video auto-starts | Poster → Ken Burns (no video until click) | High |
| Route transitions | None visible | Subtle fade | View Transitions API 150ms fade | **Advantage** |
| Error states | Custom branded illustrations | Branded error pages | Emoji placeholders | **Medium** |
| Empty states | Contextual CTAs | Contextual CTAs | Emoji + generic text | **Medium** |

**Verdict:** FeedDeck's route transitions (View Transitions API) are actually more sophisticated than Netflix's. But the skeleton-to-content swap is abrupt — both Netflix and HBO use a subtle opacity crossfade. The emoji empty states feel unfinished compared to branded illustrations on both platforms.

### Pattern 7: Personalization Signals

| Feature | Netflix | HBO Max | FeedDeck | Gap |
|---------|---------|---------|----------|-----|
| "Because You Watched X" | Yes | Yes (explicit row titles) | None | **Critical** |
| Match percentage | Yes (on hover) | No | No | Medium |
| "Top Picks for You" | Yes (row title) | "Recommended For You" | None | **Critical** |
| Watch history influence | Entire homepage personalized | "Because You Watched" rows | watchedIds not persisted on reload | **Critical** |
| New/trending badges | "New Episodes", "Recently Added" | "Just Added", "New Seasons Coming" | None | **High** |

**Verdict:** This is the biggest competitive gap. Neither Netflix nor HBO Max serves generic category names — every row title signals personalization. "Today's Top Picks for You", "Because You Watched House Hunters", "Need a Laugh?" all tell the user the app understands them. FeedDeck's category labels are source-based ("YouTube", "TikTok") or generic ("Discovery", "Mix"). This is the #1 area where the app feels like a tool instead of a streaming experience.

---

## Pillar Grades

### Pillar 1: USEFUL — Grade: B- (unchanged from run 3)

**What improved since last review:**
- Hero Like button now works (P0 fixed)
- Toast feedback on queue operations (P1 fixed)
- Theatre mode has loading spinner (P0 fixed)

**What the competitive lens reveals:**
- No Continue Watching on homepage (Netflix: 2nd row, HBO Max: 3rd row)
- No search UI despite backend support
- No "More Like This" or related content discovery
- No progress indicator on cards
- watchedIds still not persisted from server

The core browsing loop works, but the app doesn't learn from Torin's behavior or surface what's most relevant. Netflix homepage is 100% personalized; FeedDeck's is 100% algorithmic/random.

### Pillar 2: USABLE — Grade: B- (up from C+)

**What improved since last review:**
- Touch long-press opens context menu (P0 fixed)
- Global toast provides action feedback (P1 fixed)
- Theatre loading state prevents black box confusion

**What the competitive lens reveals:**
- No carousel navigation arrows (Netflix/HBO both have left/right chevrons)
- No search (both platforms treat it as primary nav)
- Card click goes straight to Theatre (no intermediate detail/info view)
- Row variety is low (3-5 vs Netflix's 8+ or HBO's 25+)
- Settings still a form dump with no feedback

The P0 fixes from the last session materially improved usability. Touch users can now queue videos, and there's feedback for actions. But the competitive comparison shows the navigation model is thin — two competitors offer 5-8 nav items and prominent search.

### Pillar 3: MODERN — Grade: B+ (up from B)

**What improved since last review:**
- Global toast system with fade animation
- Theatre spinner with backdrop-blur
- CSS truncation fixed (build passes)

**What the competitive lens reveals:**
- Visual craft is genuinely strong (Ken Burns, staggered animations, View Transitions)
- Hover video previews are ahead of HBO Max
- Typography and color token system are mature
- Missing: content-aware color extraction for hero (Netflix does this)
- Missing: skeleton → content crossfade (200ms opacity transition)
- Missing: branded empty states (both platforms use custom illustrations)
- Missing: card hover expansion animation (Netflix's signature pattern)
- Still has random year bug in hero metadata

The visual layer is the app's strongest asset. The design token system, animation curves, and glass-morphism effects are on par with or above HBO Max's visual quality. The gap is in **polish details**: the instant skeleton-to-content swap, the emoji empty states, and the random year all break the premium illusion.

---

## Changes Since Last Review (April 7 → April 8)

5 items from previous P0/P1 lists were addressed:

1. **Theatre mode loading spinner** — Proper centered spinner with backdrop-blur and aria-live
2. **Hero Like button wired** — Toggles favorite with visual state (filled/hollow heart)
3. **Touch long-press on VideoCard** — 600ms trigger, opens context menu
4. **Global toast system** — New toastStore + GlobalToast component, wired into queue operations
5. **CSS truncation fix** — index.css fixed, duplicate view transition rules removed, build passes

These are meaningful improvements. The interaction layer grade went up because of them.

---

## Prioritized Action Items

### P0 (This Sprint — Competitive Parity)

1. **Add Continue Watching row to Homepage** — Pull from library's watch progress data. Position as 1st or 2nd row (after hero). This is the single highest-impact competitive gap. Both Netflix (#2 row) and HBO Max (#3 row) prioritize this.

2. **Add Search UI** — feedStore already has searchQuery infrastructure. Add search icon to Header that expands to input field. Filter feed/homepage results. Both competitors treat search as primary navigation.

3. **Hero autoplay (muted)** — Pre-resolve stream URL when heroItem is set. Auto-play muted video in hero background (replacing Ken Burns). Add mute toggle button. This is how every major streaming service handles the billboard.

### P1 (Next 2 Weeks — Premium Feel)

4. **Personalized row titles** — Replace generic source-based labels with contextual names. Use watch history to generate "Because You Watched [title]" or editorial names like "Quick Watches", "Deep Dives", "Fresh Today". Even random editorial names ("Worth Your Time", "Hidden Gems") would feel more premium than "YouTube" or "Discovery".

5. **Fix random year in HeroSection** — Line 281: `2020 + Math.floor(Math.random() * 6)` generates a new random year on every render. Replace with `heroItem.uploadDate?.split('-')[0]` or remove entirely. This flickers on re-render (more visible now that Like button triggers re-renders).

6. **Add skeleton → content crossfade** — CSS-only change: add `animation: fadeIn 200ms ease-out` to content containers that replace skeletons. Both Netflix and HBO use subtle opacity transitions.

7. **Add carousel navigation arrows** — Left/right chevron buttons on category rows, visible on hover. Both Netflix and HBO use this pattern. Currently FeedDeck is scroll-only with no visual affordance for horizontal navigation.

8. **Progress indicator bar on cards** — Thin colored bar at bottom of thumbnail showing watch progress (like Netflix's red bar). Use library's watch progress data. Bridges the gap between "I've seen this" and "I haven't."

### P2 (Month 2 — Differentiation)

9. **Top 10 / Trending row** — Add a special row with large rank numbers beside cards (Netflix pattern). Use view counts or recent additions to generate ranking. Social proof matters for discovery.

10. **Content-aware hero gradient** — Extract dominant color from hero thumbnail for gradient overlay. Netflix does this to make each billboard feel unique rather than using a static dark gradient.

11. **Lightweight detail card on hover** — Instead of going straight from card to Theatre, show an expanded card with synopsis, source info, and action buttons. Netflix's signature hover expansion pattern. Heavy lift but high-impact.

12. **Editorial row variety** — Increase homepage from 3-5 rows to 8-10 with varied types: "Fresh Today" (last 24h), "Long Watches" (>20min), "Quick Hits" (<5min), "Most Viewed This Week", source-specific highlights. HBO Max has 25+ row types.

### P3 (Month 3 — Polish)

13. **Branded empty state illustrations** — Replace emoji with custom SVG illustrations per state.
14. **Card hover expansion animation** — Scale + translate + info reveal (Netflix pattern).
15. **Maturity/content rating badges** — Source-specific ratings on cards and hero.
16. **"More Like This" related content** — After watching, suggest similar videos based on source, tags, or creator.

---

## Process Notes

### What this lens revealed that previous lenses missed

The first 3 runs focused on what FeedDeck has and whether it works. This run focused on what FeedDeck *doesn't have* compared to what users expect from a streaming interface. The findings are structurally different:

- **Information architecture gaps** (Continue Watching, search, row variety) — these aren't bugs or polish issues, they're missing product features
- **Personalization signals** — the app serves content but doesn't communicate *why* it chose that content
- **Behavioral patterns** (hero autoplay, carousel arrows) — muscle memory from Netflix/HBO that FeedDeck doesn't satisfy

### What worked this run
- Live accessibility tree analysis of Netflix + HBO Max gave precise structural comparison data
- Pattern-by-pattern table format made gaps explicit and measurable
- Combining competitive data with deep code analysis revealed exactly where implementations need to change

### What to try next run
- **Lens 5: Performance & Bundle** — Measure actual load times, identify render bottlenecks, check bundle size regression, audit lazy loading effectiveness
- Try deploying to Beelink via Docker for live screenshots (check if Torin has updated Docker config)
- Track friction-point-per-flow metric from run 3 to measure improvement

### Lens rotation tracker
1. Architecture & Visual (run 1) — DONE
2. Edge Cases & Resilience (run 2) — DONE
3. User Journey (run 3) — DONE
4. Competitive Comparison (run 4, this run) — DONE
5. Performance & Bundle — NEXT
6. Accessibility Deep Dive — queued
