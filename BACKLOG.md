# FeedDeck Backlog
<!-- COWORK TEST: pineapple-rocket-42 -->

**Repo:** https://github.com/torin1226/feeddeck (private)

This is the single source of truth for all project tasks. Claude Code and Cowork read from and update this file directly.

For backlog management protocol, see `BACKLOG_SKILL/SKILL.md`.

---

## Status Key

- `[ ]` — Not started
- `[~]` — In progress
- `[x]` — Complete
- `[!]` — Blocked (see notes)
- `[?]` — Needs decision from user

---

## Milestone 1: Desktop MLP (Minimum Lovable Product)

> Goal: Open the site on desktop, browse real content, watch videos, queue stuff, and it feels polished. Everything below this line ships before moving to mobile.

### 1.1 Finish Homepage Animation

- [x] Create `useFeaturedScroll.js` hook with state machine (IDLE, SCROLLING, SNAPPING, REVEALED)
- [x] Implement 250vh scroll zone wrapper with sticky inner container (100vh)
- [x] 3-phase animation: Phase A (enter small→fullscreen), Phase B (hold fullscreen), Phase C (fullscreen→carousel)
- [x] Active card uses `transform: scale(X)` — never set width/height during scroll
- [x] Side cards emerge via opacity and translateX in Phase C only
- [x] Border-radius transitions, tipping point snap, REVEALED↔SCROLLING transitions
- [x] Fix stale closure bugs (refs-only approach, no useCallback)
- [x] Fix late-mount initialization (totalCards watcher for async data)
- [x] Test in real browser and fine-tune phase boundaries/timing
- [x] Add `will-change: transform` on cards for GPU compositing hints

### 1.2 Wire Homepage to Real Data

- [x] Create `playerStore.js` for shared activeVideo state across hero, carousel, queue
- [x] Theatre mode end-to-end: hero video plays, TheatreControls work, CategoryRows hide, exit restores
- [x] Hero ↔ Carousel interaction: clicking carousel card updates hero background/title/metadata
- [x] Homepage → real data bridge: replace picsum.photos placeholders with data from library/backend
- [x] Verify all keyboard shortcuts work on HomePage (not just LibraryPage)

### 1.3 Backend Homepage Endpoints

- [x] Add `homepage_cache` table (id, category, mode, url, title, thumbnail, duration, source, uploader, fetched_at, expires_at, viewed)
- [x] Add `categories` table (key, label, query, mode where mode = 'social' or 'nsfw')
- [x] `GET /api/homepage?mode=social|nsfw` returns cached videos grouped by category
- [x] Async yt-dlp refill when any category drops below 8 valid videos
- [x] `POST /api/homepage/viewed?id=` marks video viewed, triggers refill if below threshold

### 1.4 Hover Preview

- [x] Stream real video (muted, low-res) on thumbnail hover
- [x] 300ms debounce before starting stream
- [x] Abort stream on mouseout
- [x] Max 1 preview streaming at a time (new hover cancels previous)
- [x] No duration cap — plays as long as user hovers

### 1.5 Error Handling & Resilience

- [x] Stale streaming URL detection and refresh (yt-dlp URLs expire)
- [x] yt-dlp failure handling: video taken down, geo-blocked, rate limited — surface clear error to user
- [x] Loading skeletons for grid, hero, carousel, featured section (not spinners)
- [x] Empty states: no videos in library, empty queue, empty search results, no categories loaded

### 1.6 Rebrand Cleanup

> Internal plumbing still uses old "Puppy Viewer" names. Fix before shipping. 20 files affected, ~70 references total.

**localStorage & Zustand stores:**
- [x] Rename localStorage keys: `pv-mode` → `fd-mode`, `pv-lib` → `fd-lib`, `pv-queue` → `fd-queue`, `pv-app` → `fd-app`, `pv-content` → `fd-content`
- [x] Add migration: on load, if old `pv-*` keys exist, copy to `fd-*` keys and delete old ones
- [x] Update Zustand store `name` fields in: `modeStore.js`, `libraryStore.js`, `queueStore.js`, `useAppStore.js`, `useContentStore.js`
- [x] Update `DebugPanel.jsx` localStorage key references (`pv-mode`, `pv-lib`, `pv-queue`)

**Puppy data removal (entire SFW→Social rewrite):**
- [x] Delete `src/data/puppyData.js` entirely (35 puppy references)
- [x] Remove all `import { getSFWData } from '../data/puppyData'` in: `VideoPlayer.jsx`, `FloatingQueue.jsx`, `QueueSidebar.jsx`, `VideoCard.jsx`, `Queue.jsx`
- [x] Remove `import { getSFWData, generateDemoPuppies } from '../data/puppyData'` in `MobileSwipeView.jsx`
- [x] Replace puppy-specific SFW rendering logic with dual-mode Social data in all components above

**UI branding:**
- [x] `Header.jsx`: "Puppy Gallery" → "FeedDeck", remove puppy branding
- [x] `ModeToggle.jsx`: "Switch to puppy mode" → appropriate Social mode label
- [x] `useAppStore.js`: `document.title = 'Puppy Gallery 🐕'` → `'FeedDeck'`
- [x] `modeStore.js`: Remove `PUPPY_FAVICON`, update title logic to always show "FeedDeck" / 📡
- [x] `VideoPlayer.jsx`: Remove hardcoded puppy pexels video URL, replace SFW logic
- [x] `VideoGrid.jsx`: "Check back later for more puppy videos!" → appropriate empty state
- [x] `QueueSidebar.jsx`: "Queue up some puppy videos!" → appropriate empty state
- [x] `dist/index.html`: "Puppy Gallery 🐕" → "FeedDeck"

**Project-level:**
- [x] `package.json`: `"name": "puppy-viewer"` → `"feeddeck"`
- [x] `.claude/launch.json`: rename both config entries from "puppy-viewer" to "feeddeck"
- [x] Rename project folder from `puppy-viewer/` to `feeddeck/` (coordinate with user)
- [x] Update all import paths after folder rename

### 1.7 Desktop MLP Polish

- [x] Responsive breakpoint audit: verify homepage at all Tailwind breakpoints (sm/md/lg/xl)
- [x] Next-up preview overlay: show upcoming video in corner before queue auto-advances
- [x] Playback speed selector (0.5x to 2x)
- [x] Quality selector — deferred to Milestone 3 (requires `yt-dlp -F` endpoint)
- [x] Hero search bar: make it narrower, move helper text from beside it to below it

---

## Milestone 2: Swipe Feed

> Goal: A buttery-smooth infinite vertical video feed that aggregates short-form content from multiple sources. Available on mobile AND desktop at `/feed`. Think TikTok but pulling from everywhere, with the mode (Social vs NSFW) determining which sources are mixed in.

### Design Spec

#### Gesture Map (touch + trackpad/scroll on desktop)

| Gesture | Action |
|---------|--------|
| Swipe up | Next video |
| Swipe down | Previous video |
| Swipe right | Open source URL in new browser tab |
| Swipe left | Add to queue (animation + toast confirmation) |
| Double-tap | Like/heart (burst animation) |
| Tap | Play/pause toggle |
| Long-press | Source controls: "More from this source" / "Hide this source" |

#### Feed UI

- **Overlay (subtle, always visible):** Video title, creator name, source icon (small, bottom-left)
- **Timeline bar:** Thin scrubbable progress bar at very bottom, TikTok-style. Shows position in current video.
- **Bottom nav bar:** 4 tabs — Feed, Search, Queue, Profile/Settings
- **No sidebar icons.** All actions are gesture-driven. Clean, immersive.

#### Video Display

- **Vertical video:** Full-bleed, fills viewport
- **Horizontal video (default):** Cropped/fit to fill — no black bars, center-crop to fill vertical frame
- **Horizontal video (user setting):** Letterbox mode — black bars top/bottom, video at native aspect ratio
- **Setting location:** Profile/Settings tab, "Video Display" section

#### Feed Algorithm

- **Sources per mode:**
  - Social: YouTube Shorts, Instagram Reels, TikTok
  - NSFW: fikfap, pornhubshorties, and similar aggregators (user can add more)
- **Mix:** Library videos (previously saved) shuffled in with discovery (new from sources)
- **Max length:** User-configurable in settings (default: no limit)
- **Source weights:** Algorithm-driven, influenced by "more from this source" / "hide this source" feedback
- **No repeat:** Don't show the same video twice in a session unless user scrolls back

#### Source Management

- **In-feed:** Long-press any video → "More from this source" (boost weight) or "Hide this source" (suppress)
- **Backend:** `sources` table tracks domains, mode, weight, active/hidden status
- **Adding sources:** Future — in-app setting to add new domains. For MLP, hardcode the initial source list.

#### Content Pipeline

- **Scheduled background fetch:** Cron-style job fetches new videos from each active source on an interval (e.g., every 30 min). Stores metadata + streaming URL in `feed_cache` table.
- **On-demand top-up:** When the client's buffer drops below 5 unwatched videos, hit `GET /api/feed/next?mode=X&count=10` to fetch more.
- **Expiry:** Streaming URLs expire. Backend tracks `expires_at` and re-fetches via yt-dlp when needed.
- **Dedup:** Same video URL from different aggregators = one entry.

### 2.1 Feed Core

- [x] Create `/feed` route, accessible from both mobile and desktop
- [x] Full-viewport vertical scroll container with CSS scroll-snap (`snap-y snap-mandatory`)
- [x] Each video fills 100vh (or 100dvh for mobile browser chrome)
- [x] Infinite scroll: fetch next batch when 5 videos from end of buffer
- [x] Video autoplay on snap (muted initially, unmute on first tap)
- [x] Preload next 2 videos, cache previous 2, unload beyond that
- [x] Vertical video: full-bleed, no transforms needed
- [x] Horizontal video: default center-crop to fill frame (`object-fit: cover`)
- [x] Horizontal video letterbox setting: `object-fit: contain` with black background
- [x] Store letterbox preference in user settings (localStorage for now, server later)

### 2.2 Gesture System

- [x] Swipe up/down: snap to next/previous video (scroll-snap handles this natively)
- [x] Swipe right: detect horizontal swipe threshold (>50px, <30deg angle), open `video.sourceUrl` in new tab
- [x] Swipe left: detect horizontal swipe, trigger add-to-queue
- [x] Swipe-left feedback: card slides left with queue icon animation + toast "Added to queue"
- [x] Double-tap: like/heart with burst animation overlay (heart particles, TikTok-style)
- [x] Tap: play/pause toggle
- [x] Long-press (>500ms): open source control sheet ("More from this source" / "Hide this source")
- [x] Desktop: map scroll wheel to swipe up/down, keyboard arrows too
- [x] Desktop: map left/right arrow keys to swipe-left (queue) and swipe-right (source)
- [x] Prevent gesture conflicts: horizontal swipes only register if clearly horizontal (angle check)

### 2.3 Feed UI Components

- [x] `FeedPage.jsx`: route component, manages feed state and infinite scroll
- [x] `FeedVideo.jsx`: single video card (100vh), handles video element + overlay
- [x] `FeedOverlay.jsx`: subtle bottom-left overlay — title, creator, source icon (built into FeedVideo)
- [x] `FeedTimeline.jsx`: thin scrubbable progress bar at bottom edge (built into FeedVideo)
- [x] `FeedBottomNav.jsx`: 4-tab navigation (Feed, Search, Queue, Profile)
- [x] `FeedToast.jsx`: transient notification for queue add, like confirmation
- [x] `HeartBurst.jsx`: double-tap heart animation (CSS particles or canvas)
- [x] `SourceControlSheet.jsx`: long-press bottom sheet with source actions
- [x] `QueueSwipeAnimation.jsx`: card-slides-left animation component

### 2.4 Feed Store & State

- [x] Create `feedStore.js` (Zustand): current feed buffer, current index, loading state
- [x] Feed buffer: array of video objects with `id`, `url`, `streamUrl`, `title`, `creator`, `source`, `sourceUrl`, `duration`, `orientation`, `thumbnail`
- [x] Track watched IDs in session to prevent repeats
- [x] Source weight map: `{ domain: weight }` persisted in localStorage/server (server-side via source-feedback endpoint)
- [x] User settings: max video length, letterbox preference

### 2.5 Feed Backend

- [x] `feed_cache` table: id, source_domain, mode, url, stream_url, title, creator, thumbnail, duration, orientation (vertical/horizontal), fetched_at, expires_at, watched
- [x] `sources` table: domain, mode (social/nsfw), label, weight, active (boolean), added_at
- [x] Seed initial sources: YouTube Shorts, TikTok (social); PornHub (nsfw)
- [x] `GET /api/feed/next?mode=X&count=10` — return next unwatched videos, weighted by source preferences
- [x] `POST /api/feed/watched?id=X` — mark video watched
- [x] `POST /api/feed/source-feedback` — body: `{ domain, action: 'boost' | 'hide' }` — adjust source weight
- [x] Background fetch job: iterate active sources, yt-dlp extract new videos, insert into feed_cache
- [x] Configurable fetch interval per source (default 30 min)
- [x] Stream URL refresh: if `expires_at` passed, re-fetch via yt-dlp before serving
- [x] Dedup: unique constraint on video URL, skip duplicates across sources

### 2.6 Mobile Testing via Local WiFi

> Test swipe feed and mobile UI on a real phone before any Pi/Tailscale setup. All M1-M3 work targets the local Windows laptop.

- [x] Update `vite.config.js` to bind dev server to `0.0.0.0` (not just localhost)
- [x] Verify Vite proxy still routes `/api` to Express for mobile clients
- [x] Update Express to also listen on `0.0.0.0`
- [x] Add dev script or console log that prints local network URL (e.g. `http://192.168.x.x:3000`) on startup
- [x] Document setup in a short note: connect to same WiFi, open URL on phone (Vite prints network URL on startup)

### 2.7 Feed Polish

- [x] Smooth snap animation (not jarring — ease-out, ~300ms) (CSS scroll-snap + smooth behavior)
- [x] Loading skeleton while next batch fetches
- [x] "You're all caught up" state when feed exhausted (rare but handle it)
- [x] Pull-to-refresh at top of feed (mobile)
- [x] Orientation transition: smooth crossfade when switching between vertical and horizontal videos
- [x] Respect system reduced-motion preference (disable burst animations, simplify transitions)
- [?] Test on real mobile devices: iOS Safari, Android Chrome (viewport, scroll-snap, gesture conflicts)
  > QUESTION: Ready for manual mobile testing. Start `npm run dev` and open the network URL on your phone (same WiFi). Test swipe up/down, left/right gestures, double-tap hearts, and long-press source control.

### 2.8 Video Playback Optimization

> Goal: Eliminate all stutter and delay between swipes. Videos should feel like they're already playing before the user gets there. Priority gate: do not start until basic feed video playback works end-to-end.

**Tier 1 — Highest leverage (do first):**
- [x] Pre-resolve stream URLs at ingest time: background refill job runs yt-dlp and stores `stream_url` in `feed_cache` immediately. `/api/feed/next` returns stream URLs directly in the response. Eliminates per-video `/api/stream-url` round-trips
- [x] Pre-warm feed on app load: add `feedStore.prefetch()` that fetches first batch of feed data + stream URLs during idle time on homepage (before user navigates to `/feed`). Use `requestIdleCallback` or fire after homepage render
- [x] Eager URL warm-up in store: when `fetchMore()` pulls 10 videos into buffer, immediately resolve/validate stream URLs for next 5 videos (beyond the ±2 render window). Bytes downloading before user scrolls there

**Tier 2 — Smooth out the edges:**
- [x] Video element pooling: DEFERRED — conflicts with singleton `<video>` pattern needed for iOS unmute persistence. The singleton already avoids DOM churn for the active element. Pre-resolved stream URLs (Tier 1) eliminate the main latency source. Revisit if stutter persists after mobile testing
- [x] `<link rel="preconnect">` for known CDN domains: N/A — all video loads go through same-origin `/api/proxy-stream`, so browser preconnect hints don't apply. Server-side DNS is already warm from refill jobs
- [x] Increase preload window: bump PRELOAD_AHEAD from 2 to 3-4 on fast connections. Detect via `navigator.connection.effectiveType`

**Tier 3 — Premium smoothness:**
- [ ] Service worker video segment caching: cache first ~500KB of each preloaded video response. Swipe transitions start from cache instantly while rest streams in background
- [x] Adaptive preload depth: use Network Information API to adjust strategy. 4G/WiFi → preload 4 ahead, 3G → preload 1 + lower quality (already implemented in FeedVideo._getPreloadWindow())
- [x] Stream URL TTL monitoring: proactive re-resolve for URLs expiring within 15min (5min check interval). Also fixed /api/stream-url to check expires_at before serving cached URLs

### 2.9 Mobile Feed Polish

> **Priority gate:** Do not start until 2.8 is complete (video playback is silky smooth).

- [x] Long-press timing fix: increase threshold from 500ms to ~800-1000ms so source-control sheet doesn't fire during normal scrolling or casual holds
- [x] Refresh feed button: visible button in feed UI to manually refresh/reload the feed (complement to pull-to-refresh)
- [x] Fullscreen immersive mode: button on feed overlay that hides nav bar and overlay. Video fills entire viewport, user can still scroll between videos. Tapping screen temporarily reveals overlay (auto-hides after ~3s or on next scroll)
- [x] Auto-hide nav bar: bottom nav hides on scroll down (into feed), reappears on scroll up. CSS transform slide-down/up with ~200ms transition. Reclaims screen real estate without losing access
- [x] Rethink settings access: added three-dot source control button on right side of active video (tap-friendly alternative to long-press). Settings tab already in bottom nav. Long-press still works but is no longer the only discovery path

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
- [?] Future: system searches, account login for personalized feeds (see 3.4 Cookie Auth)

### 3.4 Cookie-Based Auth for Personalized Feeds

> Import browser cookies so yt-dlp can access logged-in content: personalized recommendations, subscriptions feed, watch history, premium content. User exports cookies via browser extension (e.g. "Get cookies.txt LOCALLY"), imports via drag-and-drop or file picker. Re-importing should be frictionless since cookies expire.

- [x] Settings UI: file picker for `cookies.txt` import with re-import and remove buttons
- [x] Cookie stored server-side at `data/cookies.txt` (ready for Pi migration)
- [x] Backend: `POST /api/cookies` receives content, validates Netscape format, writes file
- [x] yt-dlp adapter auto-detects `data/cookies.txt` and passes `--cookies` flag
- [x] Fallback to public-only content when no cookies present (no flag passed)
- [x] Cookie status indicator: green dot with count and last-modified date
- [x] `GET /api/cookies/status` and `DELETE /api/cookies` endpoints

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
- [?] Design the Social mode content pipeline (what sources? what categories?)
  > QUESTION: Social mode needs its own content sources and category structure. Defer until NSFW pipeline is solid?
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
- [ ] Test with both direct MP4 URLs and HLS/m3u8 streams
- [ ] Confirm yt-dlp is producing working stream URLs (not geo-blocked, rate-limited, or expired)

### 5a.2 Deep Playback Testing

- [ ] Homepage: click a CategoryRow card → theatre mode plays video start to finish
- [ ] Homepage: click multiple different cards in sequence — each one plays
- [ ] Feed: swipe through 5+ videos — each autoplays on snap
- [ ] Feed: navigate away and back — playback resumes
- [ ] Queue: add 3+ videos, play through — autoadvance works, each video plays
- [ ] HeroCarousel: search results play on hover/click
- [ ] Error states: expired URL triggers re-fetch, failed video shows user-facing error (not silent black screen)
- [ ] Edge case: rapid card switching doesn't leave zombie video elements or stale streams

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
- [?] Logo treatment: replace emoji (📡) with SVG mark, drop italic. Consider `font-family: 'Geist Mono'` at 15px/700 for technical feel
  > QUESTION: Do you want a custom SVG logo designed, or is the emoji fine for now?

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
- [?] Add page transition animation between routes (150ms opacity crossfade via AnimatePresence or CSS)
  > QUESTION: This requires framer-motion or a CSS-based approach. Worth adding a dep for this?
- [x] Queue pulse animation: extend from 0.2s to 0.35s with spring easing `cubic-bezier(0.34, 1.56, 0.64, 1)` + glow ring `box-shadow: 0 0 0 4px rgba(accent, 0.3)`
- [?] Hero scroll affordance: animated down-chevron at bottom of hero OR reduce hero to ~85vh so featured content peeks
  > QUESTION: Which approach do you prefer — chevron hint or peek?
- [?] Tighten FeaturedSection scroll zone from 550vh to ~300vh, show progress bar during scroll, add "skip" affordance
  > QUESTION: Changing scroll zone length affects the animation timing. Want me to adjust?

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

- [x] Reduce CDN URL cache TTL from 4 hours to 2 hours (PornHub URLs expire in ~2hr)
- [x] Wire source adapter system (`server/sources/`) into `server/index.js` — completed in 3.0 Integration
- [x] Clean up 3 stale `vite.config.js.timestamp-*` files in project root

---

## Completed

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
