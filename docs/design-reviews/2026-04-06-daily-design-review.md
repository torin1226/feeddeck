# FeedDeck Daily Design Review — April 6, 2026

**Reviewer:** Claude (automated daily audit)
**Session:** First review — establishing baseline
**Method:** Full codebase analysis (38 components, 9 stores, 9 hooks, 4 pages)
**Note:** Could not take live screenshots this session (sandbox↔browser isolation). Analysis is code-based. Future sessions should attempt Torin's Beelink deployment URL if available.

---

## Executive Summary

FeedDeck is ~85% complete and has solid bones: good code-splitting, smart stream URL warming, a shared video singleton for iOS, and a theme system that works. But it's currently a *competent* app, not a *remarkable* one. The gap between "Netflix for one person" and where it actually is comes down to three things: (1) the browsing experience is passive where it should be proactive, (2) the TV/remote experience barely exists, and (3) the visual design is clean-dark-generic instead of having its own identity.

**Overall Design Score: 6.5/10** — Functional, well-structured, but not portfolio-grade yet.

---

## Pillar 1: USEFUL — Is FeedDeck a great personal browsing experience?

### What's Working
- **Stream URL pre-warming** (`_warmStreamUrls`) is genuinely smart — 5 videos ahead with abort on reset
- **Prefetch on idle** — HomePage pre-warms the feed buffer via `requestIdleCallback` so /feed loads instantly
- **Adaptive preload window** — `_getPreloadWindow()` adjusts based on connection quality (4g=4, 3g=2, 2g=1)
- **Singleton video element** — preserves iOS gesture activation across videos. This is a real engineering win.
- **Buffer eviction** at 200 videos prevents memory bloat
- **Cookie auth + recommendation seeding** — the Settings page lets Torin import cookies and seed recs from watch history. This is the right foundation for personalization.

### What Needs Work

**P1: Homepage content feels random, not curated**
- `homeStore.js` still has the puppy placeholder generator as fallback (breeds, adjectives, verbs arrays). When the API returns data, it maps videos into categories based on whatever the backend sends, but there's no intelligence in the client about *ordering* categories by personal relevance. The "Featured" section picks every Nth video — that's a slot machine, not a recommendation.
- **Recommendation:** Add a simple scoring layer in `fetchHomepage` that reorders categories based on tag preferences (already stored in settings). Liked tags boost, disliked tags suppress. Even a naive weighted sort would make the homepage feel curated.

**P2: No "Continue Watching" on Homepage**
- LibraryPage has `continueWatching` (videos with 5-95% progress), but HomePage doesn't surface it. This is the single most useful thing a streaming app does.
- **Recommendation:** Add a "Continue Watching" row at the top of HomePage, above Featured. Pull from libraryStore's progress data. This is a 2-hour task with massive UX payoff.

**P2: Feed has no intelligence about what you've already seen**
- `watchedIds` is a `Set()` that clears at 1000 entries and resets on mode change. There's no persistence. If Torin closes the tab and comes back, the feed re-serves everything.
- **Recommendation:** Persist watched IDs to the backend (the `/api/feed/watched` endpoint already fires, so the server has this data). Use it to deduplicate across sessions.

**P3: No search anywhere**
- There's a `searchQuery` field in feedStore filters, but no search UI on any page. For a personal browsing tool, search is table-stakes.
- **Recommendation:** Add a search bar to HomeHeader that filters across all category rows. Later, wire to backend search.

**P3: HLS hover previews are skipped**
- `useHoverPreview.js` line 44: `if (cdnUrl.includes('.m3u8')) return` — meaning any HLS-only source gets no hover preview. For PornHub content (all HLS), this kills the browse-by-hovering experience.
- **Recommendation:** Use a lightweight HLS preview approach: fetch the manifest, pick the lowest-quality variant, and play just segment 0. Or use the backend to generate a short MP4 preview clip on first request.

---

## Pillar 2: USABLE — Does it work well for Torin specifically?

### What's Working
- **Keyboard navigation** is comprehensive: j/k for feed, arrow keys for ForYou/Remix, Space for play/pause, F for fullscreen, M for mute, T for theatre
- **Mobile preview mode** (Ctrl+M) with iPhone 14 Pro frame — useful for testing
- **Gesture system** — swipe left to queue, right to open source, double-tap to like, long-press for source control
- **Immersive mode** with auto-hide overlay after 3s
- **Theatre mode** with queue auto-advance on video end

### What Needs Work

**P0: No TV/Remote mode**
- The task specifically asks about smart TV with a remote vs. keyboard. There is zero support for this. The ForYou feed uses horizontal scroll-snap (good for a remote's D-pad), but there's no:
  - Focus ring / spatial navigation for D-pad control
  - Large-text "10-foot UI" variant
  - Simple navigation model (up/down between rows, left/right within rows)
  - Voice search or simplified search
- **Recommendation (Long-horizon):** Create a `TVMode` layout variant triggered by URL param (`?tv=1`) or a toggle in settings. Key principles:
  1. Everything navigable with 4 arrows + Enter + Back
  2. Focus rings visible at all times (currently hidden unless `:focus-visible`)
  3. Minimum touch target 48px, prefer 64px
  4. Text minimum 24px for titles, 18px for metadata
  5. Category rows as the primary navigation model (RemixFeed is closest to this already)
  6. Auto-play on focus after 1.5s dwell time
  This is a multi-week effort. Start with a `useTVMode` store and a `TVLayout` wrapper component.

**P1: RemixFeed is the better TV experience but it's buried**
- RemixFeed (hero + category carousels below) is literally the Netflix/HBO layout pattern. It already has arrow key navigation between categories. But it's hidden behind a tab inside /feed, and there's no way to get to it from the homepage without knowing it exists.
- **Recommendation:** Make RemixFeed the default /feed view on TV/large screens. Or better: make it the homepage layout itself when in TV mode.

**P1: No "Back" affordance from Feed to Home**
- Desktop Feed has a small home icon (top-left), but mobile Feed has no way to navigate back except browser back. FeedBottomNav exists but only shows filter/refresh.
- **Recommendation:** Add a home/back button to FeedBottomNav. On desktop, the existing button is fine but could be more discoverable.

**P2: Settings page is functional but hostile**
- SettingsPage is a dense form dump: sources, tags, cookies, adapter health, recommendation seeding — all in one scroll. For Torin as the only user, this works today, but it's toil-heavy. Adding a source requires knowing the domain, mode, label, and query.
- **Recommendation:**
  - Add preset sources ("Add PornHub", "Add YouTube", "Add TikTok") as one-click buttons
  - Move adapter health behind an "Advanced" accordion
  - Group cookie upload and recommendation seeding into an "Import" section

**P3: No offline/error recovery UX**
- `OfflineBanner` exists but is minimal. When the backend is down (common on Beelink), there's no cached fallback content, no retry logic in the UI, and stream errors just show a red text string.
- **Recommendation:** Cache the last successful homepage response in localStorage. Show it as stale content with a "Reconnecting..." badge when the API is down.

---

## Pillar 3: MODERN — Does this look like premium, futuristic streaming?

### What's Working
- **Color system** is solid: dark surface (#111113), raised surfaces, proper gradient layering with 4 opacity stops
- **Typography choices** are good: Inter for body, Space Grotesk for display. This is a tasteful pairing.
- **Ken Burns animation** on hero background adds cinematic feel
- **Scroll-driven featured animation** (5-phase, 550vh scroll zone) is genuinely ambitious — the kind of thing Dribbble designers mock up but never ship
- **Custom scrollbar** styling, focus rings, reduced-motion support — attention to craft details

### What Needs Work

**P1: The color palette is "dark app generic"**
- #111113 background + rose (#f43f5e) accent is the same palette as every dark-mode UI from 2022. It's clean but has zero personality. Compare to HBO Max's deep purples, or Apple TV+'s blue-blacks with warm grays, or Mubi's editorial black-and-white.
- **Recommendation:** Develop a signature color moment. Options:
  1. **Ambient color extraction** — pull the dominant color from the current hero/featured thumbnail and use it as a subtle tint on gradients and borders. This makes the homepage feel alive and unique to the content.
  2. **Replace rose accent with a more unusual choice** — electric violet (#7C3AED), warm amber (#D97706), or a cool teal (#0D9488). Rose is fine but forgettable.
  3. **Add a subtle noise/grain texture** to surfaces — this instantly elevates "flat dark" to "cinematic dark"

**P1: Cards are indistinguishable from any React tutorial**
- CategoryRow cards: 200px wide, rounded-[10px], simple thumbnail + text. The hover state (scale 1.03 + translateY) is the absolute minimum. There's no:
  - Glassmorphism or depth layering
  - Content-aware gradients (pull from thumbnail)
  - Progress indicators for partially-watched content
  - Source badges or quality indicators
  - Animated thumbnails on hover (HLS skip issue compounds this)
- **Recommendation:** Redesign the card component with:
  1. A subtle frosted glass border on hover (`backdrop-filter: blur + border`)
  2. Source logo/icon in corner (YouTube red, PH orange, etc.)
  3. Watch progress bar at bottom (like Netflix's red bar)
  4. Thumbnail fade-in with a slight parallax shift on hover

**P2: Hero section typography needs hierarchy refinement**
- Title uses `clamp(28px, 4vw, 48px)` which is good, but the metadata line (rating, views, uploader, days ago) all use the same weight and color. No visual hierarchy within the metadata.
- The year is randomized: `2020 + Math.floor(Math.random() * 6)` — this is still placeholder logic. It's visible to the user.
- **Recommendation:**
  - Make rating visually distinct (pill badge with star)
  - De-emphasize "days ago" (it's the least useful metadata for personal content)
  - Remove the random year or replace with actual upload date
  - Consider a "match score" (like Netflix's % match) based on tag preferences

**P2: Transitions feel functional, not cinematic**
- Theatre mode transitions are `duration-500 ease-[cubic-bezier(0.25,0.46,0.45,0.94)]`. That's a standard ease-out. For a streaming app aspiring to HBO-tier feel:
- **Recommendation:**
  - Use spring physics (`cubic-bezier(0.34, 1.56, 0.64, 1)` or similar) for element entrances
  - Add stagger to category row card reveals (already started in CategoryRow with `(i % 7) * 0.055s` delay — increase this to 80-100ms for more drama)
  - Hero-to-theatre transition should fade-scale the metadata rather than just opacity toggle
  - Consider adding a very subtle `backdrop-filter: blur()` that intensifies as theatre mode engages

**P3: Empty states are emoji + text**
- "📡 No videos in feed yet" with a paragraph and two buttons. Functional but lifeless.
- "📺 No categories loaded yet" with a generic message.
- **Recommendation:** Design custom empty state illustrations (SVG) that match the brand. Or at minimum, use a gradient + icon treatment that doesn't look like a default React error boundary.

**P3: Loading states lack personality**
- Skeletons use `animate-pulse bg-white/[0.06]` — the bare minimum. Netflix's shimmer has directionality (sweep left to right). The loading spinner is a generic border-spinning circle.
- **Recommendation:**
  - Add a directional shimmer (CSS gradient animation sweeping L→R)
  - Replace the circular spinner with a branded loading indicator (FeedDeck logo pulse, or three-dot wave)

---

## Long-Horizon Roadmap (Months, Not Days)

### Month 1: Foundation
1. **TV Mode MVP** — `useTVMode` store, spatial navigation, RemixFeed as default TV layout
2. **Ambient color extraction** — pull hero thumbnail dominant color, apply to gradients
3. **Continue Watching row on Homepage**
4. **Card redesign** — glass borders, source badges, progress bars

### Month 2: Intelligence
5. **Client-side recommendation sorting** — use tag prefs to reorder homepage categories
6. **Persistent watch history dedup** — server-side watched list in feed endpoint
7. **Search UI** — header search bar with instant filter
8. **HLS hover preview** — lightweight segment-0 approach

### Month 3: Polish
9. **Cinematic transitions** — spring physics, stagger refinements, theatre blur ramp
10. **Custom empty states and loading animations**
11. **Settings UX overhaul** — presets, grouping, progressive disclosure
12. **Noise/grain texture + signature accent color**

### Ongoing
- Each daily review should check: has any new component been added without matching the design language?
- Track design debt as it accumulates (placeholder logic like random years, fallback puppy data)
- Periodically audit bundle size (currently ~950KB total JS, which is reasonable)

---

## Process Notes for Future Reviews

1. **Screenshot capability:** This session couldn't reach the running app from Chrome. For future reviews, check if Torin's Beelink deployment is accessible at a real URL. If so, navigate there directly.
2. **Incremental approach:** This first review covered the entire codebase. Future reviews should focus on what changed since last review (use `git log --since` to scope).
3. **Review notes location:** Saving to `/docs/design-reviews/` in the project. Each review is dated. The reviewer should read the most recent review before starting.
4. **Metrics to track over time:**
   - Bundle size (JS + CSS)
   - Number of placeholder/fallback data generators still active
   - Percentage of components with proper loading/error/empty states
   - TV Mode coverage (what % of flows work with D-pad only)
