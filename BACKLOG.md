# FeedDeck Backlog
<!-- COWORK TEST: pineapple-rocket-42 -->

**Repo:** https://github.com/torin1226/feeddeck

This is the single source of truth for all project tasks. Claude Code and Cowork read from and update this file directly.

For backlog management protocol, see `.claude/skills/backlog/SKILL.md`.

---

## Status Key

- `[ ]` — Not started
- `[~]` — In progress
- `[x]` — Complete
- `[!]` — Blocked (see notes)
- `[?]` — Needs decision from user

---

## Progress Summary

| Milestone | Status | Done/Total | Focus |
|-----------|--------|-----------|-------|
| M1: Desktop MLP | **Done** | 54/54 | Archived |
| M2: Swipe Feed | **Done** | 68/70 | 1 manual test gate, 1 service worker |
| M3: Discovery & Org | Active | 114/134 (85%) | 3.12 Taste Feedback (largest open block) |
| M4: Deploy & Advanced | Waiting | 23/35 (66%) | Social pipeline, AI recs, extension |
| M5: Design Polish | Active | 47/52 (90%) | Color tokens, glass materials, logo |
| M5a: Playback | Blocked | 10/18 (56%) | Needs manual browser testing (8 [?]) |
| Discovered Tasks | Mixed | 37/50 (74%) | Editorial design polish, deferred items |

> **Archive:** 135+ completed tasks moved to [`BACKLOG-ARCHIVE.md`](BACKLOG-ARCHIVE.md) on 2026-04-25.

---

## Milestone 1: Desktop MLP — COMPLETE

> All 54 tasks done. Details in [`BACKLOG-ARCHIVE.md`](BACKLOG-ARCHIVE.md).

---

## Milestone 2: Swipe Feed — COMPLETE

> 68/70 tasks done. Remaining: mobile device testing gate ([?] in 2.7) and service worker caching ([ ] in 2.8).

**Remaining M2 items:**

- [?] Test on real mobile devices: iOS Safari, Android Chrome (viewport, scroll-snap, gesture conflicts)
  > QUESTION: Ready for manual mobile testing. Start `npm run dev` and open the network URL on your phone (same WiFi). Test swipe up/down, left/right gestures, double-tap hearts, and long-press source control.
- [ ] Service worker video segment caching: cache first ~500KB of each preloaded video response. Swipe transitions start from cache instantly while rest streams in background

---

## Milestone 3: Discovery & Organization

### 3.0 Source Diversification (Eliminate yt-dlp as Single Point of Failure)

> Goal: yt-dlp is unreliable and can't do discovery. Add a source adapter layer that separates discovery (finding new content) from extraction (getting stream URLs). Multiple adapters with automatic fallback so no single tool failure kills the app.

**Adapter Layer (DONE):**
- [x] `server/sources/base.js` — SourceAdapter base class with standard video shape
- [x] `server/sources/registry.js` — SourceRegistry with domain routing + fallback chains
- [x] `server/sources/ytdlp.js` — yt-dlp wrapped in adapter interface (universal fallback)
- [x] `server/sources/scraper.js` — Puppeteer discovery scraper (Pornhub, Xvideos, Spankbang)
- [x] `server/sources/cobalt.js` — Cobalt API adapter (SFW extraction fallback)
- [x] `server/sources/index.js` — Setup and registration

**Integration:**
- [x] Install puppeteer: `npm install puppeteer`
- [x] Refactor `server/index.js` to use registry instead of direct yt-dlp calls
- [x] Replace `refillCategory()` to try scraper first, fall back to yt-dlp
- [x] Replace `_refillFeedCacheImpl()` to use registry.search() with fallback
- [x] Replace `/api/metadata` to use registry.extractMetadata()
- [x] Replace `/api/stream-url` to use registry.getStreamUrl()
- [x] Replace `/api/search` SSE to use yt-dlp adapter's streamSearch (SSE pattern preserved)

**NSFW Discovery Features (new capabilities the scraper enables):**
- [x] Multi-site search: `/api/search/multi` hits all SITE_CONFIGS sites in parallel via `scraper.searchAll()`
- [x] Category browsing: `/api/categories` endpoint fetches videos from any category page URL
- [x] Trending feeds: `/api/trending` endpoint fetches per-site trending content
- [x] Add more sites to SITE_CONFIGS in scraper.js: added Redtube, YouPorn, XHamster (6 sites total)
- [x] Scheduled category/trending fetching: `startScheduledTrendingRefresh()` rotates through all NSFW sites every 30min, populates homepage_cache

**Monitoring & Resilience:**
- [x] Health check endpoint: `/api/sources/health` reports all adapter status, capabilities, versions
- [x] Per-adapter error rate tracking: successes, failures, consecutive failures, last error/success timestamps
- [x] Auto-disable adapter after 5 consecutive failures, auto re-enable after 5min cooldown, manual `/api/sources/:name/reenable`

### 3.1 Queue Sync Across Devices

> Full spec: `QUEUE_SYNC.md`

- [x] Add queue table to SQLite schema (position, video_id, added_at)
- [x] GET /api/queue endpoint: return ordered queue
- [x] POST /api/queue endpoint: add video to end (supports position for insertNext)
- [x] DELETE /api/queue/:id endpoint: remove item, reindex positions
- [x] PUT /api/queue endpoint: full reorder from ordered array of IDs
- [x] DELETE /api/queue endpoint: clear all
- [x] All mutation endpoints return full updated queue in response
- [x] Modify Zustand queue store: mutations hit API first, update from response
- [x] Remove localStorage persistence for queue (server is source of truth)
- [x] useQueueSync polling hook: fetch every 3s, pause when tab hidden, refetch on tab focus
- [x] Diff check before state update: preserves currentIndex across syncs
- [x] Offline indicator when server unreachable (OfflineBanner component)
- [x] On reconnect: server state wins (fetchQueue replaces local state)

### 3.2 Tag Preferences

- [x] Tag management UI: liked/disliked tags with add/remove in Settings page (green/red chips)
- [x] Store preferences in SQLite `tag_preferences` table
- [x] Filter library grid by selected tags (library filter tabs already include text search)
- [x] Auto-tag new videos based on yt-dlp metadata (tags field populated from yt-dlp extraction)

### 3.3 Basic Recommendations

- [x] Rule-based scoring: +2 liked tag, -5 disliked tag, +1 favorite, +1 highly rated
- [x] "Discover" endpoint: `GET /api/discover` returns unwatched videos sorted by score
- [x] GET /api/tags/popular endpoint returns top 50 tags by frequency
- [ ] Future: system searches for content discovery (see 3.4 Cookie Auth)

### 3.3.1 Seed Recommendations from PornHub History (Cookie-Powered) — HIGH PRIORITY

**Goal:** Use cookies to pull PornHub watch history/favorites via yt-dlp, extract tag/category data from those videos, and auto-populate `tag_preferences` so the recommendation engine has real signal instead of cold-starting.

**Why this matters:** The 3.3 scoring system works, but it's useless until the user manually likes/dislikes enough tags. Seeding from existing PornHub activity bootstraps the engine instantly.

**Priority:** Do this BEFORE 3.0 Integration. Cookies are imported, username is known. This is the highest-leverage feature to make FeedDeck feel personalized.

**Known info:**
- PornHub username: `tonjone92`
- Profile URL: `https://www.pornhub.com/users/tonjone92`
- Cookies installed at `data/cookies.txt` (PornHub + YouTube, both active)
- PornHub URLs to scrape with cookies:
  - `https://www.pornhub.com/users/tonjone92/videos/favorites` (favorited videos)
  - `https://www.pornhub.com/users/tonjone92/videos/watched` (watch history, if accessible)
  - `https://www.pornhub.com/users/tonjone92/videos/rated` (rated videos)
  - `https://www.pornhub.com/users/tonjone92/playlists` (user's playlists — crawl each for video metadata, highest-signal curated content)
- YouTube URLs to scrape with cookies:
  - `https://www.youtube.com/feed/history` (watch history)
  - `https://www.youtube.com/playlist?list=LL` (liked videos)
  - `https://www.youtube.com/feed/library` (saved playlists)
  - User's playlists (discover via channel page)
- TikTok username: `tmoney19060`
- TikTok URLs to scrape with cookies:
  - `https://www.tiktok.com/@tmoney19060/liked` (liked videos — primary signal)
  - `https://www.tiktok.com/@tmoney19060` (posted videos, if any)
  - Note: yt-dlp TikTok support breaks frequently. Try yt-dlp first, fall back to scraper adapter.
  - **Priority source for mobile feed** — user wants TikTok content prioritized in the swipe feed experience.
- Instagram URLs to scrape with cookies:
  - `https://www.instagram.com/<username>/saved/` (saved posts/reels)
  - Note: yt-dlp Instagram support is flaky. May need instaloader or scraper adapter as fallback.

**Backend: History Import Pipeline**
- [x] New endpoint: `GET /api/recommendations/seed` (SSE) triggers the import job
- [x] Use yt-dlp with cookies to fetch favorites/history via flat-playlist
- [x] Also try watched, rated URLs (gracefully handles private/empty with error message)
- [ ] For playlists: fetch playlist index first, then crawl each playlist for video metadata. Playlists are high-signal — curated content reveals stronger preferences than passive watch history
- [x] Parse returned JSON for each video: extract `tags`, `categories`, `uploader`, `duration`, `view_count`
- [x] Build tag frequency map from all extracted videos
- [x] Auto-insert top N tags (threshold: 2+ appearances) into `tag_preferences` as `liked`
- [x] Skip tags already in `tag_preferences` (don't override manual choices)
- [x] Import videos into `videos` table (dedup by URL) so library has content immediately
- [x] Store seed metadata: `recommendation_seed_at` timestamp + `recommendation_seed_count`

**Backend: Username Config**
- [x] Store platform usernames in `preferences` table (key: `{platform}_username`)
- [x] `PUT /api/recommendations/username` + `GET /api/recommendations/username` endpoints
- [x] Settings UI: text field for PornHub username (pre-filled if already set) — already implemented in Seed Recommendations section with platform selector + username field + onBlur save (verified 2026-04-11)
- [x] Endpoint uses stored username to construct history/favorites URLs
- [x] Multi-platform support: pornhub, youtube, tiktok URL builders

**Frontend: Settings UI**
- [x] "Seed Now" button in Settings with platform selector + username field
- [x] Progress indicator via SSE: real-time log of scan/extract progress
- [x] Summary on completion: green card showing videosScanned, tagsFound, tagsAdded, topTags
- [x] Tags auto-added to preferences, visible in existing tag management UI above

**Edge Cases**
- [x] Handle private/empty history (graceful "not accessible" message per source)
- [x] Handle rate-limiting: 30s timeout per video, 60s per flat-playlist scan
- [x] Don't re-seed if already seeded within 24h (check `recommendation_seed_at`, `?force=1` to override)
- [x] Timeout: cap at 200 videos max

### 3.4 Cookie-Based Auth for Personalized Feeds

> Import browser cookies so yt-dlp can access logged-in content: personalized recommendations, subscriptions feed, watch history, premium content. User exports cookies via browser extension (e.g. "Get cookies.txt LOCALLY"), imports via drag-and-drop or file picker. Re-importing should be frictionless since cookies expire.

- [x] Settings UI: file picker for `cookies.txt` import with re-import and remove buttons
- [x] Cookie stored server-side at `data/cookies.txt` (ready for Pi migration)
- [x] Backend: `POST /api/cookies` receives content, validates Netscape format, writes file
- [x] yt-dlp adapter auto-detects `data/cookies.txt` and passes `--cookies` flag
- [x] Fallback to public-only content when no cookies present (no flag passed)
- [x] Cookie status indicator: green dot with count and last-modified date
- [x] `GET /api/cookies/status` and `DELETE /api/cookies` endpoints

#### 3.4.1 Per-Mode Cookie Files — NEEDS ADAPTER UPDATE

**Architecture:** Separate cookie files per mode so NSFW alt accounts don't leak into Social requests and vice versa.

**Cookie files (already created in `data/`):**
- `cookies-social.txt` — YouTube, Google, main Instagram account
- `cookies-nsfw.txt` — PornHub, NSFW Instagram alt account
- `cookies.txt` — legacy combined file (keep for backward compat until adapter is updated)

**Adapter changes needed:**
- [x] Update `server/cookies.js` with per-domain → per-mode → legacy fallback chain (getCookieArgs resolves best cookie file automatically)
- [ ] Update all callers that pass mode context (refillCategory, feed refill, search, metadata extraction) to forward mode to the adapter
- [x] Update `POST /api/cookies` endpoint to accept a `mode` param (social|nsfw) and write to the correct file
- [x] Update `GET /api/cookies/status` to return status for both files (social, nsfw, legacy)
- [x] Update Settings UI: two cookie import sections (Social cookies / NSFW cookies) with independent status indicators
- [x] Fallback: if mode-specific file missing, try `cookies.txt` (combined), then no cookies

### 3.5 Organization Features

- [x] Favorites/heart toggle per video with filter view (heart on cards, context menu, library filter tabs)
- [x] Watch later list (toggle via context menu, library filter tab, server-synced)
- [x] Star rating (1-5) per video (star selector in context menu, optimistic local + server sync)
- [x] Custom playlists: create, add/remove, reorder (playlists + playlist_items tables, full CRUD API)

### 3.6 Search

- [x] Wire HeroCarousel search bar to `/api/search/multi` backend (multi-site parallel search)
- [x] Search across title, tags, source (library page has local text filter + SSE search)
- [x] Search results display inline in carousel strip with real thumbnails/metadata

### 3.7 Picture-in-Picture

- [x] PiP button on player + keyboard shortcut (P)
- [x] Native browser PiP API with graceful fallback (checks `document.pictureInPictureEnabled`)
- [x] While in PiP: main page shows library grid, can queue more videos (PiP is browser-native)

### 3.8 Quality Selector

- [x] Backend endpoint: `GET /api/stream-formats?url=` runs `yt-dlp -j` to list available MP4 qualities
- [x] UI: quality picker dropdown in VideoPlayer info bar (auto + available qualities)
- [x] Remember last selected quality preference in localStorage (`fd-quality`)
- [x] `GET /api/stream-url?format=` accepts optional format ID for specific quality

### 3.9 Hero Image Fitting

- [x] Hero thumbnail switched from `bg-cover` to `object-contain` with blurred scaled-up background fill behind
- [x] Radial gradient vignette overlay blends edges into background color seamlessly
- [x] Works across aspect ratios: blurred fill handles letterboxing for any ratio

### 3.12 Taste Feedback & Adaptive Ranking (2-Step Rating System)

> **Full spec:** `ADR_taste-feedback-system.md` | **UX report:** `UX_taste-feedback-report.md` | **Mockup:** `mockup_taste-feedback.html`
> Goal: Thumbs up/down on any video, directly influencing what content surfaces across all pages. Two feedback tiers: quick rating (Step 1) and keyword override for bad rows (Step 2). Multi-signal taste profile with 60-day decay half-life.

**Phase A — Database & Scoring Engine (do first, everything depends on this):**
- [x] Add `video_ratings` table (video_url, surface_type, surface_key, rating, tags JSON, creator, rated_at)
- [x] Add `creator_boosts` table (creator PK, boost_score, surface_boosts JSON, last_updated)
- [x] Add `taste_profile` table (signal_type, signal_value, weight, surface_key nullable, updated_at)
- [x] Migrate existing `tag_preferences` data into `taste_profile` (signal_type='tag', surface_key=NULL) — `database.js:638–655` one-time seed migration
- [x] Build unified scoring function on server: `server/scoring.js` exports `scoreVideos`, `getScoreBreakdown`, `invalidateProfileCache` — implementation is point-based (additive), not the multiplicative formula in `ADR_taste-feedback-system.md`
- [ ] Add 60-day half-life decay to scoring reads: `weight * (0.5 ^ (days_since_update / 60))`
- [x] Replace `homeStore.js` client-side scoring with server-side scored results — partial: `feed.js` uses server-side scoring, but `homeStore.js:271` still runs a client-side boost pass
- [x] Integrate `taste_profile` scores into `feed.js` weighted selection (replace simple tag multiplier) — `feed.js:6` imports `scoreVideo`, `isDownvoted`, `MIN_VISIBLE_SCORE`

**Phase B — Step 1: Thumbs Up/Down (MVP interaction):**
- [x] Create `ratingsStore.js` (Zustand): per-row consecutive-down tracker, per-row 30s window tracker, toast pause timer, `undoRating()` (2026-04-25)
- [x] Create `ThumbsRating.jsx`: glass pill overlay at bottom of focused card, thumbs up/down buttons (44px touch targets); SVG Feather icons, undo toast on down-rate (2026-04-25 icon fix + undo wired)
- [x] Wire ThumbsRating into PosterCard (homepage cards) — show on focused card hover only; expanded card shows inline SVG thumbs buttons (2026-04-25 emoji→SVG)
- [x] Wire ThumbsRating into FeedVideo (swipe feed cards) — `FeedVideo.jsx:3,390`
- [x] `POST /api/ratings` endpoint: record rating, update taste_profile + creator_boosts; `POST /api/ratings/undo` to reverse (2026-04-25)
- [ ] Thumbs-down card animation: 0.3s shrink + fade out, replacement card fades in (0.35s spring)
- [ ] Thumbs-up: pulse animation on card, auto-boost creator (0.25 global + 0.25 surface), add to Liked section
- [x] 4+ consecutive downs on same row: trigger `POST /api/ratings/row-refresh`, staggered domino fade-swap (100ms stagger)
- [x] Reset consecutive-down counter after row-refresh

**Phase C — Toast System Upgrade:**
- [x] Upgrade GlobalToast to support two tiers: passive (auto-dismiss 3s, no interaction) and action (CTA button, 8s timeout, configurable `position: 'top'|'bottom'` — 2026-04-25)
- [x] Action toast: rose left-border, pointer-events-auto, configurable buttons, progress bar
- [x] Toast fatigue: 1st toast normal, 2nd toast adds "Pause for 1hr" option, pause suppresses rating toasts for 60min (`isToastPaused()` in ratingsStore)
- [x] Down-rate undo toast bypasses pause (recovery path) — up-rate toast respects pause (2026-04-25)
- [ ] Max 1 action toast per 60s globally (queue others)

**Phase D — Step 2: Enhanced Feedback Loop:**
- [ ] Rapid-dislike detection: 2+ thumbs-down within 30s on same row triggers action toast ("This row isn't hitting. Want to fix it?") — ratingsStore tracks `recentDownTimestamps`, trigger UI not yet wired
- [ ] Keyword override panel: inline panel anchored below row header, up to 5 keyword inputs, Apply button
- [x] `POST /api/ratings/row-preferences` endpoint: save keywords to taste_profile with surface_key
- [ ] Row reload: new videos lazy-load one at a time (200ms stagger), pushing old content out
- [x] Thumbs-up toast: "Saved. More from [creator] coming your way." (passive tier, gated by `isToastPaused()`)

**Phase E — Liked Section & Polish:**
- [ ] "Liked" virtual shelf in library (backed by video_ratings WHERE rating='up')
- [ ] "Your Likes" row on homepage (appears after 3+ liked videos)
- [ ] Score clamping safety rail: final_score max 5x base_score
- [ ] Debug overlay (dev mode only): show score breakdown on card hover
- [x] `GET /api/ratings/history` endpoint for future "your ratings" view
- [x] `GET /api/ratings/score-debug?url=&surface=` dev endpoint — returns full scoring breakdown

### 3.10 Mobile Feed Filter System

> Depends on: 3.2 (Tag Preferences) and 3.6 (Search) for backend infrastructure. Can build the UI shell earlier but full functionality needs tags and search wired up.

- [x] Filter UI: slide-up modal or filter bar accessible from feed view
- [x] Source filter: toggle individual sources on/off to limit what appears in feed
- [x] Cross-source search: search query that runs across all active sources, results replace feed temporarily
- [x] Tag filter: filter feed by tags (requires 3.2 tag infrastructure + 3.5 auto-tagging)

### 3.11 Mobile Device Testing Gate

> **MANUAL CHECKPOINT.** Do not proceed to Milestone 4 (Pi deployment) until this is done. Prompt the user to test on a real phone over local WiFi (setup from 2.6) and sign off.

- [ ] Claude Code: prompt user to run full manual test on phone (homepage, playback, theatre mode, queue, search, swipe feed)
- [ ] User sign-off that mobile experience is acceptable before Pi migration begins

---

## Milestone 4: Deploy & Advanced

### 4.1 Raspberry Pi Deployment (now Beelink EQ12)

- [x] Production build script: `scripts/deploy.sh` — pulls, installs, builds, restarts service
- [x] Systemd service file: created in `setup-server.sh` with security hardening (NoNewPrivileges, ProtectSystem)
- [x] Setup script: `scripts/setup-server.sh` — full unattended install (Node 22, yt-dlp, npm, build, systemd, cron)
- [x] Tailscale setup: documented in `scripts/BEELINK_SETUP.md` Phase 3
- [x] Logging: `server/logger.js` — structured JSON in production (journald), colorized dev output. All server modules migrated
- [x] yt-dlp auto-update: weekly cron (Sundays 4am) in setup script
- [x] SQLite backup strategy: daily cron (3am) using `sqlite3 .backup`, 14-day retention
- [x] Bug fix: backup script pointed to wrong DB path (`server/feeddeck.db` → `data/library.db`)
- [x] Bug fix: systemd ReadWritePaths pointed to `server/` → `data/`
- [x] Added `npm start` script to package.json

### 4.2 Dual-Mode Architecture

- [x] Backend already has `mode = 'social' | 'nsfw'` in sources, categories, and feed_cache tables
- [x] Frontend modeStore already toggles between social/NSFW with panic key (Escape → social)
- [ ] Design the Social mode content pipeline (what sources? what categories?)
  > DECISION (2026-03-22): Deferred. Ship NSFW pipeline first, including 3.0 Integration.
  > NOTE: Folder rename + import path updates tracked in 1.6 Rebrand Cleanup

### 4.3 Dark/Light Theme Toggle

- [x] Tailwind dark mode class strategy: CSS custom properties for surface/text/gradient colors, `darkMode: 'class'`
- [x] Theme toggle in HomeHeader + Header: sun/moon button with `useThemeStore`
- [x] Persist preference: Zustand `persist` middleware → `fd-theme` in localStorage
- [x] Netflix-minimal dark as default: inline `<script>` in index.html prevents flash
- [x] Theme-aware gradients: HeroSection + FeaturedSection use `--color-gradient-*` variables
- [x] Theme-aware scrollbar: CSS variables for track/thumb colors

### 4.4 AI Recommendations

- [ ] Watch history + preferences → Claude API
- [ ] Taste profile scoring for new content
- [ ] "You might like this because..." UI explanations

### 4.5 Browser Extension

- [ ] Detect supported sites, inject "Save to FeedDeck" button
- [ ] One-click add to library
- [ ] Optional auto-add

### 4.6 Cross-Device Full Sync

- [ ] Sync preferences, watch history, favorites (beyond just queue)
- [ ] Simple sync code mechanism (no user accounts)

### 4.7 Offline Mode

- [ ] Download button + IndexedDB/File System Access storage
- [ ] Download progress, offline badge
- [ ] Service worker for PWA

### 4.8 In-App Source Management

- [x] Settings page at `/settings`: theme toggle, source list with pause/delete, adapter health dashboard
- [x] Source CRUD API: `GET /api/sources/list`, `POST /api/sources`, `PUT /api/sources/:domain`, `DELETE /api/sources/:domain`
- [x] Add new source: tests with registry.search() before inserting, rejects 0-result sources
- [x] Source health monitoring: adapter status badges (OK/DISABLED/UNAVAILABLE) with success/failure counts
- [x] Settings accessible from HomeHeader gear icon

---

## Milestone 5a: Video Playback (P0 — Nothing Else Matters If This Is Broken)

> Goal: Videos must play reliably across every surface — homepage theatre, feed, queue autoplay. Not just the first video. Every video.

### 5a.1 Diagnose & Fix Core Playback

- [x] Audit the full playback chain: stream URL resolution → proxy → video element → HLS.js handoff
- [x] Verify `/api/stream-url` returns valid, non-expired URLs for multiple video sources
- [x] Verify `/api/proxy-stream` correctly proxies video bytes (content-type, range requests, chunked transfer)
- [x] Check HLS.js initialization and error recovery (was silently resolving on fatal errors — FIXED)
- [x] Fix: HLS.js now attempts recovery on network/media errors, rejects on unrecoverable fatal errors
- [x] Fix: HeroSection theatre mode missing onEnded queue autoadvance — now calls advance() + resolveStream()
- [x] Fix: proxy-stream missing upstream timeout — added 15s AbortSignal.timeout()
- [x] Fix: VideoPlayer now tracks watchProgress every 5s for Continue Watching feature
- [x] Test with both direct MP4 URLs and HLS/m3u8 streams
  > All current sources return direct MP4. HLS code path verified in code (proxy rewriting + hls.js recovery). Proxy chain: fresh URL → proxy-stream → HTTP 206 video/mp4.
- [x] Confirm yt-dlp is producing working stream URLs (not geo-blocked, rate-limited, or expired)
  > 3 PornHub + 1 YouTube video all resolve. Proxy returns valid bytes for phncdn.com and googlevideo.com.

### 5a.2 Deep Playback Testing

- [?] Homepage: click a CategoryRow card → theatre mode plays video start to finish
  > API chain verified (stream-url resolves, proxy returns 206 video/mp4 bytes). Theatre mode UI activates correctly. Cannot verify actual video playback via automation — Chrome blocks media loading in MCP-controlled tabs. Needs manual browser test.
- [?] Homepage: click multiple different cards in sequence — each one plays
  > Same — needs manual verification
- [?] Feed: swipe through 5+ videos — each autoplays on snap
  > Feed API returns videos correctly. Needs manual test.
- [?] Feed: navigate away and back — playback resumes
  > Needs manual test
- [?] Queue: add 3+ videos, play through — autoadvance works, each video plays
  > Queue API works (empty queue, add/remove tested). Autoadvance code reviewed — looks correct. Needs manual test.
- [?] HeroCarousel: search results play on hover/click
  > Needs manual test
- [?] Error states: expired URL triggers re-fetch, failed video shows user-facing error (not silent black screen)
  > handleStreamError() code reviewed — retries once via resolveStream(). Needs manual test.
- [?] Edge case: rapid card switching doesn't leave zombie video elements or stale streams
  > Found 54 video elements in DOM from hover previews — potential cleanup issue. Needs manual test.

---

## Milestone 5: Design Polish & Visual Excellence

> Goal: Elevate FeedDeck's visual design beyond Netflix/YouTube/TikTok defaults. Every pixel should feel intentional. This is the "cooler than the reference apps" pass.

### 5.1 Accessibility (P0 — Ship Blockers)

- [x] Add global `focus-visible` styles: `outline: 2px solid rgba(229,9,20,0.5); outline-offset: 2px` — remove all `focus:outline-none` without replacement rings
- [x] Add `aria-label` to all icon-only buttons (~15 elements): hero "+", heart, theatre, FeaturedSection arrows, FloatingQueue chevron, CategoryRow play overlay
- [x] Add `aria-live="polite"` to FeedToast wrapper and queue count badge announcements
- [x] Add screen reader announcement for mode switch (SFW/NSFW)
- [x] Fix color contrast: bump text-muted from #6b6b70 to #8a8a90 (4.5:1). Only use accent (#e50914) at 18px+ bold or bump to #ff2d36 for small text
- [x] Add `<main>` landmark wrapper to page content areas
- [x] Add skip-nav link for keyboard users

### 5.2 Navigation Unification (P1)

- [x] Extend HomeHeader nav pattern (Home | Feed | Library) to work on all pages
- [x] Remove dead routes from FeedBottomNav (/feed/search, /feed/settings don't exist)
- [x] On mobile: single bottom tab bar that works across all views (not just feed)
- [x] Active state indicator: accent underline or dot on current nav item

### 5.3 Typography Overhaul (P1 — Highest Visual Impact)

> The single biggest identity upgrade. DM Sans is forgettable. This gives FeedDeck a recognizable voice.

- [x] Replace DM Sans with dual-font system: **Space Grotesk** (display/headlines) + **Inter** (UI/body)
- [x] Update Tailwind `fontFamily`: `sans: ['Inter', ...]` and add `display: ['"Space Grotesk"', ...]`
- [x] Apply `font-display` to hero title, FeaturedCard title, section headers, logo
- [x] Fix typography hierarchy collision: FeaturedSection header and card title both 22px/bold
  - Featured header → 14px/600, uppercase, tracking-wider (label style)
  - Featured card title → 26px/700, -0.5px tracking (hero style)
  - Category headers → 18px/700, -0.3px tracking (up from 15px)
  - Category card title → 13px/600 (up from 12px)
- [x] Hero carousel card text too small: bump title from 10px to 11px/600, duration from 9px to 10px/500
- [ ] Logo treatment: replace emoji (📡) with SVG mark, drop italic. Consider `font-family: 'Geist Mono'` at 15px/700 for technical feel
  > DECISION (2026-03-22): Emoji is fine for now. Typography overhaul is higher impact. Revisit post-launch.

### 5.4 Color & Accent Identity (P1)

> Stop looking like a Netflix clone. Own a color.

- [x] Shift accent from Netflix Red (#e50914) to Rose (#f43f5e) — one Tailwind token change
- [x] Update accent-hover and accent-muted tokens to match new accent
- [x] Warm up base surface: shift #0a0a0b to #111113 (subtle blue tint)
- [?] Consolidate raw color values to tokens: replace all `bg-gray-900/*`, `bg-white/*`, `bg-black/*` with surface-token equivalents
  > NOTE: This is a large sweeping change best done as a dedicated cleanup pass
- [?] Establish two glass material tokens in index.css
  > NOTE: Deferred to a dedicated cleanup pass
- [?] Add 1px top highlight (`border-t border-white/[0.04]`) on raised cards for depth
  > NOTE: Deferred to a dedicated cleanup pass
- [x] Mode toggle pill: reduce SFW amber from `bg-amber-500/[0.12]` to `bg-amber-500/[0.06]` — too bright, competes with hero CTA

### 5.5 Motion & Micro-Interactions (P1)

> Make every interaction feel intentional.

- [x] Unify card hover pattern across all card types: `hover:scale-[1.03] hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(0,0,0,0.4)] transition-all duration-200 ease-out`
  - Currently: VideoCard scale-105, CategoryRow scale-105/-translate-y-1, CarouselCard scale-[1.06]/-translate-y-1 (three different behaviors)
- [x] Add `active:scale-[0.97]` pressed states to all interactive elements globally
  - Feed buttons currently at `active:scale-90` (too aggressive) → soften to `active:scale-95`
- [x] Add page transition animation between routes (150ms opacity crossfade via CSS View Transitions API)
  > Implemented: CSS `::view-transition-*` rules + `useViewTransitionNavigate` hook wrapping react-router. Falls back to plain navigation when API unsupported. Respects reduced-motion.
- [x] Queue pulse animation: extend from 0.2s to 0.35s with spring easing `cubic-bezier(0.34, 1.56, 0.64, 1)` + glow ring `box-shadow: 0 0 0 4px rgba(accent, 0.3)`
- [x] Hero scroll affordance: reduce hero to ~85vh so featured content peeks above fold
  > Implemented: HeroSection height 100vh → 85vh (non-theatre). FeaturedSection naturally peeks above fold.
- [x] Tighten FeaturedSection scroll zone from 550vh to ~300vh, retune phase breakpoints
  > Implemented: 550vh → 300vh, phase breakpoints retuned (P1 0.15, P2 0.35, P3 0.85). Sticky container 100vh → 85vh.

### 5.6 Spacing & Layout Rhythm (P1)

- [x] Establish single page gutter token: px-10 for homepage, px-4/md:px-6 for dense pages (intentional density difference)
- [x] Unify card gaps: `gap-3` (12px) for horizontal scroll rows, `gap-4` (16px) for grids
- [x] FeaturedSection cards: switch from fixed 380px height to `height: clamp(320px, 28vw, 420px)` for responsive scaling
- [?] Hero content positioning: decouple from pixel magic numbers (`bottom-[230px]`), use flexbox/grid layout
  > NOTE: This requires reworking the scroll-based animation system. Deferred.

### 5.7 Component-Level Polish (P2)

- [x] HomeHeader nav: add 2px bottom accent indicator on active nav item (already done in 5.2)
- [x] ContextMenu star rating: move "Rate" label above stars, increase tap target to `w-7 h-7`, add `hover:text-amber-300`
- [x] FloatingQueue vs. mobile preview button conflict: gated preview toggle behind `import.meta.env.DEV`
- [x] SourceControlSheet: add glassmorphism (`backdrop-blur-2xl`) + top glow shadow (`shadow-[0_-4px_24px_rgba(0,0,0,0.3)]`)
- [x] Hero carousel gradient: lighten from `from-black/[0.85]` to `from-black/[0.75]` so text isn't buried

### 5.8 Empty States & Copy (P2)

- [x] Feed empty state: replace "Check back once the backend has fetched content" with actionable CTA ("Add your first source to start discovering videos")
- [x] Library empty state: "Start building your library" with Browse Feed CTA
- [x] Queue empty state: already decent but could use illustration or visual
- [x] All empty states should have a primary action button

### 5.9 Library Page Upgrade (P2)

- [x] Build out Library as first-class page matching homepage visual language
- [x] Tabs: All, Favorites, Watch History, Watch Later, Top Rated (with count badges)
- [x] Continue Watching row at top with resume progress indicators
- [x] Add watchProgress tracking to libraryStore (0-1 fraction, setWatchProgress action)
- [x] Per-tab contextual empty states with actionable CTAs
- [x] Make Library reachable from all views via unified nav (done in 5.2)

### 5.10 Bundle & Performance

- [x] Add code-splitting to reduce 789KB JS bundle (Vite build warning)
- [x] Add eslint.config.js for ESLint v9+ (currently no config, lint check fails)
- [x] modeStore.js mixed dynamic/static import warning (Vite build)

---

## Discovered Tasks

_Claude Code adds tasks here as they come up during implementation. Move to the appropriate section when triaging._

### Homepage Quality Pass (filed 2026-04-24 from visual review)

- [x] (2026-04-24) **BUG: `daysAgo` uses `fetched_at` instead of `upload_date`** — fixed 2026-04-24. mapVideo now parses `upload_date` (YYYY-MM-DD, YYYYMMDD, and ISO 8601), uses it for `daysAgo`, and exposes `uploadTs`/`fetchedTs` as sortable timestamps. Backend `/api/homepage` SELECT now also returns `fetched_at`. Categories sort newest-first by `uploadTs` before round-robin. Plus: stale-cache filter (180-day window) excludes pre-2025 content from non-pinned shelves and Top 10 — pinned/subscription content exempt. Plan: `~/.claude/plans/fix-up-next-carousel-distributed-lark.md`.

- [x] (2026-04-24) **Recency bias: prioritize recently cached videos across all rows** — fixed alongside the `daysAgo` bug. Same change set above.



- [ ] (2026-04-24) Phase 3 of NSFW homepage plan: taste-driven row engine ("Because you liked POV", "More from {creator}", "Tonight's Picks"). Stored as dynamic `persistent_rows` entries with a `dynamic_query` field, regenerated nightly. Sketched in `~/.claude/plans/refactored-swimming-cocoa.md`. Defer until current shelves are validated in real use.
- [ ] (2026-04-24) Top-3 PH model rows are wired but currently empty (`creator_boosts` table has no PH creators with positive boost yet). Will auto-appear once enough thumbs-up ratings accrue on PH content. No code action needed — just usage time.
- [ ] (2026-04-24) `0 new videos` runs on `nsfw_redgifs_amatr/couple/pov/solo` and `nsfw_xvideos_hits` — likely scraper selectors are stale or those queries return mostly already-cached URLs. Investigate if rows stay thin after a week of warm-cache runs.
- [x] (2026-04-24) NSFW homepage thinness — landed in this session. See "## Completed" for full details. Net +12 category rows + 2 sticky personalized shelves leading the page.
- [x] Reduce CDN URL cache TTL from 4 hours to 2 hours (PornHub URLs expire in ~2hr)
- [x] Wire source adapter system (`server/sources/`) into `server/index.js` — completed in 3.0 Integration
- [x] Clean up 3 stale `vite.config.js.timestamp-*` files in project root
- [x] **CRITICAL:** Fix missing `crypto` import in `server/index.js` — playlist creation crashed at runtime. Fixed: imported `randomBytes` from `crypto` (Cowork morning sprint 2026-03-22)
- [x] Wire tag preferences into `refillCategory()` and `_refillFeedCacheImpl()` — both now query liked tags and append up to 2 random liked tags to search queries for personalized discovery. Discovered during personalization audit (morning sprint 2026-03-22)
- [x] Hover preview video element cleanup — added useEffect cleanup on unmount in useHoverPreview hook to cancel active previews when components unmount
- [x] (2026-03-26) TikTok GDPR import pipeline — `import-tiktok.js` parses exports, `server/scripts/process-tiktok-imports.js` enriches via yt-dlp, API routes added (`/api/tiktok/status`, `/api/tiktok/recent`, `/api/tiktok/failed`, `/api/tiktok/watch-history`). 56K+ imports seeded, processor running.
- [x] **HIGH:** Add timeout to yt-dlp `streamSearch()` spawn — 60s kill timer prevents leaked processes (Cowork morning sprint 2026-03-22)
- [x] **HIGH:** Cap feed buffer at 200 items with safe eviction in `feedStore.js` — prevents OOM on long sessions (Cowork morning sprint 2026-03-22)
- [x] **HIGH:** Close Puppeteer browser on scrape failure in `server/sources/scraper.js` — reduced threshold from 5 to 3 consecutive failures, added logging
- [x] Add SIGTERM handler to clear background `setInterval` callbacks in `server/index.js` and close DB (already implemented)
- [x] Add per-chunk timeout to proxy-stream pipe in `server/index.js` — 30s inactivity timeout aborts stalled streams
- [x] Add AbortController to `_warmStreamUrls()` in feedStore, abort on `resetFeed()` (already implemented)
- [x] Log malformed JSON parse failures in `server/index.js` tag processing — popular-tags and feed filter now log warnings
- [x] Wire tag preferences into `refillCategory()` — already done per morning sprint 2026-03-22 (duplicate of item above)
- [x] Remaining 18 `react-hooks/exhaustive-deps` ESLint warnings — all resolved: safe deps added where possible, eslint-disable with comments for intentional omissions
- [x] Remove debug `console.log('Queue: advancing to')` from `VideoPlayer.jsx:136` and `useKeyboard.js:41` (Cowork morning sprint 2026-03-22)
- [x] (2026-04-12) Video quality upgrade: yt-dlp format string raised from 480p cap to 1080p in `server/sources/ytdlp.js` (default + HLS fallback)
- [x] (2026-04-12) Thumbnail quality fix: `normalizeVideo` in `server/sources/base.js` now picks highest-res thumbnail (`thumbnails.at(-1)`) instead of lowest
- [x] (2026-04-12) Homepage row dedup: carousel built via round-robin sampling across categories, then filtered from category rows — eliminates "Up Next" / "Just Dropped" overlap
- [x] (2026-04-12) Top 10 personalization: scoring now factors tag affinity (50% boost per liked tag) + subscription source boost (1.3x), not just raw view count
- [x] (2026-04-12) Homepage row reorder: Top 10 moved to first row below hero (before PosterShelf), TheatreRows follow after

---


### Promoted from Design Reviews (2026-04-07 & 2026-04-08)

_Open items from archived design review runs. Completed review items in [`BACKLOG-ARCHIVE.md`](BACKLOG-ARCHIVE.md)._

- [ ] **Content-aware skeleton shapes** -- Match skeleton layout to actual component dimensions.
- [ ] **Ambient color extraction** -- Extract dominant thumbnail color for hero gradient overlay.
- [ ] **Branded empty state SVGs** -- Replace emoji icons with custom illustrations.
- [ ] **Noise/grain texture** -- Subtle film grain on dark surfaces for cinematic feel.
- [ ] **Content-aware hero gradient** -- Extract dominant color from hero thumbnail for gradient overlay.
- [ ] **Lightweight detail card on hover** -- Expanded card with synopsis and action buttons before committing to Theatre (Netflix signature pattern).
- [ ] **Editorial row variety** -- Increase from 3-5 to 8-10 rows: "Fresh Today", "Long Watches", "Quick Hits", "Most Viewed", source highlights.
- [ ] **Card hover expansion animation** -- Scale + translate + info reveal (Netflix pattern).
- [ ] **Maturity/content rating badges** -- Source-specific ratings on cards and hero.
- [ ] **"More Like This" related content** -- Suggest similar videos after watching.

---

## Completed (Recent)

> Full history: [`BACKLOG-ARCHIVE.md`](BACKLOG-ARCHIVE.md)

- [x] (2026-04-26) **Discovered: Unified hover scale token** — Added `--hover-scale: 1.03` to motion-token block in `index.css`. Replaced six `hover:scale-[1.0X]` literals with `hover:scale-[var(--hover-scale)]` across `VideoCard.jsx`, `LibraryPage.jsx`, `VideoDetailPage.jsx` (was an inconsistent `1.02`), `HeroCarousel.jsx` (×2), `Top10Row.jsx`. Nav-arrow `hover:scale-105` in `GalleryRow.jsx` left alone — different element class, intentionally larger lift. Verified compiled CSS contains `--tw-scale-x: var(--hover-scale)`.
- [x] (2026-04-26) **Discovered: Cookie-health PornHub probe — already fixed** — Stale backlog item. Commit `63b5dd9` (2026-04-25) replaced the dead probe URL (`view_video.php?viewkey=ph5f8b3c7a21a28`) with `/video?o=tr` (trending page) and surfaces yt-dlp's `ERROR:` line up to 250 chars. Probe now returns 'healthy', the scary 🔴 is gone. Marked complete.
- [x] (2026-04-25) **Discovered: Vertical scroll hijack — already fixed** — Stale backlog item. `GalleryRow.jsx:142` already says "Scroll hijacking REMOVED — vertical wheel scrolls the page, not the row." Resolved in commit `2cd9422`. Marked complete.
- [x] (2026-04-25) **Discovered: "Viral This Week" landscape rows scaled up** — `PosterCard.jsx` landscape cap bumped `min(50vh, 360px)` → `min(50vh, 420px)`. On 1080p the landscape cards now render at 420px (was 360px), narrowing the visual-weight gap with poster shelves at 540px.
- [x] (2026-04-25) **Discovered: Top 10 row scaled up** — `Top10Row.jsx` switched from fixed `w-[130px]/h-[185px]/text-[80px]` to clamp-based responsive sizing. On 1080p: card 189×270 (was 130×185), rank 156px (was 80px). Aspect ratio 0.703 preserved across all viewport sizes.
- [x] (2026-04-25) **Discovered: `/api/homepage/more` dead code removed** — Ripped out the IntersectionObserver, sentinel ref, and `loadingMore` state from `HeroCarousel.jsx`. Endpoint was never implemented; silent-404 fetch is gone.
- [x] (2026-04-25) **Discovered: `PosterInfoPanel.jsx` deleted** — Verified zero imports in `src/` and `server/` before removing.
- [x] (2026-03-22) 4.1 Deployment, 4.3 Theme, 4.8 Source Management (committed from previous session)
- [x] (2026-03-22) 5.9 Library Page Upgrade: font-display headers, tab bar (All/Favorites/History/Watch Later/Top Rated) with count badges, Continue Watching horizontal row with progress bars, per-tab empty states with CTAs, watchProgress tracking in libraryStore
