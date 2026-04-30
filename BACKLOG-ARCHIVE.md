# FeedDeck Backlog Archive

> Completed tasks moved from `BACKLOG.md` on 2026-04-25. This file is reference-only.

---

## Completed Tasks

- [x] (2026-04-25) **Discovered: Top 10 row scaled up** — `Top10Row.jsx` switched from fixed `w-[130px]/h-[185px]/text-[80px]` to clamp-based responsive sizing. On 1080p: card 189×270 (was 130×185), rank 156px (was 80px). Aspect ratio 0.703 preserved across all viewport sizes.
- [x] (2026-03-22) 4.1 Deployment, 4.3 Theme, 4.8 Source Management (committed from previous session)
- [x] (2026-03-22) 5.9 Library Page Upgrade: font-display headers, tab bar (All/Favorites/History/Watch Later/Top Rated) with count badges, Continue Watching horizontal row with progress bars, per-tab empty states with CTAs, watchProgress tracking in libraryStore
- [x] (2026-03-22) 5a.1 Playback Audit & Fixes: HLS.js fatal error recovery (reject instead of resolve), HeroSection onEnded queue autoadvance, proxy-stream 15s timeout, stream URL expires_at check, proactive TTL monitor (re-resolves URLs expiring within 15min)
- [x] (2026-03-22) 2.8 Tier 3: Stream URL TTL monitoring with proactive re-resolution, /api/stream-url now checks expires_at
- [x] (2026-03-22) Homepage playback fix: all CDN stream URLs now routed through /api/proxy-stream (HeroSection theatre mode + FeaturedSection previews were using raw CDN URLs that failed due to CORS/Referer requirements)
- [x] (2026-04-25) **Discovered: `/api/homepage/more` dead code removed** — Ripped out the IntersectionObserver, sentinel ref, and `loadingMore` state from `HeroCarousel.jsx`. Endpoint was never implemented; silent-404 fetch is gone.
- [x] (2026-04-25) **Discovered: `PosterInfoPanel.jsx` deleted** — Verified zero imports in `src/` and `server/` before removing.
- [x] (2026-04-25) **Thumbs-rating system polish: icon fix, undo toast, style unification** — (1) Fixed thumbs-down SVG rendering as thumbs-up (`transform="rotate(180 12 12)"` removed — path was already correct). (2) Bottom-pinned undo toast on thumbs-down: `showActionToast` fires with `{ position: 'bottom', timeout: 10000, actions: [{ label: 'Undo' }] }` outside `isToastPaused()` guard; `toastStore.showActionToast` extended with `position` field; `GlobalToast` conditionally uses `bottom-8` / `top-6` and reverses entrance slide direction. (3) `undoRating(videoUrl, surfaceKey)` added to `ratingsStore`: removes from `ratedUrls`, decrements `consecutiveDowns`, trims `recentDownTimestamps`. (4) `POST /api/ratings/undo` backend: transactionally deletes the `video_ratings` row, reverses `taste_profile` deltas (+0.3 global + surface), reverses `creator_boosts` (+0.15), reads state from stored DB row (not body). (5) PosterCard expanded-card buttons: emoji 👎/👍 → Feather SVG (width=16), rated indicator emoji → SVG+text. (6) HeroSection: unwired `&#9825;` heart → two glass-pill SVG thumbs buttons with full `handleHeroRate` logic (surfaceType='home_hero'), matching ThumbsRating visual style. Files: `ThumbsRating.jsx`, `ratingsStore.js`, `toastStore.js`, `GlobalToast.jsx`, `server/routes/ratings.js`, `PosterCard.jsx`, `HeroSection.jsx`.
- [x] (2026-04-24) **PosterCard on-card overlay refactor — removed PosterInfoPanel, all metadata + actions now on card face** — `PosterInfoPanel` was a floating glass container that sat below each GalleryRow and repeated title/meta already on the card. It's been removed from `GalleryRow.jsx` entirely. `PosterCard.jsx` now self-contains two states: **expanded** (`isFocused && variant !== 'landscape'`): deeper gradient + genre/duration pills, title, meta, description snippet, Play / Queue / 👎👍 rating buttons — all on the thumbnail face; **collapsed** (all other cards): title + uploader/views overlay unchanged. Landscape rows (BrowseSection) never expanded — they show ThumbsRating hover overlay instead. Rating buttons (`handleRate`) call `useRatingsStore.recordRating` + `/api/ratings` + `useToastStore.showToast` (same logic as ThumbsRating). `PosterInfoPanel.jsx` file still exists but is now dead code. Plan file: `~/.claude/plans/fix-postercard-overlay-text-wondrous-breeze.md`.
- [x] (2026-04-24) **NSFW homepage row expansion (Phases 1 + 2 of design plan)** — net +14 visible rows on NSFW. Added 3 missing sources (RedTube/YouPorn/xHamster) to `sources` table; added 6 diversifying categories (RedGifs POV/Solo, XVideos New/Hits, SpankBang New, FikFap New); seeded 22 NSFW + 28 social `system_searches` from CONTENT_QUERIES.md (boost feed scoring +10 pts/match); created `persistent_rows` + `persistent_row_items` tables with sticky shelves; built `server/sources/pornhub-personal.js` with 3 fetchers (`fetchLikes`, `fetchSubscriptionsFeed` with Puppeteer fallback, `fetchModel`); auto-derives top-3 PH model rows from `creator_boosts`; Phase 1.5 inserted into `warm-cache.js`; `/api/homepage` prepends pinned rows; `homeStore.js` preserves pinned-row labels and pins them above taste-sort. Live verified: "My PornHub Likes" (9 videos) + "From Your Subscriptions" (4 videos) lead the NSFW homepage. Plan file: `~/.claude/plans/refactored-swimming-cocoa.md`.
- [x] (2026-04-11) Continue Watching row on Homepage — wired existing ContinueWatchingRow into BrowseSection as first row before category rows (Netflix competitive parity)
- [x] (2026-04-11) Top 10 / Trending row — wired Top10Row into BrowseSection, added top10 state to homeStore populated by view count ranking from fetched data
- [x] (2026-04-11) Personalized row titles — added personalizeLabel() to homeStore that generates contextual names (Quick Hits, Fresh Today, Picked for You, Most Viewed, More from X) with dedup logic
- [x] (2026-04-11) Settings input validation — client-side domain format regex, non-empty label/query validation, trimmed values before API submission
- [x] (2026-04-11) Verified: Search UI already implemented (Ctrl+K expanding input in HomeHeader), Hero autoplay already implemented (useHeroAutoplay hook + mute toggle), Settings username field already implemented (Seed Recommendations section)
- [x] (2026-04-10) Fix random year in HeroSection — actually fixed `2020 + Math.random()` on line 328 (prior claim was incomplete). Now uses heroItem.uploadYear || year from addedAt
- [x] (2026-04-10) Pre-resolve hero stream URL — added prewarmStream()/getPrewarmedUrl() to playerStore, called on heroItem change for instant Play even with reduced motion or HLS
- [x] (2026-04-10) Progress indicator bar on VideoCards — 3px accent-colored bar at bottom of thumbnails when watchProgress > 5% (Netflix/HBO competitive parity)
- [x] (2026-04-10) Demo data badge — amber "DEMO" badge on VideoCard when source === 'demo'
- [x] (2026-04-10) Backlog audit — verified 5 items already implemented (library skeleton, carousel arrows, settings toasts, watchedIds, continue watching row)
- [x] (2026-04-08) Fix random year in HeroSection — replaced `2020 + Math.random()` with upload year extraction from heroItem data (design review run 4)
- [x] (2026-04-08) Skeleton-to-content crossfade — added `contentReveal` keyframe animation (200ms ease-out opacity + translateY) to index.css (design review run 4)
- [x] (2026-04-08) Fix truncated index.css — fadeIn keyframe was cut off, completed it + removed duplicate view transition rules
- [x] (2026-04-08) Theatre mode loading spinner — replaced plain text with spinner + backdrop-blur container, added aria role="status"
- [x] (2026-04-08) Hero Like button wired — connected to libraryStore.toggleFavorite with visual state feedback (filled heart + accent color)
- [x] (2026-04-08) VideoCard touch actions — long-press (600ms) opens context menu on touch, prevents click after long-press triggered
- [x] (2026-04-08) Global toast system — toastStore.js + GlobalToast.jsx, wired into AppShell. Queue add/play-next actions show toast across all surfaces (VideoCard, HeroSection, ContextMenu, MobileSwipeView)
- [x] (2026-03-19) Initialize Vite + React project with folder structure
- [x] (2026-03-19) Configure Tailwind CSS with dark theme and custom design tokens
- [x] (2026-03-19) Set up Zustand stores (mode, queue, library)
- [x] (2026-03-19) Create Express server with health check and API routes
- [x] (2026-03-19) Initialize SQLite database with videos, preferences, history tables
- [x] (2026-03-19) Configure Vite proxy for /api requests
- [x] (2026-03-19) Add npm scripts (dev, build, preview)
- [x] (2026-03-19) SFW/NSFW mode store with localStorage persistence
- [x] (2026-03-19) Escape key panic handler (always to SFW)
- [x] (2026-03-19) Visual mode toggle button
- [x] (2026-03-19) Tab title and favicon swap on mode change
- [x] (2026-03-19) SFW data helper with deterministic fake metadata per video ID
- [x] (2026-03-19) Conditional render for all thumbnails, titles, metadata
- [x] (2026-03-19) Desktop thumbnail grid (responsive 2/3/4/5 columns)
- [x] (2026-03-19) Thumbnail card with duration badge
- [x] (2026-03-19) Lazy loading images
- [x] (2026-03-19) Video player with standard controls
- [x] (2026-03-19) Keyboard shortcuts (Space, arrows, F, M, N)
- [x] (2026-03-19) Queue sidebar with add/remove/reorder
- [x] (2026-03-19) Queue persistence in localStorage
- [x] (2026-03-19) Header with search and mode toggle
- [x] (2026-03-19) Add video modal with URL paste
- [x] (2026-03-19) Backend yt-dlp metadata extraction endpoint
- [x] (2026-03-19) Backend stream URL endpoint
- [x] (2026-03-19) yt-dlp validated with Arc browser cookies
- [x] (2026-03-19) Context menu on thumbnails
- [x] (2026-03-20) Homepage mockup built (HTML prototype, reference only)
- [x] (2026-03-20) Homepage design spec with state machine, component tree, store design
- [x] (2026-03-20) Design tokens finalized in tailwind.config.js
- [x] (2026-03-20) All Priority 1 scroll animation tasks (except real-browser testing)
- [x] (2026-03-20) All Priority 2 React components built
- [x] (2026-03-20) Test in real browser and fine-tune phase boundaries/timing — rewrote entire scroll animation: replaced state machine with CSS sticky + 5-phase scroll-position interpolation (modeled on Apple TV). Files: `useFeaturedScroll.js` (rewritten), `FeaturedSection.jsx` (350vh zone, overlay ref, Phase 2 video playback)
- [x] (2026-03-20) Create `playerStore.js` for shared activeVideo state across hero, carousel, queue — already existed from prior work
- [x] (2026-03-20) Theatre mode end-to-end: hero video plays, TheatreControls wired to playerStore, FeaturedSection+CategoryRows hide, exit restores
- [x] (2026-03-20) Hero ↔ Carousel interaction: clicking carousel card updates hero — already worked via setHeroItem
- [x] (2026-03-20) Verify all keyboard shortcuts work on HomePage — added theatre mode keyboard handler (Space, arrows, F, M) to HeroSection
- [x] (2026-03-20) Add `homepage_cache` table — already existed in database.js
- [x] (2026-03-20) Add `categories` table — already existed with seed data in database.js
- [x] (2026-03-20) `GET /api/homepage?mode=social|nsfw` — already implemented in server/index.js
- [x] (2026-03-20) Async yt-dlp refill when category below 8 — already implemented in refillCategory()
- [x] (2026-03-20) `POST /api/homepage/viewed?id=` — already implemented with refill trigger
- [x] (2026-03-20) Homepage → real data bridge: fetchHomepage() in homeStore calls API, maps response, falls back to placeholders when cache empty
- [x] (2026-03-20) Hover preview: useHoverPreview hook with 300ms debounce, singleton abort, muted video overlay on CategoryRow and VideoCard
- [x] (2026-03-20) Stale URL auto-retry: handleStreamError in playerStore, onError handler on theatre video element
- [x] (2026-03-20) yt-dlp error handling: backend parses unavailable/geo-blocked/rate-limited errors, frontend shows via streamError
- [x] (2026-03-20) Loading skeletons: SkeletonHero, SkeletonFeatured, SkeletonCategoryRow, SkeletonVideoGrid in Skeletons.jsx, wired into HomePage
- [x] (2026-03-20) Empty states: CategoryRows shows message when no categories, VideoGrid already had EmptyState, queue already had empty state
- [x] (2026-03-20) Rebrand: localStorage keys pv-* → fd-*, migration in migrations.js (runs before store init), all Zustand store names updated
- [x] (2026-03-20) Rebrand: deleted puppyData.js, replaced all imports with socialData.js across 6+ components
- [x] (2026-03-20) Rebrand: UI text updated — Header, ModeToggle, VideoGrid, QueueSidebar, dist/index.html, modeStore, useAppStore
- [x] (2026-03-20) Rebrand: package.json name → "feeddeck", launch.json configs renamed
- [x] (2026-03-20) Responsive breakpoint audit: verified homepage renders at sm/md/lg/xl breakpoints
- [x] (2026-03-20) Next-up preview overlay: shows upcoming queue item in corner during last 10s of theatre playback
- [x] (2026-03-20) Playback speed selector: SpeedSelector component in TheatreControls, cycles 0.5x–2x
- [x] (2026-03-20) Hero search bar: narrowed to 280px, helper text moved below input
- [x] (2026-03-21) Featured carousel overlay: replaced React inline styles with Tailwind classes so scroll hook's imperative DOM updates survive re-renders; added setOverlayOpacity(1) to applyCarousel()
- [x] (2026-03-21) Featured carousel video preview: stream URL fetch + auto-play on canplay, onPlaying/onPause fade video in/out
- [x] (2026-03-21) Removed React.StrictMode to fix competing scroll handlers from double-mount
- [x] (2026-03-21) M2 Feed Core (2.1): route, page, store, video component, backend tables/endpoints, content pipeline
- [x] (2026-03-21) M2 Gesture System (2.2): touch swipes, double-tap hearts, long-press source sheet, desktop keyboard
- [x] (2026-03-21) M2 Feed UI (2.3): FeedVideo, FeedToast, HeartBurst, SourceControlSheet, FeedBottomNav, QueueSwipeAnimation
- [x] (2026-03-21) M2 Feed Store (2.4): feedStore.js with buffer, index, watched tracking, letterbox preference
- [x] (2026-03-21) M2 Feed Backend (2.5): feed_cache/sources tables, API endpoints, scheduled refill, stream URL caching
- [x] (2026-03-21) M2 Mobile Setup (2.6): Vite + Express bound to 0.0.0.0, network URL printed on startup
- [x] (2026-03-21) M2 Feed Polish (2.7): pull-to-refresh, loading spinner, reduced-motion support, orientation crossfade
- [x] (2026-03-21) Fixed mobile video playback: switched from HLS to direct MP4 format IDs (480p/240p/720p), routed all CDN URLs through /api/proxy-stream to avoid ORB blocking
- [x] (2026-03-21) Unmute persistence working: shared singleton video element preserves gesture activation across swipes
- [x] (2026-03-21) Security: fixed command injection (execFile instead of shell interpolation), SSRF protection (CDN domain whitelist), crash-on-rejection handler
- [x] (2026-03-21) Performance: async yt-dlp in /api/health and /api/metadata (was blocking event loop)
- [x] (2026-03-21) Code cleanup: removed dead stores (useAppStore, useContentStore), dead components (App.jsx, Queue.jsx), unused dep (react-swipeable), fixed stale closure in FeedVideo, debug overlay behind DEV flag, HLS proxy URL rewriting
- [x] (2026-03-21) 2.8 Tier 1: Pre-resolve stream URLs at ingest time — `_preResolveStreamUrls()` in server/index.js resolves URLs during background refill
- [x] (2026-03-21) 2.8 Tier 1: Pre-warm feed on app load — `feedStore.prefetch()` via `requestIdleCallback` on homepage
- [x] (2026-03-21) 2.8 Tier 1: Eager URL warm-up — `_warmStreamUrls()` resolves stream URLs for new buffer videos and updates store
- [x] (2026-03-21) 2.8 Tier 2: Adaptive preload window — `_getPreloadWindow()` uses Network Information API (4g=4, 3g=2, 2g=1, default=2-3)
- [x] (2026-03-21) 2.8 Tier 2: Preconnect hints — N/A, all loads proxied through same-origin
- [x] (2026-03-21) 2.8 Tier 2: Video element pooling — deferred, conflicts with singleton unmute pattern for iOS
- [x] (2026-03-21) 2.9: Long-press timing fix (500ms → 800ms)
- [x] (2026-03-21) 2.9: Refresh feed button (top-right, visible at first video)
- [x] (2026-03-21) 2.9: Fullscreen immersive mode (toggle button, overlay auto-hides after 3s, tap to reveal)
- [x] (2026-03-21) 2.9: Auto-hide nav bar (scroll-direction detection, CSS transform transition)
- [x] (2026-03-21) 2.9: Settings access rethink — three-dot source control button on active video, tap-friendly alternative to long-press
- [x] (2026-03-22) 3.1 Queue Sync: SQLite-backed queue with CRUD API, queueStore migrated from localStorage to server, useQueueSync polling hook (3s), OfflineBanner
- [x] (2026-03-22) 3.2 Tag Preferences: tag_preferences table, settings UI with liked/disliked chips, /api/tags/* endpoints
- [x] (2026-03-22) 3.3 Basic Recommendations: /api/discover endpoint with rule-based scoring, /api/tags/popular
- [x] (2026-03-22) 3.4 Cookie Auth: cookies.txt import via settings page, yt-dlp auto-detects cookies file, status indicator
- [x] (2026-03-22) 3.5 Organization: favorites toggle, watch later, star ratings (1-5), custom playlists (full CRUD), library filter tabs
- [x] (2026-03-22) 3.6 Search: HeroCarousel wired to /api/search/multi (multi-site parallel search)
- [x] (2026-03-22) 3.7 PiP: native browser PiP button + P keyboard shortcut
- [x] (2026-03-22) 3.8 Quality Selector: /api/stream-formats endpoint, quality dropdown in VideoPlayer, localStorage preference
- [x] (2026-03-22) 3.9 Hero Image Fitting: object-contain with blurred background fill + radial gradient vignette
- [x] (2026-03-22) 4.1 Deployment, 4.3 Theme, 4.8 Source Management (committed from previous session)
- [x] (2026-03-22) 5.9 Library Page Upgrade: font-display headers, tab bar (All/Favorites/History/Watch Later/Top Rated) with count badges, Continue Watching horizontal row with progress bars, per-tab empty states with CTAs, watchProgress tracking in libraryStore
- [x] (2026-03-22) 5a.1 Playback Audit & Fixes: HLS.js fatal error recovery (reject instead of resolve), HeroSection onEnded queue autoadvance, proxy-stream 15s timeout, stream URL expires_at check, proactive TTL monitor (re-resolves URLs expiring within 15min)
- [x] (2026-03-22) 2.8 Tier 3: Stream URL TTL monitoring with proactive re-resolution, /api/stream-url now checks expires_at
- [x] (2026-03-22) Homepage playback fix: all CDN stream URLs now routed through /api/proxy-stream (HeroSection theatre mode + FeaturedSection previews were using raw CDN URLs that failed due to CORS/Referer requirements)

---

## Completed Design Review Items

### From Run 3: User Journey Audit (2026-04-07)

- [x] **Recover truncated source files** -- Verified: all 10 key source files intact. index.css was truncated (fadeIn keyframe incomplete) — fixed (2026-04-08).
- [x] **Add loading state to theatre mode** -- Added spinner + backdrop-blur loading indicator with role="status" aria-live="polite" (2026-04-08).
- [x] **Wire Hero Like button** -- Connected to libraryStore.toggleFavorite, shows filled/unfilled heart with accent color (2026-04-08).
- [x] **Add touch actions to VideoCard** -- Long-press (600ms) opens context menu on touch devices, prevents click after long-press (2026-04-08).
- [x] **Toast feedback for queue operations** -- Created toastStore + GlobalToast component. "Added to queue" / "Playing next" toasts on all queue add points (VideoCard, HeroSection, ContextMenu, MobileSwipeView) (2026-04-08).
- [x] **Library loading skeleton** -- SkeletonLibrary component already existed and is used in LibraryPage (verified 2026-04-10).
- [x] **Label or remove demo data** -- Added amber "Demo" badge on VideoCard when source === 'demo' (2026-04-10).
- [x] **Settings action feedback** -- Already using showToast for all actions: source add/pause/delete, tag add/remove, cookie import/delete (verified 2026-04-10).
- [x] **Pre-resolve hero stream URL** -- Added prewarmStream() to playerStore, called on heroItem change. Covers reduced motion and HLS edge cases where autoplay hook doesn't resolve (2026-04-10).
- [x] **Persist watchedIds from server** -- Already implemented in feedStore.initFeed() via /api/feed/watched-ids (verified 2026-04-10).
- [x] **Settings input validation** -- Client-side validation for source domain format (regex), non-empty label/query, trimmed values before API submission (2026-04-11).

### From Run 4: Competitive Comparison (2026-04-08)

- [x] **Continue Watching row on Homepage** -- ContinueWatchingRow component wired into BrowseSection as first row before category rows (2026-04-11).
- [x] **Search UI** -- Already implemented: Ctrl+K expanding search in HomeHeader with results dropdown (verified 2026-04-11).
- [x] **Hero autoplay (muted)** -- Already implemented: useHeroAutoplay hook resolves stream URL, plays muted video with toggle button (verified 2026-04-11).
- [x] **Personalized row titles** -- personalizeLabel() in homeStore generates contextual names based on content: "Quick Hits", "Fresh Today", "Picked for You", "Most Viewed", "More from {uploader}" (2026-04-11).
- [x] **Fix random year in HeroSection** -- Line 328 still had `2020 + Math.random()` despite prior fix claim. Actually fixed: now uses heroItem.uploadYear or extracted year from addedAt (2026-04-10).
- [x] **Skeleton → content crossfade** -- Added contentReveal keyframe (200ms ease-out fade+slide) to index.css. Both Netflix and HBO use subtle opacity transitions (2026-04-08 run 4).
- [x] **Carousel navigation arrows** -- Already implemented in CategoryRow.jsx with left/right chevron buttons, pointer-fine media query, scroll state tracking (verified 2026-04-10).
- [x] **Progress indicator bar on cards** -- Added 3px accent-colored progress bar at bottom of VideoCard thumbnails when watchProgress > 5% (2026-04-10).
- [x] **Top 10 / Trending row** -- Top10Row component wired into BrowseSection after ContinueWatching. homeStore builds top10 from allVideos sorted by view count with rank numbers (2026-04-11).

---

## Completed Milestones (all tasks [x])

### Milestone 1: Desktop MLP

> All 48 tasks completed. Sections: 1.1 Homepage Animation, 1.2 Real Data, 1.3 Backend Endpoints, 1.4 Hover Preview, 1.5 Error Handling, 1.6 Rebrand Cleanup, 1.7 Desktop Polish.

### Milestone 2: Swipe Feed

> All 59 tasks completed. Sections: 2.1 Feed Core, 2.2 Gestures, 2.3 UI Components, 2.4 Store/State, 2.5 Backend, 2.6 Mobile WiFi Testing, 2.7 Feed Polish, 2.8 Playback Optimization, 2.9 Mobile Feed Polish.

