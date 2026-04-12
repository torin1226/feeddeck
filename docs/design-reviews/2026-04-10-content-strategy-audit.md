# FeedDeck Design Review — Run 8: Content Strategy & Visual Hierarchy
**Date:** 2026-04-10
**Lens:** #8 — Content Strategy (how content is categorized, surfaced, rotated; freshness signals; visual hierarchy of information)
**Previous Score:** 6.5/10 (run 7, Micro-Interaction Audit)

---

## Screenshots

Fresh screenshots captured from all 4 pages + mobile viewports using mock server approach (patched bundle, picsum thumbnails).

**Visual observations:**
- **Homepage:** Renders successfully. Hero with Ken Burns, Play/Theatre buttons, metadata. Category rows visible but require scrolling past ~900px of Featured Section dead space. Thumbnails load from picsum (placeholder). Cards are small (200px) and visually repetitive.
- **Feed:** CRASHES. "The requested module './useFocusTrap-DgEnTKbm.js' does not provide an export named 'default'". New regression — worked in runs 1-7.
- **Library:** CRASHES. Same useFocusTrap module error. New regression.
- **Settings:** CRASHES. "Cannot read properties of undefined (reading 'map')". 4th consecutive run broken.
- **Mobile Home:** Hero renders, but Featured section scroll zone dominates and category rows are pushed far below fold.
- **Mobile Feed:** Crashes (same error as desktop).

**Critical discovery this run:** The dist/ folder contains chunks from TWO different Vite builds. `index-CVz1Ci54.js` (referenced in HTML) imports chunks that don't exist on disk (e.g., `homeStore-DtNo_k6U.js`). `index-CeqlfrPt.js` references chunks that DO exist. The dist/ was never cleaned between builds. Only Homepage loads because its chunk happens to be compatible with the working bundle. Feed/Library crash because their lazy-loaded chunks import useFocusTrap from the wrong build generation.

---

## Pillar Scores (Content Strategy & Visual Hierarchy Lens)

### 1. USEFUL — 3.5/5

**What works:**
- Continue Watching row exists and appears first in category section (personalizes before editorial)
- Tag-based preference system reorders categories client-side (liked tags: +2, disliked: -5)
- Hero autoplay with Ken Burns creates engaging entry point
- Top 10 row provides social proof ranking
- FeaturedSection has a 4-phase scroll-driven animation for editorial highlights

**What's broken or missing:**
- **Hero has zero curation context.** The user sees "Why Every Designer Should Learn to Code" but has no idea WHY it's featured. Netflix always says "Trending Now", "Top 10 in Your Area", "Because You Watched X". FeedDeck's hero is just... the first item in the carousel.
- **Hero description duplicates the title.** The subtitle/description text often mirrors the title verbatim because the API doesn't return a distinct editorial blurb.
- **Featured labels are random.** `homeStore.js` picks from a pool of labels ("Staff Pick", "New Release", "Editor's Choice") randomly. None of these reflect actual curation — it's decoration, not information.
- **No "why this row" messaging on categories.** "Trending Today" and "Design Deep Dives" are static labels. Netflix says "Because You Watched [X]" or "Popular in [Your Genre]". The tag preference system already reorders rows but never tells the user it did so.
- **markViewed() function exists but is never called.** Impression tracking was implemented and never wired. The backend has no signal about what content was seen but not clicked.
- **No search suggestions or history.** Empty search shows nothing — no recent queries, trending searches, or contextual hints.

### 2. USABLE — 2.5/5

This is the lowest usability score yet, driven by the build regression.

**What works:**
- Error boundary catches all page crashes gracefully (labeled section names, retry buttons)
- Homepage loads and is navigable
- Search keyboard shortcut (Cmd/Ctrl+K) works
- Floating Queue pill persists across pages

**What's catastrophically broken:**
- **3 of 4 pages crash on load.** Feed, Library, and Settings all throw unrecoverable errors. This is a build integrity issue — the dist/ folder has chunks from 2 different Vite builds. A clean `npm run build` would fix it, but the fact that this shipped means there's no build validation step.
- **Featured Section creates ~900px of dead space.** The scroll-driven 4-phase animation requires a 300vh scroll wrapper. Users must scroll past ~900px of near-empty black space to reach category rows. On mobile, this is 2+ full screen heights of nothing. This is actively hostile to content discovery.
- **Settings has been broken for 4 consecutive runs.** The `.map()` on undefined error is a missing null guard on categories/sources arrays. This is a 1-line fix that's been open since Run 5.

### 3. MODERN — 3.5/5

**What works:**
- Hero section is genuinely premium: Ken Burns animation, gradient overlays, depth layering
- Design token system in tailwind.config.js is well-structured (z-index scale, shadow progression, timing functions)
- Typography scale with named utilities (micro through headline) is sophisticated
- ContinueWatchingRow has staggered card animations with progress bars
- Top10Row has Netflix-style overlapping rank numbers

**What doesn't work:**
- **Category rows are visually identical.** Every row uses the same 200px card, same layout, same metadata hierarchy. "Trending" (social proof) looks exactly like "TikTok Picks" (short-form content). Netflix uses 8-10 different row layouts: standard, tall, top-10, large-card, portrait, editorial highlight. FeedDeck has 3 (standard, continue-watching, top-10) and 2 of them look similar.
- **Cards lack source/context badges.** A YouTube video and a TikTok video are visually indistinguishable at card level. No platform icon, no content type indicator (long-form vs short-form vs podcast).
- **No personalized row titles.** "Design Deep Dives" is a static label. "Because You Like Design" would make the same content feel curated. The infrastructure exists (tag preferences), the UI doesn't surface it.
- **Card information hierarchy is flat.** Title, channel, views — all in the same visual weight. Channel name should be distinct from stats. Duration badge exists but is only visible at thumbnail scale.
- **Light mode untested.** Token definitions exist for light theme but no component-level overrides. Shadows would be too subtle, text hierarchy would flatten.

---

## Detailed Findings

### CRITICAL (P0)

#### C1. Build Integrity: dist/ Contains Mixed Build Artifacts
**Severity:** P0 — 3 pages non-functional
**Problem:** The dist/ folder has JavaScript chunks from at least 2 different Vite builds:
- `index-CVz1Ci54.js` (referenced in index.html) imports `homeStore-DtNo_k6U.js` — file doesn't exist
- `index-CeqlfrPt.js` imports `homeStore-7xMxXztC.js` — file exists

Feed and Library crash because their lazy-loaded chunks import from `useFocusTrap-DgEnTKbm.js` which doesn't provide the expected exports for the active bundle.

**Fix:** Clean dist/ (`rm -rf dist/`), run `npm run build`, verify all chunk references resolve. Add a pre-build step: `rimraf dist && vite build`.

**Estimated effort:** 5 minutes for the fix. 15 minutes to add the build clean step to package.json.

#### C2. Settings Page: 4th Consecutive Crash
**Severity:** P0 — persistent
**Problem:** `Cannot read properties of undefined (reading 'map')` — SettingsPage.jsx calls `.map()` on a categories or sources array that's undefined when API returns unexpected shape.
**Fix:** Add null guards: `(categories || []).map(...)` or optional chaining.
**Estimated effort:** 5 minutes.

### HIGH (P1)

#### H1. Featured Section Dead Space (~900px scroll void)
**Problem:** FeaturedSection uses a 300vh scroll wrapper for its 4-phase animation. Between the hero (85vh) and the first category row, users scroll through ~900px of near-empty space. On mobile, this is 2+ screens of nothing.

**What it looks like:** Screenshot shows hero at top, then a massive black void, then "Because You Like Design" appears far below. The featured cards exist but only animate into view during specific scroll phases.

**Proposal:** Replace with a horizontal carousel (like Netflix's "Preview" row) that doesn't require a scroll zone. Or collapse the 300vh to something like 120vh with simpler fade transitions. The animation is impressive in demos but is hostile in daily use.

**Estimated effort:** 2-3 hours for carousel replacement. 30 minutes for scroll zone reduction.

#### H2. No Content Curation Context
**Problem:** Hero, featured items, and category rows provide no explanation for why content appears. Hero is just carousel[0]. Featured labels are randomized from a pool. Category titles are static.

**Proposal (3 changes):**
1. Hero: Add a context badge ("Trending in Design", "New from Channels You Follow")
2. Category rows: Add subtitle text ("Based on what's hot across your sources", "Matched to your saved tags")
3. Featured: Replace random labels with data-driven ones (use actual trending/new/recommended signals)

**Note (user feedback):** Trending row should appear BEFORE Continue Watching. Social proof first, personal history second.

**Estimated effort:** 2-3 hours for all three. The tag preference data already exists in homeStore.js — this is primarily a UI wiring task.

#### H3. Category Row Visual Monotony
**Problem:** All rows use identical 200px cards with the same layout. No differentiation between trending (social proof), editorial (deep dives), short-form (TikTok), or personalized (continue watching) content.

**Proposal:**
- Trending: Larger cards (260px) with view count prominently displayed
- Short-form (TikTok): Portrait aspect ratio cards (160×284) matching the content format
- Personalized rows: Subtitle with "Because You Like [tag]"
- All rows: Add source badge (YouTube/TikTok/Instagram icon) on thumbnail

**Estimated effort:** 4-6 hours for full row type system. 1 hour for source badges alone.

### MEDIUM (P2)

#### M1. Personalized Row Titles Not Surfaced
**Problem:** homeStore.js reorders categories by tag preference scores but keeps the static API label. The user never knows rows are personalized.
**Fix:** When a category's score > threshold, prefix with "Because You Like [top matching tag]".
**Estimated effort:** 30 minutes.

#### M2. Video Card Info Hierarchy Flat
**Problem:** Title, channel, and view count all share the same visual level (text-sm/text-xs in muted gray). Channel name should be visually distinct from stats.
**Fix:** Channel name as `text-body-sm` in secondary color, stats as `text-caption` in muted.
**Estimated effort:** 15 minutes.

#### M3. Search Results Capped at 12, No Pagination
**Problem:** HomeHeader.jsx limits search results to 12 items with no "Load more" or pagination. Users with large libraries can't find older content.
**Fix:** Add intersection observer for infinite scroll or "Show more" button.
**Estimated effort:** 1 hour.

#### M4. Animation Timing Tokens Still Unused (Run 7 Carryover)
**Problem:** tailwind.config.js defines 6 timing tokens (duration-fast/normal/slow, ease-spring/cinematic/smooth). 0 out of 132 transition declarations use them. 30+ files use hardcoded values.
**Fix:** Find-and-replace: `duration-200` → `duration-normal`, `duration-300` → `duration-normal`, etc.
**Estimated effort:** 1-2 hours for full codebase sweep.

---

## Sprint-Ready Fix List (Priority Order)

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 1 | Clean dist/ and rebuild | 5 min | Unblocks 3 pages |
| 2 | Settings null guard | 5 min | Fixes 4-run P0 |
| 3 | Add pre-build clean step | 15 min | Prevents recurrence |
| 4 | Hero context badge + personalization text | 1 hr | Content strategy signal |
| 5 | Category row subtitles | 30 min | Explains curation |
| 6 | Personalized row title prefix | 30 min | Biggest content strategy win |
| 7 | Source badges on cards | 1 hr | Content type differentiation |
| 8 | Featured section scroll zone reduction | 30 min | Eliminates dead space |
| 9 | Card info hierarchy fix | 15 min | Typography cleanup |
| 10 | Timing token adoption | 1-2 hr | Animation consistency |

**Total estimated: ~6-7 hours for transformative improvement.**

---

## Overall Score: 5.5/10 (down from 6.5)

**Score dropped because 3 of 4 pages crash.** The homepage that works is solid (hero + categories + continue watching + top 10), but a single working page out of four cannot score above 6. The content strategy improvements I've proposed would bring this to ~7.5 once the build is fixed.

**Score breakdown:**
- Useful: 7/10 (infrastructure exists, surface doesn't show it)
- Usable: 5/10 (3/4 pages crash, 900px dead space)
- Modern: 6.5/10 (hero is premium, everything below it is generic)

**The gap in one sentence:** FeedDeck has a recommendation engine's plumbing connected to a static catalog's UI.

---

## Before/After Mock

Interactive mockup saved to: `docs/design-reviews/2026-04-10-before-after-mock.html`

**What to look for:**
1. Hero "Trending in Design" badge — adds curation context where there was none
2. Continue Watching promoted directly after hero — eliminates 900px featured dead space
3. "Time remaining" badges on resume cards — answers "can I finish this before bed?"
4. Category subtitles — "Based on what's hot" explains row logic
5. "Because You Like Design" — personalized title using existing tag data
6. Source badges on thumbnails — differentiates YouTube from TikTok content
7. Cards 220px (from 200px) with separated channel name — better breathing room

---

## Next Run Lens

**Run 9 suggestion: Error Resilience & Recovery UX**

Previous audits flagged silent API failures (run 2), no retry mechanisms, and now we have 3 crashing pages. The error boundary works but the recovery UX is bare minimum. A focused audit on error states, loading states, empty states, and recovery flows would fill a gap no previous lens has covered from this angle.

Alternative: **Mobile-First Responsive Audit** — take the mobile screenshots seriously, test touch targets, viewport behavior, and responsive breakpoints. The mobile home screenshot showed the Featured scroll zone dominating the entire mobile experience.
