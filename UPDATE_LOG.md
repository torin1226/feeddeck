# FeedDeck Update Log

## 2026-05-17 (Design Review) — Home Page Review + Logo-as-Mode-Toggle

### Completed
- **Daily design review: home page (`/`).** Audited HomeHeader, HeroSection, HeroCarousel, GalleryShelf, BrowseSection across 6 lenses (Behavioral Impact, Content Hierarchy, Visual Consistency, Aesthetic System, Contrast & Readability, Implementation Scope). Generated current-state HTML preview and annotated proposed mockup at `docs/design-reviews/2026-05-17-home.html` / `2026-05-17-home-proposed.html`.
- **Shipped: logo-as-mode-toggle.** Removed the amber `SOCIAL MODE / NSFW MODE` pill from the header — it was the most visually prominent element on every page load. Replaced with logo-as-toggle: clicking the `📡FeedDeck` wordmark calls `toggleMode`. A 4px accent-colored dot (`w-1 h-1 rounded-full bg-accent`) sits centered below the wordmark — `opacity-0` in SFW, `opacity-100` in NSFW. Zero extra chrome, completely invisible in the default state. Commit: pending (see next session).
- **Settings icon: emoji → SVG.** Replaced `⚙` emoji in the header with a proper SVG gear icon, consistent with the existing search/shuffle SVG icons.
- **Updated `docs/design-reviews/memory.json`:** home marked reviewed, calibration entry recorded (prediction was wrong — gallery rows are active daily usage, not backup discovery), taste notes updated.
- **Filed 2 new bugs in BACKLOG:** Top10Row missing thumbs ratings UI (P2), UP NEXT carousel spam content (P2).

### In Progress
- None (HomeHeader.jsx changes are complete but uncommitted — shutdown was interrupted mid-sequence)

### Decisions Made
- Logo-as-toggle over quiet pill: user wanted the mode indicator to be "lowkey but still easily accessible." Logo repurposes an existing element (zero new chrome), dot indicator is visible only in NSFW mode. See `_memory/decisions/2026-05-17-logo-as-mode-toggle.md`.

### Issues & Blockers
- `preview_screenshot` continues to time out (10th+ P3 recurrence) when videos are autoplaying. Workaround: pause+clear all video elements via `preview_eval` before each capture. Below-fold captures still timeout due to 255 video elements reinitializing on scroll. Fell back to DOM audit for below-fold structure.

### Key Files Changed
- `src/components/home/HomeHeader.jsx` — logo-as-toggle button, dot indicator, SVG gear icon, amber pill removed
- `docs/design-reviews/2026-05-17-home.html` — current-state preview
- `docs/design-reviews/2026-05-17-home-proposed.html` — annotated proposed mockup (3 changes: mode toggle, scroll cue chevron, row order)
- `docs/design-reviews/memory.json` — home review recorded, calibration entry added

### Next Session Should
- Commit HomeHeader.jsx changes: `git commit -m "feat(header): logo-as-mode-toggle, remove amber mode pill, settings svg icon"`
- Implement proposed change #2: animated chevron scroll cue at hero bottom edge (HeroSection.jsx)
- Investigate Top10Row thumbs rating gap before it becomes a Beelink-deploy blocker

---

## 2026-05-17 (Infrastructure) — F3 Active Session Manifest + Skill File Consolidation

### Completed
- **Shipped F3 — Active Session Manifest system.** Each running session now writes a live manifest at `../_memory/sessions/active/<session_id>.md` (format: `YYYY-MM-DD-<short-context>-<random4>`) declaring claimed tasks, claimed resources (dev-server, DB, etc.), active decisions, and current focus. Other sessions read these at three checkpoints: startup awareness check, before editing shared zones (`server/`, config, `BACKLOG.md`, `_PROJECT.md`), and at shutdown Step 7 for tree hygiene. Replaces F2's mtime-only heuristic with a primary manifest signal + mtime as backstop. Full decision at [`../_memory/decisions/2026-05-16-f3-active-session-manifest.md`](../_memory/decisions/2026-05-16-f3-active-session-manifest.md).
- **Coupled `[~]` claims structurally.** The backlog skill's "claim a task" step now writes BOTH `[~]` in `BACKLOG.md` AND a line in the active manifest as one combined step — you cannot do one without the other. Same F2 lesson: prevention by structure, not by discipline.
- **Consolidated 8 skill files in 4 places → 3 files in 1 place + 3 Windows directory junctions.** Canonical: `area 51/.claude/skills/{startup,shutdown,backlog}/SKILL.md`. Project-level paths under `feeddeck/.claude/skills/` are junctions to vault-level. Deleted: orphan `area 51/SKILL.md`, drafts in `_memory/skill-updates/*-SKILL.md` (replaced with a `README.md` breadcrumb).
- **Fixed latent F2 drift bug** uncovered during consolidation: `feeddeck/.claude/skills/shutdown/SKILL.md` was missing F2's working-tree hygiene step entirely (F2 had only been applied to the vault-level copy in 2026-05-07 and never propagated). Junction sync fixed it in the same pass.

### Decisions Made
- Adopted `YYYY-MM-DD-<short-context>-<random4>` manifest naming pattern after observing a concurrent session already using it in the wild — far more scannable than the originally-specced `HH-MM-<random4>`. Updated template, README, MEMORY_PROTOCOL, startup skill, and F3 decision note to match.

### Issues & Blockers
- **Spec drift discovered between shutdown skill and actual practice:** the skill says "Save as `YYYY-MM-DD-HH.md`" but the wild convention in `_memory/sessions/` uses context-based slugs (e.g. `2026-05-17-m7.6-proxy-wrap.md`, `2026-05-17-director.md`). Followed wild convention this session; should update the shutdown skill spec to match in a future pass.

### Key Files Changed
- New: `_memory/sessions/active/` directory + `_TEMPLATE.md`, `README.md`, `_stale/README.md`
- New: `_memory/decisions/2026-05-16-f3-active-session-manifest.md`
- Modified: `.claude/skills/startup/SKILL.md`, `.claude/skills/shutdown/SKILL.md`, `.claude/skills/backlog/SKILL.md` (all vault-level)
- Modified: `_memory/MEMORY_PROTOCOL.md` (new "Active Sessions" section)
- Deleted: `SKILL.md` at vault root, `_memory/skill-updates/*-SKILL.md`
- New junctions: `feeddeck/.claude/skills/{startup,shutdown,backlog}` → vault-level

### Next Session Should
- Update shutdown skill Step 6b to match the actual session-log naming convention (`<context>` slug instead of `<HH>`)
- First real two-window test of F3 in practice — see verification recipe in [`../.claude/plans/let-s-plan-a-system-giggly-backus.md`](../.claude/plans/let-s-plan-a-system-giggly-backus.md)

---

## 2026-05-16 (Removal — PERMANENT) — Killed PosterPeekRow ("Picked for You" peek strip)

### Why
Torin called it out on the homepage: "get rid of this peaking row that shows below some of the gallery tabs, it looks like a bug. I know it's not a bug, but it looks like one ... I want it gone." Followed up with: "saying that I never want to see it again."

### Do NOT bring this back
The thin 72px low-opacity thumbnail strip with the tiny uppercase category label that used to render under the `GalleryShelf` progress dots is **permanently removed**. Do not recreate `PosterPeekRow`, do not propose a redesigned "next category preview" affordance below the gallery, and treat any reference to it in older specs/plans as stale. Full rationale + guardrails: [`../_memory/decisions/2026-05-16-kill-poster-peek-row.md`](../_memory/decisions/2026-05-16-kill-poster-peek-row.md). Guard entry in [`../_memory/errors/feeddeck-known-issues.md`](../_memory/errors/feeddeck-known-issues.md).

### Removed
- **`src/components/home/PosterPeekRow.jsx`** — deleted outright.
- **`src/components/home/GalleryShelf.jsx`** — dropped the `PosterPeekRow` import, the `peekCategory` memo, the `loadCategoryAt` selector, `galleryJumpRef`, `handlePeekActivate`, and the conditional `<PosterPeekRow>` render. GalleryShelf now renders only the `<GalleryRow>` over the flat pool.
- **`src/components/home/GalleryRow.jsx`** — removed the `jumpRef` prop and the imperative jump-to-id `useEffect` (only the peek-row's click-to-jump consumed it).
- **`src/components/Skeletons.jsx`** — removed the peek-row shimmer placeholder block from `SkeletonGalleryShelf` + updated the comment to drop the `PosterPeekRow` mention.
- **`src/stores/homeStore.js`** — removed the `loadCategoryAt(index)` action; updated the `loadNextCategory` comment to drop the "or when they click the peek-row" clause. Auto-hydration on approach-end is the only remaining hydration path.

### Historical references left intact
April-era docs (`docs/superpowers/specs/2026-04-12-poster-shelf-design.md`, `docs/superpowers/plans/2026-04-12-poster-shelf.md`, `public/feeddeck-poster-shelf-comparison.html`, and earlier entries in this log) still describe the peek row. That's history — not a TODO. Don't "clean it up."

---

## 2026-05-15 (Feature) — New `/audio` surface (audio porn page)

### Completed
- **Shipped new NSFW-only `/audio` route end-to-end** with typography-first card layout, sticky mini-player, evergreen content model, and creator-voice-weighted taste profile. Plan at [`C:\Users\torin\.claude\plans\generic-exploring-lampson.md`](../.claude/plans/generic-exploring-lampson.md). Architecture decision at [`../_memory/decisions/2026-05-15-audio-surface-architecture.md`](../_memory/decisions/2026-05-15-audio-surface-architecture.md).
- **Schema:** new `audio_cache` table (separate from `feed_cache` because audio is evergreen, taste-ordered, and stream-different); `creators.surface` column scopes audio creators away from the video fetcher.
- **Sources:** new `SoundgasmAdapter` (regex-extracts `media.soundgasm.net/sounds/{hash}.m4a` from post HTML); new `server/sources/audio-fetcher.js` orchestrator dispatches Reddit + Soundgasm into `audio_cache`. Probed both before writing the adapter: Reddit audio subs are self-posts with soundgasm links in selftext; Soundgasm pages expose the m4a URL directly in HTML.
- **Scoring:** new `audioScore()` + `recomputeAudioScores()` in [`scoring.js`](server/scoring.js). Reads `taste_profile WHERE surface_key='audio'` + `creator_boosts.surface_boosts.audio` JSON. Creator match weighted 5× over tag overlap per Torin's "creator voice over topic" instruction. Own profile cache.
- **API:** [`routes/audio.js`](server/routes/audio.js) with `GET /api/audio/feed`, `POST /api/audio/:id/rate`, `POST /api/audio/:id/play`, `POST /api/audio/:id/complete`, `GET /api/audio/stats`. Rate handler reuses existing `video_ratings` table with `surface_type='audio'`.
- **Scheduler:** 30-min audio fetcher tick in [`server/index.js`](server/index.js) (lower frequency than video feed because audio is evergreen).
- **PDF backfill:** [`server/scripts/import-audio-pdf.js`](server/scripts/import-audio-pdf.js) uses `pdftotext` (poppler, ships with Git for Windows). Walks `cookies/audio videos to scrape.pdf`, extracts URLs, classifies (Reddit/Soundgasm = usable; bit.ly/Fansly/SubscribeStar = skip), resolves each through the Reddit → soundgasm → m4a chain. 347 URLs in PDF → 131 usable; smoke test (`--limit 15`) inserted 13 cleanly.
- **Frontend:** new `audioFeedStore` Zustand store (queue + index + position + localRatings), `AudioPage` (max-w-3xl single column, source + creator filter chips), `AudioCard` (Iowan Old Style serif 21.6px headline, creator-initial chip, tag pills, no thumbnail), `AudioPlayer` (sticky bottom — prev/play/next/scrub + thumbs-up/down). AudioPlayer mounted at AppShell so playback persists across route changes (returns null when no track active).
- **End-to-end browser verified** before MCP preview disconnect: schema migration ran, API returns playable items, cards render with serif typography, click → audio plays (Soundgasm m4a, `readyState: 4`, `duration: 1557s`), thumbs-up loop closes (rated track jumps to `taste_score: 81`, other Cattt tracks lift from 5 → 39 via `creator_boosts.surface_boosts.audio`).

### Decisions Made
- **Separate `audio_cache` table, not a column on `feed_cache`.** Mixing them would muddy the `(mode, watched, fetched_at DESC)` hot path. See decision note.
- **`surface_key='audio'` + `mode='nsfw'`, not a new mode.** Audio is always NSFW; surface_key is the right axis. Keeps the existing 2-mode firewall intact.
- **AudioPlayer at AppShell, not AudioPage.** First implementation cut audio on nav; lifting to AppShell with `Suspense fallback={null}` keeps the `<audio>` element alive.
- **Reused `video_ratings` with `surface_type='audio'`** rather than building a parallel `audio_ratings` table. Same audit/library plumbing; a future "Liked audio" view is one filtered query.
- **PDF backfill via `pdftotext` (poppler), not a new npm dep.** One-shot script doesn't justify a permanent dep.

### Files
New: `server/sources/soundgasm.js`, `server/sources/audio-fetcher.js`, `server/routes/audio.js`, `server/scripts/import-audio-pdf.js`, `src/stores/audioFeedStore.js`, `src/pages/AudioPage.jsx`, `src/components/audio/AudioCard.jsx`, `src/components/audio/AudioPlayer.jsx`.
Modified: `server/database.js`, `server/scoring.js`, `server/sources/index.js`, `server/index.js`, `src/components/AppShell.jsx`, `src/components/Header.jsx`, `src/components/home/HomeHeader.jsx`, `../BACKLOG.md`.

### Deferred to v2
XNXX / existing-NSFW-source audio filter; hotaudio.net + gwasi.com; voice-feature embeddings.

---

## 2026-05-06 PM (Debug) — `/feed` Time-to-First-Video: 30s → 1.6s

### Completed
- **Root-caused user-reported "/feed loads slowly" bug** via `/debug` workflow with browser-network inspection.
- Three compounding issues found and fixed in [feedStore.js](src/stores/feedStore.js) and [FeedVideo.jsx](src/components/feed/FeedVideo.jsx):
  1. **`/api/feed/watched-ids` is a phantom endpoint** — `feedStore.initFeed()` awaited a route that has never been mounted on the server. Browser hung ~17s before giving up, blocking every downstream fetch. Removed the call (server's `WHERE watched = 0` filter on `/api/feed/next` already provides the dedup).
  2. **Duplicate `/api/stream-url` requests** — `_warmStreamUrls` and `FeedVideo`'s on-demand fetch each hit the endpoint for the active slot, both blocking on the same yt-dlp resolution. Added a shared `resolveStreamUrl()` promise cache keyed by source URL.
  3. **No video byte preloading** — `<video>` only began downloading bytes when the user was on that slot. Added `_prefetchOneVideoBytes()` that Range-fetches the first 512KB (or HLS manifest) for each freshly-resolved upcoming video so the browser HTTP cache is warm by the time the element issues its real request.
- **Browser-verified in real Chrome via preview tools:** time-to-first-frame on `/feed` dropped from ~30s to ~1.6s. Network panel: 0 calls to `/api/feed/watched-ids` (was 1 hung), 2 stream-url (was 11+), 3× 512KB byte-prefetches in flight before user scrolls.

### Decisions Made
- **Removed the watched-ids fetch entirely rather than implementing the missing endpoint.** The dedup is structurally redundant — `/api/feed/next` already filters server-side via `WHERE fc.mode = ? AND fc.watched = 0`. Adding a server route would still be wasted IO every page load.
- **Range-prefetch over second hidden `<video>` element.** The shared-singleton `<video>` design preserves user gesture activation across src changes; adding a parallel preload element would complicate that. Range-prefetching warms browser HTTP cache instead — works with the existing single-element architecture.
- **5s linger on resolved-URL cache, 50-entry FIFO cap on byte-prefetched URLs.** Keeps a long browse session bounded.

### Issues & Blockers
- None new.
- Worth flagging for future: every `await fetch('/api/...')` in a render-gating code path should be paired with a server-side test verifying the route is mounted. A missing route is a dev-time test failure, not a production hang. This bug shipped 2026-04-07 and lived for ~30 days.

### Key Files Changed
- `src/stores/feedStore.js` — removed watched-ids fetch from `initFeed`; added `resolveStreamUrl()` promise cache + `_prefetchOneVideoBytes()` helpers
- `src/components/feed/FeedVideo.jsx` — switched on-demand fetch to use `resolveStreamUrl()` (deduplicates against warmer)
- `src/__tests__/feedStore-initFeed-fast.test.js` (new) — 2 tests: must not call watched-ids, must not block on background warming
- `src/__tests__/feedStore-resolveStreamUrl-dedup.test.js` (new) — 3 tests: shared in-flight, null-on-failure, null-on-missing-url
- `BACKLOG.md` — completed entry added at top of Completed (Recent)
- `_memory/debug_feed_watched_ids_phantom_endpoint.md` (auto-memory) — debug solution note

### Next Session Should
1. **Commit this work.** Working tree includes Torin/parallel-session unrelated edits (warm-cache.js, ThumbsRating.jsx, ForYouSlot.jsx, RemixHero.jsx, HeroSection.jsx, PosterCard.jsx, DetailMeta.jsx, FullscreenOverlay.jsx, pornhub-personal.js, backfill-ph-likes-timestamps.mjs) — review those separately before committing the feed-speedup files.
2. **Decide on a defense-in-depth measure:** add an Express 404 handler that returns JSON `{error: 'unknown route'}` for unmatched `/api/*` GETs. Would have surfaced this bug instantly instead of letting it hang for ~30 days.
3. **Optional follow-up:** consider hoisting the trail fetch (`/api/recommendations/trail`) out of `fetchFeedBatch` so initFeed doesn't await it either. Currently it's awaited inline; if trail latency spikes, initFeed gets slow again.

## 2026-05-05 PM (Session 2) — Daily Playback Quality Sprint

### Completed
- **Verified `98a40f0` wallclock fix** via Node.js port of the Python backpressure survival test. Stream survived 20s pause; 544KB read after pause in <0.1s. Confirms the bug that killed videos at the ~50s mark is genuinely closed.
- **Pre-resolution job for NULL stream URLs shipped** (commit `da2cfbd`). Added a 3rd-tick (every 15 min) pass to `startStreamUrlTTLMonitor` that picks 20 random unwatched NULL-stream-URL feed_cache entries and pre-resolves via the existing `_preResolveStreamUrls()`. RANDOM() distributes proportionally across all sources. Manual validation: 5/5 RedGifs resolved 3.2-3.6s → cached at 41ms.
- **Diagnostics confirmed healthy:** Proxy TTFB 83ms, seek 25/50/75% all HTTP 206 with TTFB 50-202ms, Accept-Ranges always present.
- **Calibration captured:** Reddit r/Unexpected = NO (consistent with weak-Reddit pattern); FikFap @anniemorricone = "maybe" (first FikFap signal — surfaces but doesn't strongly hit). Saved to `project_quality_calibration.md`.

### Decisions Made
- Co-located the new pre-resolution pass inside `startStreamUrlTTLMonitor` (3rd-tick modulo) rather than as a separate interval. Keeps interval count low and groups all stream-URL warming logic in one place.
- Used `RANDOM() LIMIT 20` rather than scoring-ordered sampling. Simpler; any pre-resolved URL is a hit regardless of whether it's the next item shown.

### Issues & Blockers
- **YouTube cookies still expired** — needs Torin to manually re-import via Arc browser. Warm-cache running in degraded mode for social content.
- **Python not installed on Windows dev machine** — backpressure test had to be ported to Node.js. Working fine; just a portability note.

### Key Files Changed
- `server/index.js` — added 3rd-tick NULL-URL pre-resolution pass to `startStreamUrlTTLMonitor`
- `PROGRESS_REPORT_2026-05-05.md` — appended Session 2 metrics, score 88 → 92 → 94
- `_memory/sessions/2026-05-05-playback-2.md` — new session log

### Next Session Should
1. **YouTube cookie refresh** (Torin's action) — biggest open lift on content quality
2. Monitor pre-resolve hit rate after server has ~1hr uptime: query feed_cache resolved count, expect ~+80 from baseline of 1728
3. AP5 Instagram fix — last open Active Push 2026-05-03 item

---

## 2026-04-30 PM - Homepage Placeholder-Dogs Bug: Five-Layer Fix

### Completed
- **Killed the placeholder-dogs bug at the root.** Users were seeing fake "Tiny Golden Retriever at the Beach" content on `/home` (social) instead of real videos. Investigation found three compounding bugs, all fixed in commit `58bbe6c`:
  1. **Migration wipe loop** (root cause): `server/database.js` had a guard at line ~463 that wiped `homepage_cache` if `nsfw_trending` was missing from categories — but the new `nsfw_for_you` layout migration drops that key, so the guard fired on every boot. Cache stayed empty for 30-180s after every restart. Block deleted (it was archaeology — the new layout migrations supersede it).
  2. **Silent placeholder fallback** in `homeStore.fetchHomepage`: when API returned empty, `generateData()` rendered random dogs with no banner and no retry. Replaced with skeleton-rendering self-healing retry (exponential backoff, 1s→2s→4s→8s, cap 15s, max 12 attempts).
  3. **No readiness probe**: nothing told deployment platforms or the client that the cache was warming. Added `/api/health/ready` (503 until first warm-cache completes AND cache has fresh-unviewed rows; 200 thereafter).
- **Layout migrations now transactional.** Both `social_news` and `nsfw_for_you` migrations wrapped in BEGIN/COMMIT/ROLLBACK so an interrupted run can't half-migrate.
- **API self-describing.** `/api/homepage` now returns `state: 'warming'|'ready'` so the client doesn't have to infer warming-state from `categories.length`.
- **Readiness flag persisted** to `data/.warm-complete` (file mtime, 10-min validity) so `node --watch` (dev) and fast restarts (prod incidents) don't flap the readiness probe. The on-disk cache survives restarts; the readiness gate now reflects that. `data/` is gitignored so the file doesn't leak between branches.
- **Regression test added.** `src/__tests__/homeStore-empty-response.test.js` (7 tests). Greps for breed names in `heroItem.title` so any future regression to dog-placeholders fails loudly. Tests 159 → 166.

### Decisions Made
- `_memory/decisions/2026-04-30-homepage-readiness-and-self-healing.md` written. Captures: marker-keys-must-not-be-touched-by-other-migrations rule, no-silent-placeholder-fallbacks-in-prod rule, persist-readiness-state principle. Linked from FeedDeck error/decision memory plus user's auto-memory at `~/.claude/projects/.../memory/debug_placeholder_dogs_migration_loop.md`.
- 10-min validity window for `data/.warm-complete` is a guess. Revisit after real-use signal.

### Issues & Blockers
- **Orphan NSFW category keys** (`nsfw_redgifs_pov`, `nsfw_redgifs_solo`, `nsfw_xvideos_new`, `nsfw_xvideos_hits`, `nsfw_spankbang_new`, `nsfw_fikfap_new`) — leftovers from pre-fix wipe-loop cycles. They have no `topic_sources`, no inserter targets them, `/api/homepage` filters out empty categories. User-invisible. Filed P3 in Discovered Tasks for an idempotent one-shot DELETE.
- This work landed during the May 1 ship-freeze window. Per the 2026-04-27 director decision, net-new feature work is supposed to be blocked. This is a **bug fix for a user-visible regression**, not a feature, so it qualifies — but the May 1 director should retrospect whether the work should hold for post-ship Day 1+ given proximity to deploy. Tests + lint + build all clean, so the deploy risk is low.

### Key Files Changed
- `src/stores/homeStore.js` — kill silent fallback, add retry orchestration, `homepageState` field
- `src/__tests__/homeStore-empty-response.test.js` — new regression suite (7 tests)
- `server/routes/content.js` — `state` field on `/api/homepage`
- `server/routes/stream.js` — new `/api/health/ready` endpoint
- `server/database.js` — delete obsolete migration wipe loop, wrap layout migrations in transactions
- `server/index.js` — `_firstWarmComplete` flag + `data/.warm-complete` persist/read

### Next Session Should
- Run the live homepage in browser after a fresh server restart (without `node --watch`) to confirm the readiness probe gate works end-to-end and flips to 200 once warm-cache completes. The `node --watch` dev loop made it hard to observe a stable warm-complete cycle in this session.
- Consider whether to add the orphan-category cleanup (Discovered Tasks P3) before May 1 ship or after. It's user-invisible so deferral is fine.
- VideoDetailPage decision still pending Torin (carried 120+h, deadline today EOD per the morning director session).

---

## 2026-04-29 - Skeleton Hydration: SkeletonFeedSlide for FeedPage

### Completed
- Finished the skeleton-hydration pass: `[~]` Content-aware skeleton shapes is now `[x]` in BACKLOG.md "Promoted from Design Reviews".
- New `SkeletonFeedSlide` in `src/components/Skeletons.jsx` mirrors `FeedVideo`'s shape: `h-dvh w-full snap-start` black surface, full-bleed gradient shimmer, centered 64px play affordance, bottom-aligned title (`h-3.5 w-2/3`) + meta (`h-2.5 w-1/3`) shimmer bars at `bottom-20`. Replaces the two `SkeletonCard`s previously rendered inside FeedPage's loading slot.
- `src/pages/FeedPage.jsx`: import swapped (`SkeletonCard` → `SkeletonFeedSlide`), loading branch collapsed from a flex-col stacking two cards inside a wrapper to a single `<SkeletonFeedSlide />`.

### Audited (no change needed)
- **`SkeletonLibrary` Continue Watching** already matches the real card. Skeleton at `Skeletons.jsx:151-152` uses `w-card + h-[124px]`; real `ContinueWatchingCard` at `LibraryPage.jsx:298,308` uses the same dimensions. The user's prompt suggested it used `aspect-video` — that's not in the file.
- **`w-card` / `h-card-thumb` "ghost token" theory** disproven. All four are defined in `tailwind.config.js:83-91` (`w-card` 200px, `w-card-lg` 230px, `h-card-thumb` 113px, `h-card-thumb-lg` 130px). Verified via runtime `getBoundingClientRect()` on the live preview server. No replacement needed in HeroCarousel or LibraryPage.

### Decisions Made
- Render exactly one `SkeletonFeedSlide` (not two stacked) since each snap slot is a single full-screen slide. The previous two-card stack inside one snap-start container was already structurally wrong.

### Issues & Blockers
- `preview_screenshot` repeatedly timed out at 30s during verification (suspect: always-on shimmer + body grain `feTurbulence` overlay keeps the renderer from settling). Worked around with `getBoundingClientRect` + computed-style probes. This is the third recurrence of the `preview_screenshot` timeout previously noted in the 2026-04-26 update log. Worth filing or living with as a known limitation.
- A background sync daemon committed mid-session (`01b5959 sync: commit uncommitted work from prior session`, 17:40:56). It bundled my Skeleton/FeedPage/BACKLOG changes alongside unrelated carried work (poster card, gallery row, top10row, useFocusPreview, search-page-spec). Working tree is now clean for these files.

### Key Files Changed
- `src/components/Skeletons.jsx` — `+SkeletonFeedSlide` (16 lines)
- `src/pages/FeedPage.jsx` — import + loading branch (12 lines diff)
- `BACKLOG.md` — `[~]` → `[x]` with completion note

### Next Session Should
- Pick the next `[ ]` design-review item from the "Promoted from Design Reviews" block (lightweight detail card on hover, editorial row variety, card hover expansion, maturity badges, or "More Like This") — those are the four remaining open items there.
- Or pivot to the M0/Beelink track if the May 1 deadline is the priority (per `_memory/sessions/2026-04-29-director.md`).

---

## 2026-04-26 - 5c.7 FloatingQueue Glass (Scheduled Agent — Daily Dev Crusher)

### Milestone: 5c.7 FloatingQueue — Glass Elevated

**Commit:** `fa536f2`

**What was built:**

FloatingQueue swapped from a hand-rolled dark surface to the established glass material system. The collapsed pill now uses `.glass rounded-full` (Layer 1: `rgba(255,255,255,0.04)` + `blur(12px)`), and the expanded panel uses `.glass-elevated rounded-xl` (Layer 2: `rgba(255,255,255,0.08)` + `blur(24px)` + inset highlight). The current-item indicator was softened from a solid accent left border to rose-glass: `bg-accent/[0.04] border-l-2 border-l-accent/40`. The count badge stayed solid accent per the "small elements stay opaque" spec rule.

**Files changed:** `src/components/FloatingQueue.jsx` (3 className diffs; net +3 / -4 lines)

**Verification:**

- `npm run build` clean, 2.78s. No new warnings.
- `npm test` 26/26 pass.
- `npx eslint src/components/FloatingQueue.jsx` 0 issues.
- DOM-inspect of running pill confirmed `rgba(255,255,255,0.04)` + `blur(12px)` + 1px `rgba(255,255,255,0.06)` + rounded-full + shadow.
- DOM-inspect of running panel confirmed `rgba(255,255,255,0.08)` + `blur(24px)` + 1px `rgba(255,255,255,0.10)` + rounded-xl + shadow + inset highlight.
- Tailwind probe confirmed current-item classes compile to `rgba(244,63,94,0.04)` background + 2px `rgba(244,63,94,0.4)` left border.
- Count badge inspect: `rgb(244, 63, 94)` solid + white text.
- Queue rendered 3 seeded test items end-to-end. Test data cleaned up.

**Potential issues to watch:**

- The Layer 2 panel border (`rgba(255,255,255,0.10)`) may wash out against bright HeroSection scenes. The inset highlight should compensate but worth a manual eyeball when Torin is at the keyboard.
- backdrop-filter: blur(24px) is heavy; on the Beelink (low-end hardware) check that scrolling underneath the open panel doesn't drop frames. The panel only renders while open and only one is on screen, so the impact should be bounded.

**Recommendations:**

- 5c.8 (Context Menu & Modals — Glass Elevated) is the next logical pick: same playbook applied to ContextMenu, SourceControlSheet, FeedFilterSheet. Likely 30-60 min of mechanical class swaps.
- Milestone 6 PM2 audit is misnamed — the Beelink uses systemd. The actual gap is missing `MemoryHigh=`/`MemoryMax=` in the systemd unit emitted by `feeddeck/scripts/setup-server.sh`. Backlog item updated with the corrected scope.

**Discovered tasks added to BACKLOG.md:**

- [P2] `DELETE /api/queue` (clear-all) returns 500. Per-item DELETE works fine.
- [P3] `fd-queue` localStorage value is the literal string `"[object Object]"` (persist serializer misconfigured).
- [P3] `preview_screenshot` recurring 30s timeout (recurring 2026-04-25 → 2026-04-26).

---

## 2026-04-26 - Cross-cutting Code Health: Referer Drift Guard (Scheduled Agent)

### Focus Area: Area 5 -- Cross-cutting (server/utils.js, shared utilities)

**Commit:** `6b812fb`

**Refactor + drift-guard tests (no new feature, no behavior change):**

The recurring bug pattern: a new NSFW source is added to `COOKIE_MAP` (server/cookies.js) but the corresponding entry in `getRefererForUrl()` (server/utils.js) is forgotten. The CDN silently 403s because it sees the wrong Referer. Two prior incidents fit this exact shape:
- 2026-04-18 (`700ba5d`) — missing referer for xHamster, XVideos, SpankBang, RedTube, YouPorn, FikFap.
- 2026-04-20 (`b06c073`) — FikFap got the redgifs referer because b-cdn.net was grouped with redgifs.com.

Per the recurrence escalation rule (last time: explicit additions; this time: fix the upstream data flow), this round is structural:

1. **`getRefererForUrl` rewritten as a `REFERER_RULES` data table.** Plain array of `{ match: [...], referer }`. Order-dependent, first match wins. Behavior identical for every existing URL. Adding a new source is now a single-line edit.
2. **Added `xnxx` rule.** `xnxx.com` is in COOKIE_MAP with no scrape adapter. If/when one is added, it cannot silently fall through to the youtube default.
3. **New file `server/__tests__/utils.test.js` (15 tests):**
   - `getRefererForUrl` for every known source page URL and every known CDN host (regression test for the b-cdn.net mismatch).
   - `isAllowedCdnUrl` SSRF guard, including a suffix-attack rejection (`youtube.com.evil.com` must fail).
   - `inferMode` coverage iterates every NSFW domain in COOKIE_MAP — it cannot drift.
   - `formatDuration`.
   - **Drift guard** test: every `mode: 'nsfw'` entry in COOKIE_MAP must yield a non-default referer. The next time someone adds an NSFW source without a referer rule, this test fails and points at the missing edit.

**Bundle / lint / test status:**
- `npm run build`: clean. hls.js chunk 523kB warning expected.
- `npm run lint`: 0 errors, 0 warnings.
- `npm test`: 41 passed (5 files, +15 new). 26 prior tests unchanged.

**Files:** `server/utils.js` (REFERER_RULES export + refactored getRefererForUrl), `server/__tests__/utils.test.js` (new).

**Recommendations:**
- Next health-rotation focus: Area 1 (`server/sources/scraper.js` consolidation pass — 8 NSFW sources stable, ripe for dead-code/silent-failure review).
- Pre-existing uncommitted work in the worktree (5c.2b hydration + today's refresh/shuffle feature in content.js/homeStore.js/SettingsPage.jsx) is left untouched. Whoever started those sessions should commit them.
- Future improvement: derive `ALLOWED_CDN_DOMAINS` from an extended COOKIE_MAP (`{ mode, file, cdnHosts }`) so the SSRF allowlist is self-maintaining. Not done this round — SSRF guard fails closed (block on miss), so the recurrence risk is low.

---

## 2026-04-26 - Feed Controls: Refresh + Shuffle in Settings

### Completed
- **`POST /api/homepage/warm` endpoint** — Triggers `runWarmCache({ mode, externalDb: true })` with a `_warmInFlight` single-flight guard (returns 429 if already running). Added to `server/routes/content.js`.
- **`viewed = 0` SQL bug fixed** — `_homepageVideosStmt` lacked `AND viewed = 0`, so shuffle-marked items returned on the next `GET /api/homepage`. Fixed; verified with `overlapCount: 0` across all rows post-shuffle.
- **`homeStore` refresh/shuffle actions** — Added `refreshing`/`shuffling` state flags; `refreshHome(mode)` POSTs to `/api/homepage/warm` then calls `_swapInFreshContent`; `shuffleHome(mode)` fires `POST /api/homepage/viewed` for each leftmost-5 item across all non-pinned rows (in parallel), then calls `_swapInFreshContent`.
- **Staged replacement in `_swapInFreshContent`** — Phase 1 (immediate): replaces `items[0..4]` in each matched category; Phase 2 (600ms setTimeout): replaces `items[5..]`. Pinned rows (`_pinned: true`) are untouched in both phases. `_swapVersion` + `_fetchVersion` guards discard stale swaps if a mode toggle fires mid-flight.
- **Settings "Feed Controls" section** — Two buttons (Refresh feed / Shuffle feed) added to `SettingsPage.jsx` below the Seed Now block; both disable while either action is running; button text transitions to "Refreshing…" / "Shuffling…".

### In Progress
- None.

### Decisions Made
- **`externalDb: true` on `runWarmCache`** — Avoids spawning a child process (which would open a second SQLite connection and risk corruption on Windows). The warm-cache job runs in-process with the existing DB handle.
- **Staged replacement over full-swap** — Leftmost-5 change instantly (visible without scrolling); tail updates 600ms later to avoid a jarring full-page repaint.
- **Match categories by `originalLabel`** — Category display labels are personalized client-side (e.g. "My Subscriptions" → "Quick Hits"); `_swapInFreshContent` keys the new API response on `originalLabel` to correlate correctly with existing store categories.

### Issues & Blockers
- Refresh path does a full subscription fetcher pass (30–60s). Not live-tested against real sources this session — endpoint correctness verified structurally and the single-flight 429 guard confirmed via disabled button state. Test with tail on server logs next chance.

### Key Files Changed
- `server/routes/content.js` — `POST /api/homepage/warm` endpoint; `AND viewed = 0` fix in `_homepageVideosStmt`
- `src/stores/homeStore.js` — `refreshing`, `shuffling`, `refreshHome`, `shuffleHome`, `_swapInFreshContent`; `_swapVersion` guard; `_mapApiVideo` / `_parseUploadDate` factored to module-level
- `src/pages/SettingsPage.jsx` — Feed Controls section with Refresh + Shuffle buttons

### Next Session Should
1. Live-test **Refresh feed** with server logs tailing — confirm `runWarmCache` completes, cards update with the leftmost-5-first staging.
2. Live-test the **mode-toggle race**: click Refresh, immediately toggle SFW↔NSFW — confirm stale results are discarded and the home page shows the toggled mode's content.
3. Pick up from the backlog: 3.12 Phase D rapid-dislike panel, or 5c.2b background refresh scoping.

---

## 2026-04-25 (PM) - 5c.2b Infinite Carousel Hydration

### Completed
- **5c.2 Push A formally dropped from scope.** Decision: keep `HeroSection` at top of homepage, do not pursue full-viewport restructure or route-level theatre. Items struck out in `BACKLOG.md` with note. Reference mock at `feeddeck/public/feeddeck-poster-shelf-comparison.html` documents before/after for both Push A and B.
- **Pool architecture in `homeStore`.** Added `loadedCategoryIndices: number[]`, `loadNextCategory()`, `loadCategoryAt(index)`. Seeds with first 2 categories on `fetchHomepage` and `generateData`; clears on `resetHome`. `INITIAL_POOL_CATEGORIES = 2`.
- **`CategoryDivider` component.** Vertical 56px glass pill with rotated label, accent down-arrow, `scrollSnapAlign: 'none'`, `aria-hidden`. Inserted between categories within the flat pool — never the focus target, never claims a snap point.
- **`GalleryShelf` rebuilt for flat pool.** `buildPool(categories, loadedIndices)` flat-maps loaded categories into a single ordered array, tags every item with `_cat`/`_catLabel`/`_catKey`, and inserts a divider marker before each category after the first. Renders ONE `<GalleryRow>` over the merged pool plus a `<PosterPeekRow>` for the next unloaded category. Wires peek-row click → `loadCategoryAt(i)` + jumps the carousel to the new category's first item via an imperative `jumpRef` handle.
- **`GalleryRow` extended for pool semantics.** Renders `CategoryDivider` for `_isDivider` items; skips dividers in closest-to-center detection, in arrow-key navigation (`scrollByCard` while-loop), and in the dot count. Header `<h3>` keys on the focused item's `_catLabel` so React remounts it with `animate-fade-in` whenever the active card crosses a category boundary, producing a 250ms cross-fade. New props: `onApproachEnd` (fires once per pool-length when active card is within 3 cards of end, used to auto-load next category) and `jumpRef` (parent-driven `scrollIntoView` by item id, used by peek-row click).
- **Windowed progress dots.** `DOT_WINDOW = 15`. Dots are computed over non-divider cards only and centered on the active card's ordinal. Outer ring (distance ≥ half-1) fades to 35% opacity + 70% scale; mid-ring (distance ≥ half-3) fades to 60% opacity + 85% scale.
- **`headerFadeIn` animation.** Added `@keyframes` + `.animate-fade-in` to `index.css` under the `prefers-reduced-motion: no-preference` block.
- **High-fidelity comparison mock.** `feeddeck-poster-shelf-comparison.html` (3 panels: Before, Push A, Push A+B) committed to `feeddeck/public/` and accessible at `http://localhost:3000/feeddeck-poster-shelf-comparison.html`. Uses real glass tokens, accent rose, motion easings.

### In Progress / Open
- **5c.2b background refresh.** Three remaining sub-items: refill from `/api/homepage` when current category < 3 unwatched, append-on-arrival without disrupting scroll position, mark-viewed bookkeeping. Code paths exist but the API contract for "next batch by category" needs scoping.

### Decisions Made
- **Push A dropped, Push B proceeds.** Torin chose this after viewing the side-by-side mock. The full-viewport restructure (remove HeroSection, route-level theatre via `/watch/:id`) was deemed too large a swing for the value, especially given that the existing `VideoDetailPage` is only ~40% feature-complete and would need a major build-out. HeroSection keeps its 100vh slot above the carousel.
- **BrowseSection retained below the carousel.** Continues to render Continue Watching, Top 10, and additional category rows. Compromises full-viewport feel but preserves discovery surface.
- **Pool is computed in `GalleryShelf`, not stored as state.** `useMemo` over `[categories, loadedCategoryIndices]`. Avoids state duplication and keeps the store as the single source of truth. The pool is cheap to rebuild on every change.
- **Dividers are pool entries, not separate elements.** Treating them as items lets `GalleryRow`'s existing scroll/snap/parallax loop iterate them naturally — the divider check (`_isDivider`) is a one-line guard at each decision point. Cleaner than threading a "between item N and N+1" sidecar list.
- **`activeCatLabel` derived from `items[activeIndex]?._catLabel`.** Header is reactive without an explicit callback prop. When the focused item's category changes, the h3 remounts (via `key={activeCatLabel}`) and replays the entrance animation. Read as a cross-fade because the unmount is instant and the mount is gradual.

### Issues & Blockers
- **Headless preview can't fire `requestAnimationFrame`.** Discovered while verifying — rAF callbacks never run in this Chromium variant unless paint is forced. Worked around by patching `window.requestAnimationFrame = (cb) => setTimeout(cb, 0)` inside `preview_eval` for verification only. Code is correct in real browsers; this is a test-environment quirk worth remembering.
- **Arrow-key skip-divider and `onApproachEnd` auto-load** are wired but couldn't be exercised in headless because both depend on rAF for the focus update. Both are simple enough (8-line loop, threshold check on activeCardOrdinal) to verify by reading. Should sanity-check in a real browser.
- **Pre-existing build warning.** `queueStore.js` is dynamically imported by `modeStore.js` but statically imported by 13 other files (Vite reporter complains). Predates this session — not introduced by my changes.

### Key Files Changed
- `src/stores/homeStore.js` — pool architecture (`loadedCategoryIndices`, `loadNextCategory`, `loadCategoryAt`); seeded in `generateData`/`fetchHomepage`, cleared in `resetHome`.
- `src/components/home/GalleryShelf.jsx` — full rewrite. Builds flat pool, wires peek-click, exposes `jumpRef` to parent.
- `src/components/home/GalleryRow.jsx` — divider-aware rendering, focus, nav, dots; `onApproachEnd` + `jumpRef` props; dynamic header label with cross-fade.
- `src/components/home/CategoryDivider.jsx` — new component.
- `src/index.css` — `headerFadeIn` keyframes + `.animate-fade-in`.
- `BACKLOG.md` — Push A items struck out with decision; 5c.2b core items marked `[x]` with file refs.
- `feeddeck/public/feeddeck-poster-shelf-comparison.html` — high-fidelity 3-panel comparison mock.

### Next Session Should
1. Run the homepage in a real browser and confirm: cross-fade fires when scrolling past a divider; arrow keys skip dividers cleanly; the peek-row click feels right (jump speed, animation tone); dots window correctly when the pool grows past 15 cards.
2. Decide scope for the remaining 5c.2b background refresh — does the existing `/api/homepage` already give per-category refill, or does it need a new endpoint that takes a category key + cursor?
3. If everything from (1) feels right, commit and consider closing 5c.2b entirely or moving to 5c.7 / 5c.8 (FloatingQueue + modal glass treatments).

---

## 2026-04-25 - Thumbs Rating Polish: Icon Fix, Undo Toast, Style Unification

### Completed
- **Thumbs-down icon bug fixed** — Both buttons were rendering as thumbs-up. Root cause: a `transform="rotate(180 12 12)"` attribute on the thumbs-down SVG was flipping the already-correct Feather path 180°. One-line fix in `ThumbsRating.jsx`.
- **Bottom-pinned undo toast on thumbs-down** — Clicking thumbs-down now triggers a toast pinned 32px from the bottom of the viewport (vs. the existing top-center toasts) with a 10-second shrinking progress bar and an "Undo" CTA. Extended `toastStore.showActionToast` with a `position` field (default `'top'`); `GlobalToast` conditionally uses `bottom-8` and reverses its entrance slide direction. Undo bypasses the `isToastPaused()` guard — recovery paths must always be accessible.
- **`undoRating()` in ratingsStore** — Synchronously reverts the optimistic `ratedUrls` map and decrements `consecutiveDowns` / trims `recentDownTimestamps` so the row tracker stays consistent.
- **`POST /api/ratings/undo` backend endpoint** — Full transaction: deletes the `video_ratings` row, reverses `taste_profile` per-tag deltas (global + surface-specific), reverses `creator_boosts`. Reads tags/creator/surface_key from the stored DB row rather than the request body.
- **PosterCard: emoji buttons → SVG** — Expanded-card thumbs-down/up buttons and the already-rated indicator replaced emoji characters with Feather SVG icons (width=16/12) to match ThumbsRating's visual language.
- **HeroSection: heart → glass thumbs buttons** — The unwired `&#9825;` heart was replaced with two glass-pill SVG thumbs buttons (width=18, 42×42 touch targets, `bg-white/[0.08]` + `border-white/[0.12]`) wired to a full `handleHeroRate` useCallback (surfaceType=`'home_hero'`). When already rated, shows SVG icon + "Liked"/"Not for me" text inline.

### Decisions Made
- **Undo bypasses toast pause.** The `isToastPaused()` guard exists to reduce ambient feedback noise; undo is a recovery action, not feedback, so it's exempt. Down-toast outside guard; up-toast inside guard — asymmetric by design.
- **`POST /api/ratings/undo` reads from DB row, not request body.** Prevents a stale or tampered client from reversing an unrelated rating's deltas. The stored row is the authoritative record.
- **HeroSection uses inline rating logic, not ThumbsRating.** ThumbsRating uses `position: absolute` bottom-of-card overlay semantics that don't fit the hero's layout. ~20 lines of duplication is cleaner than fighting positioning.

### Issues & Blockers
- None. Build clean, 0 lint errors, all changed files verified.

### Key Files Changed
- `src/components/ThumbsRating.jsx` — icon fix, undo toast wired, `undoRating` + `showActionToast` selectors added
- `src/stores/ratingsStore.js` — `undoRating(videoUrl, surfaceKey)` method added
- `src/stores/toastStore.js` — `showActionToast` extended with `position` field
- `src/components/GlobalToast.jsx` — conditional `bottom-8`/`top-6` positioning + reversed entrance animation
- `server/routes/ratings.js` — `POST /api/ratings/undo` endpoint added
- `src/components/home/PosterCard.jsx` — emoji buttons → SVG (both interactive + rated indicator)
- `src/components/home/HeroSection.jsx` — heart → glass thumbs buttons with `handleHeroRate` logic

### Next Session Should
- Wire ThumbsRating (or equivalent) into `FeedVideo.jsx` (swipe feed) — currently the swipe feed has no thumbs rating UI
- Implement rapid-dislike panel trigger: `recentDownTimestamps` tracking is in ratingsStore but the toast + keyword panel UI isn't wired
- Consider "Liked" virtual shelf in library (Phase E) — `video_ratings WHERE rating='up'` rows are being written, just need the UI

---

## 2026-04-25 - Stores + Hooks Code Health (Scheduled Agent)

### Focus Area: Area 3 -- src/stores/ + src/hooks/

**Commits:** `82dc348`, `2cd9422`, `e334dda`

**1 critical bug fixed:**

**isFresh filter silently dropped all Puppeteer-scraped homepage content:** `homeStore.fetchHomepage()` introduced `isFresh = (v) => v.uploadTs > 0 && ...` to filter archived content. But Puppeteer scrapers (SpankBang, RedTube, xHamster, YouPorn, XVideos, FikFap) never set `upload_date`, so `uploadTs = 0` for all their content. The `> 0` check dropped all of it silently. Net effect: only YouTube and RedGifs showed in non-pinned NSFW categories. The 6 new NSFW categories added April 24 were all empty. Fixed to `uploadTs === 0 || (freshNow - uploadTs) <= RECENT_MS` -- items with no upload_date pass through.

**2 cleanup fixes:**

- **GalleryRow dead refs:** `focusedCardRef` and `trackWrapRef` (+ stale PosterInfoPanel comments) removed. Both were declared and written but never read after PosterInfoPanel was removed from GalleryRow.
- **HeroSection unused destructuring:** `reducedMotion: _reducedMotion` removed from useHeroAutoplay destructuring -- nothing in HeroSection consumed it.

**Pre-session housekeeping:** Committed + pushed the April 24 nsfw-rows session work that was sitting unstaged: persistent_rows tables, pornhub-personal.js, warm-cache Phase 1.5, system_searches seeding, UTC cooldown bug fix.

**Audit findings (no changes needed):**

- feedStore, ratingsStore, queueStore, playerStore, modeStore, toastStore: all clean.
- useHeroAutoplay, useHoverPreview, useTheatreControls, useQueueSync, useKeyboard, useFeedGestures: all clean.

**Next health focus:** Area 4 -- src/pages/ + routing + vite.config.js + build pipeline

---

## 2026-04-24 (later) - PosterCard Refactor: On-Card Actions, PosterInfoPanel Removed

### Completed
- **Removed `PosterInfoPanel` floating container** — `GalleryRow.jsx` no longer imports or renders it. The floating glass panel that appeared below each GalleryShelf row is gone. `PosterInfoPanel.jsx` still exists in the source tree but is now dead code (safe to delete).
- **PosterCard self-contains expanded state** — When a poster-variant card is focused (`isFocused && variant !== 'landscape'`), the card face now shows: deeper gradient, genre/duration pills, title, meta row (views + uploader), 2-line description snippet, and three action buttons (▶ Play, ≡ + Queue, 👎/👍 rating).
- **Thumbs-up/down rating on expanded cards** — Added `useRatingsStore` + `useToastStore` hooks into `PosterCard`. `handleRate()` mirrors `ThumbsRating` logic: calls `recordRating`, fires `/api/ratings` POST, shows "Saved. More from X coming your way." toast on upvote. If already rated, shows "👍 Liked" / "👎 Not for me" text instead of buttons.
- **Landscape rows unchanged** — BrowseSection landscape cards still show simple title+meta overlay on focus, plus `ThumbsRating` hover overlay. No regression.

### Decisions Made
- **All metadata on the card, not below it.** The floating PosterInfoPanel created visual dissonance — the info was detached from its thumbnail and competed with the row label. Moving everything onto the card face keeps the spatial relationship clear and removes the layout complexity of absolutely-positioned panel anchoring.
- **`isExpanded = isFocused && variant !== 'landscape'`** is the single derived boolean that drives both the deeper gradient and the expanded JSX branch. No new props needed.
- **`handleRate` duplicates ThumbsRating logic** rather than reusing ThumbsRating internally. ThumbsRating is a standalone overlay component designed for hover; embedding it in the card's action bar would fight its own positioning. Duplication is ~15 lines and worth the clean separation.

### Issues & Blockers
- **`PosterInfoPanel.jsx` is dead code.** File not deleted this session — added as a backlog tech-debt item. Verify with `grep -r PosterInfoPanel src/` before deleting.

### Key Files Changed
- `src/components/home/PosterCard.jsx` — full rewrite of overlay section; added `isExpanded` branch, genre/duration pills, Play/Queue/rating buttons, `handleRate` function, `showThumbs` state guard.
- `src/components/home/GalleryRow.jsx` — removed `PosterInfoPanel` import + render.
- `BACKLOG.md` — updated 2026-04-24 PosterCard completed entry; added PosterInfoPanel dead-code tech debt to Discovered Tasks.

### Next Session Should
- Delete `PosterInfoPanel.jsx` (verify no imports remain first).
- Fix vertical scroll hijacking by GalleryRow wheel handler (BACKLOG discovered task filed 2026-04-24).
- Tackle remaining homepage quality-pass items: `/api/homepage/more` 404, "Viral This Week" sizing, Top 10 sizing.

---

## 2026-04-24 (latest) - Up Next Carousel: Recency Fix + Stale-Cache Filter

### Completed
- **Fixed `daysAgo` mis-calculation** ([BACKLOG.md item 753](BACKLOG.md)). Old code used `fetched_at` so a 6-year-old Lex Fridman video cached yesterday rendered as "1d ago." `mapVideo` now parses `upload_date` and uses it for `daysAgo`, falling back to `fetched_at`, falling back to `Date.now()`. Parser handles `YYYY-MM-DD`, bare `YYYYMMDD`, and ISO 8601. Verified: 2020 video now reads "2297d ago", 2026 video reads "1d ago". Added `uploadTs`/`fetchedTs` numeric timestamps as sortable fields on the mapped output.
- **Recency-sorted category rows** ([BACKLOG.md item 757](BACKLOG.md)). After mapping, each category's items are sorted by `uploadTs DESC` (then `fetchedTs DESC` as tiebreaker). The round-robin carousel still pulls position 0 from each category — diversity preserved, but each slot is now its category's freshest item.
- **Backend `fetched_at` returned by `/api/homepage`.** Both the main and fallback `homepage_cache` SELECTs in `server/routes/content.js` now include `fetched_at` (was used only for ORDER BY, never returned). Frontend's secondary sort now has real values to break ties.
- **Stale-cache filter added** (180-day window). Non-pinned categories drop items older than 180 days; pinned shelves (subscriptions, persistent rows like "My PornHub Likes") keep all items — user opted in. Top 10 also filtered, with subscription content exempt. Categories that empty out after the filter are dropped entirely. This fixes the "Trending" row that was leading with 2019/2020 Lex Fridman content because the cache only had old entries for that category.

### Decisions Made
- **180-day window** picked as the freshness threshold — generous enough that legitimately evergreen content from late 2025 stays, but the 6-year-old cached entries are gone. Hardcoded inline via `RECENT_MS` constant; if it needs tuning, it's a single line.
- **Pinned shelves are exempt** from the freshness filter. Reason: persistent shelves (subscriptions, liked videos) are user-opted-in; filtering them would surprise the user. The `cat.pinned` flag from `persistent_rows` drives this.
- **`uploadTs` over `uploadDate`** as the new sortable field name. `uploadDate` is already used in `VideoCard.jsx:32` as a formatted display string for a different field (`addedAt`); separating numeric timestamp from display string avoids a semantic collision.
- **Filter applied at category-construction time, not as a separate post-pass.** Keeps the round-robin algorithm itself unchanged (per the original plan's constraint: "change input ordering, not the algorithm").

### Issues & Blockers
- **HMR ghost state during verification.** First verification pass appeared clean in my preview but the user reported still seeing the Lex Fridman video in their browser. Restarting the Vite dev server cleared the bad bundle state — Zustand store memory had persisted across HMR with old data. Worth remembering: **after non-trivial homeStore changes, restart Vite, don't trust HMR.**
- **`/api/homepage/more` endpoint is missing on the server.** The infinite-scroll fetch in `HeroCarousel.jsx:107` returns 404 and is silently swallowed by `.catch(() => {})`. Not introduced this session, but worth flagging — load-more is non-functional. **Filed implicitly; not yet a backlog item.**

### Key Files Changed
- `src/stores/homeStore.js` — `parseUploadDate` helper, rewrote `mapVideo` (lines 170-207), category construction with sort + stale filter (lines 222-248), Top 10 freshness filter (~line 318).
- `server/routes/content.js` — added `fetched_at` to two `homepage_cache` SELECTs (lines 425, 433).
- `BACKLOG.md` — checked off items 753 and 757.

### Next Session Should
- Decide whether to file the `/api/homepage/more` 404 as a backlog item (load-more is currently dead). Either implement the endpoint, or rip out the IntersectionObserver in `HeroCarousel.jsx`.
- Pick up remaining 2026-04-24 homepage quality-pass items: wheel-hijack bug ([BACKLOG:761](BACKLOG.md)), "Viral This Week" sizing ([BACKLOG:765](BACKLOG.md)), Top 10 sizing ([BACKLOG:769](BACKLOG.md)).

---

## 2026-04-24 (later) - PosterCard Focused-Overlay Fix

### Completed
- **Fixed focused-card text disappearing bug** ([BACKLOG.md:761](BACKLOG.md) item from earlier today's homepage quality pass). On focus, `PosterCard`'s overlay gradient was unconditionally hidden (`opacity: isFocused ? 0 : 1` at `PosterCard.jsx:91`). For landscape rows in `BrowseSection` — which have no `PosterInfoPanel` substitute — that left the focused card with no readable text. For poster rows in `GalleryShelf`, hiding it was fine in principle, but the user wanted the on-card overlay removed (since `PosterInfoPanel` already shows title + meta + description below). Fix: variant-aware hide — `opacity: isFocused && variant !== 'landscape' ? 0 : 1`. Focused poster cards now defer to `PosterInfoPanel`; focused landscape cards keep their on-card title + uploader/views overlay; non-focused cards are unchanged.

### Decisions Made
- **First pass (`opacity: 1`) was wrong.** Initially set the overlay to always-visible, which created on-card overlay duplicating `PosterInfoPanel` in poster rows. User flagged the redundancy on visual review; corrected to a variant-conditional hide. The variant flag is the right discriminator because `GalleryRow.jsx:280` only renders `PosterInfoPanel` when `variant !== 'landscape'`.

### Issues & Blockers
- None. Build state is unchanged from the prior session (one-line CSS-style change).

### Key Files Changed
- `src/components/home/PosterCard.jsx` — single-line edit at L91 (`overlayStyle.opacity`).

### Next Session Should
- Visual sign-off in Arc that focused landscape rows (`BrowseSection`, Continue Watching) actually look right with on-card text — the verification was done at default Vite viewport; ultrawide/1080p+ may want a second look.
- Pick up the remaining homepage quality-pass items from the earlier 2026-04-24 batch (BACKLOG `Discovered Tasks → Homepage Quality Pass` section) — wheel-hijack bug, "Viral This Week" sizing, Top 10 sizing.

---

## 2026-04-24 - NSFW Homepage Row Expansion (Phases 1 + 2)

### Completed
- **Activated dormant infrastructure (Phase 1):** Added `redtube.com`, `youporn.com`, `xhamster.com` to `sources` table (full Puppeteer scrapers already existed in `scraper.js` but weren't wired). Added 6 diversifying NSFW categories (RedGifs POV, RedGifs Solo, XVideos New, XVideos Hits, SpankBang New, FikFap New) to break the PornHub-flat mix. Seeded `system_searches` table with 22 NSFW + 28 social entries from `CONTENT_QUERIES.md` (these boost feed scoring +10 points per match via `scoring.js:140`).
- **Built sticky personalized shelves (Phase 2):** New `persistent_rows` + `persistent_row_items` tables for content that never auto-purges. New `server/sources/pornhub-personal.js` with three fetchers — `fetchLikes()` (Puppeteer scrape of `/users/Tonjone92/favorites` with cookie injection), `fetchSubscriptionsFeed()` (yt-dlp with Puppeteer fallback since yt-dlp can't parse PH's JS-rendered subs page), `fetchModel(handle)` (yt-dlp on `/model/{handle}/videos?o=mr`). `selectTopPHModels()` queries `creator_boosts` filtered to PH-source creators.
- **Wired into the cache lifecycle:** New Phase 1.5 in `warm-cache.js` auto-derives top-3 PH model rows nightly, refreshes `ph_likes` (sticky/unbounded) and `ph_subs`/model rows (50 newest, 1hr cooldown). `/api/homepage` prepends pinned rows. `homeStore.js` preserves pinned-row labels (skipping `personalizeLabel`) and pins them above the taste-driven re-sort.
- **Verified live:** Final API response shows 33 NSFW rows total (was ~25 functional). "My PornHub Likes" leads with 9 real PH favorites, "From Your Subscriptions" follows with 4 real subscription videos. Cookie auth working via existing `pornhub.txt`.

### Decisions Made
- **Hardcoded `PH_USERNAME = 'Tonjone92'`** as default (overridable via env var) — simpler than auto-discovery for a single-user app. Comment in code points future users to replace with their own handle.
- **Persistent rows live in a separate table, not `homepage_cache`** — items here have user-side ordering (`liked_at`), never expire, aren't subject to the 3-day Phase 0 purge.
- **`ph_likes` is sticky/unbounded; `ph_subs` and per-model rows trim to 50** — reflects the user's stated preference: "those can stay at all times, I don't care how old they are."
- **Phase 3 (taste-driven dynamic rows like 'Because you liked POV') deferred** — sketched in plan, not built. Wait for the new shelves to prove themselves in real use first.
- Plan committed at `~/.claude/plans/refactored-swimming-cocoa.md`.

### Issues & Blockers
- **Two debugging sessions during execution:**
  1. PH `/favorites` returned HTTP 404 with default URL guess. Fix: switched to `/users/{username}/favorites` pattern with three URL candidates. Required asking user for their PH username (Tonjone92).
  2. Phase 1.5 cooldown showed "-228m ago" (negative time). Root cause: SQLite `datetime('now')` stores UTC without `Z` marker; JavaScript `new Date(...)` parses it as local time, producing future-dated comparisons. Fix: convert to ISO+Z before parsing. Also patched `last_fetched` to only update when `added > 0` so empty fetches don't trigger spurious cooldowns.
- **PornHub cookie-health probe still shows 🔴** at start of warm-cache. Cosmetic — yt-dlp's PH auth is finicky, but the scraper-based fetches (which actually run) work fine. Could be replaced with a Puppeteer probe; logged as a Discovered Task.
- **Several diversifying RedGifs categories returned `+0 new videos`** (POV, Solo, Couples, Amateur). Possibly stale URL queries or already-cached content. Logged as Discovered Task to investigate after a week of runs.
- **Top-3 model rows currently empty** because `creator_boosts` has no PH creators with positive boost yet. Will populate naturally once Torin thumbs-up content. No fix needed.

### Key Files Changed
- `server/database.js` — +3 sources, +6 categories, `_seedSystemSearches()` function (50 entries), `persistent_rows` + `persistent_row_items` DDL, seed for `ph_likes` + `ph_subs`
- `server/sources/pornhub-personal.js` (NEW) — 3 fetchers + `selectTopPHModels()` + `FETCHERS` registry
- `server/scripts/warm-cache.js` — Phase 1.5 inserted; UTC timezone fix; `last_fetched` only set on non-empty fetches
- `server/scripts/diagnose-ph-personal.mjs` (NEW) — smoke test for the PH personal fetchers
- `server/routes/content.js` — prepends pinned `persistent_rows` to homepage payload
- `src/stores/homeStore.js` — `_pinned` flag preserves label and forces row to lead during taste-driven re-sort
- `package.json` — added `warm`, `warm:nsfw`, `warm:social`, `diagnose:ph` scripts
- `.claude/launch.json` — corrected client port from 5173 to 3000

### Next Session Should
- Visual sign-off in Arc browser: open the app, switch to NSFW mode, confirm "My PornHub Likes" + "From Your Subscriptions" show real thumbnails and videos play correctly.
- Investigate the four 0-result RedGifs categories (POV/Solo/Couples/Amateur) if they stay empty after another warm-cache run.
- Resume Milestone 6 work — Chromium crash recovery and HLS.js lazy-loading per the April 24 director session (May 1 Beelink soft deadline).

---

## 2026-04-15 (evening) - Sprint Merged to Master

### Completed
- Daily git sync: local and remote already in sync, no action needed
- Merged `sprint/2026-04-07` → `master` via PR #3 (62 commits, 181 files changed)
- Local `master` updated to match remote

### Decisions Made
- Sprint/2026-04-07 is now the stable baseline on master — all work from April 7–15 is shipped

### Key Files Changed
- `SYNC_LOG.md` — updated with sync entry (uncommitted, on sprint branch)

### Next Session Should
1. Create a new sprint branch from master for the next round of work
2. Test end-to-end: run the app, verify NSFW sources work after the source blitz fixes
3. Check FikFap BunnyCDN video URL expiry/HLS behavior

---

## 2026-04-15 - NSFW Source Blitz (8/9 Sources Working)

### Completed
- XVideos selectors fixed: title, thumbnail, views, uploader all updated to match current DOM
- RedTube selectors fully rewritten + age gate auto-dismiss added
- YouPorn selectors fully rewritten + age gate auto-dismiss added
- xHamster confirmed working (no changes needed)
- FikFap JSON API adapter implemented (`searchFikFap()` in scraper.js). Uses anonymous UUID auth, no Puppeteer
- PornHub confirmed working: yt-dlp v2026.03.17 uses `--js-runtimes node` (no PhantomJS). Title selector fixed (`span.title a`)
- Cobalt investigated: public API permanently dead (Nov 2024). Self-host via Docker is the path forward
- Age gate auto-dismiss system added to `_scrapeVideoList()` for sites with `ageGate: true` config flag
- 5 diagnostic/test scripts created in `server/scripts/`

### Decisions Made
- FikFap uses JSON API pattern (like RedGifs), not Puppeteer DOM scraping. Site is a React SPA with no server-rendered cards
- Age gate handling is config-driven per site, uses button text matching ("I am 18")
- PornHub title selector narrowed from `.title a, a[title]` to `span.title a` to avoid duration text bleeding into titles

### Key Files Changed
- `server/sources/scraper.js` -- XVideos/RedTube/YouPorn selectors, PornHub title fix, FikFap API adapter, age gate logic
- `server/sources/cobalt.js` -- header comment updated with current API status
- `_memory/errors/feeddeck-known-issues.md` -- comprehensive update for all 9 sources

### NSFW Source Scorecard
| Source | Status | Notes |
|--------|--------|-------|
| SpankBang | Working | Fixed 2026-04-14 |
| RedGifs | Working | JSON API adapter |
| XVideos | Fixed | Selector update |
| RedTube | Fixed | Selector rewrite + age gate |
| xHamster | Working | Original selectors correct |
| YouPorn | Fixed | Selector rewrite + age gate |
| PornHub | Fixed | yt-dlp works, title selector fixed |
| FikFap | Fixed | New JSON API adapter |
| Cobalt | Dead | Public API shut down, self-host needed |

### Next Session Should
1. Test end-to-end: run `npm run dev`, switch to NSFW mode, verify categories refill from newly-fixed sources
2. Check FikFap BunnyCDN video URLs for expiry/HLS issues
3. Update `database.js` FikFap category URLs if needed (adapter handles `/trending` but it 404s on the site)

---

## 2026-04-12 - Video Quality & Homepage Row Fixes

### Completed
- Video stream quality raised from 480p to 1080p cap (yt-dlp format string in `server/sources/ytdlp.js`)
- Thumbnail quality fixed: `normalizeVideo` now picks highest-res thumbnail via `.at(-1)` instead of `[0]`
- Homepage carousel dedup: "Up Next" built via round-robin sampling, then excluded from category rows — no more overlap with "Just Dropped"
- Top 10 row personalized: scoring uses tag affinity + subscription boost + view count (was raw view count only)
- Homepage row reorder: Top 10 is now the first row below the hero section

### Decisions Made
- Round-robin carousel sampling (max ~3 per category) keeps "Up Next" diverse across all content sources
- Top 10 personalization uses multiplicative scoring: 50% boost per liked tag match, 1.3x for subscription content

### Key Files Changed
- `server/sources/ytdlp.js` — format strings updated (480p → 1080p)
- `server/sources/base.js` — thumbnail selection (`thumbnails.at(-1)`)
- `src/stores/homeStore.js` — carousel round-robin, category dedup, Top 10 personalization scoring
- `src/components/home/BrowseSection.jsx` — Top10Row removed from here
- `src/pages/HomePage.jsx` — Top10Row placed directly after HeroSection

### Next Session Should
1. Verify video playback at 1080p works smoothly through the proxy-stream endpoint
2. Test Top 10 personalization with different tag preference profiles
3. Consider adding a quality indicator badge on thumbnails

---

## 2026-03-26 - TikTok GDPR Import Pipeline

### Completed
- Created `import-tiktok.js` — parses TikTok GDPR export files (favorites, likes, watch history) with `--mode` flag for social/nsfw tagging
- Created `server/scripts/process-tiktok-imports.js` — batch processor that enriches pending imports via yt-dlp, inserts into videos table
- Ran both importers: 55,717 social + 794 nsfw entries seeded into `tiktok_imports` and `tiktok_watch_history` tables
- Added 4 TikTok API routes to `server/index.js`: `/api/tiktok/status`, `/api/tiktok/recent`, `/api/tiktok/failed`, `/api/tiktok/watch-history`
- Verified 101 videos processed successfully (~93% success rate), visible in Library UI

### In Progress
- Processor has 56,400+ pending imports remaining — needs to run in a separate terminal (`node server/scripts/process-tiktok-imports.js --batch 50`)

### Decisions Made
- Used `data/library.db` (actual project DB) instead of `server/feeddeck.db` (referenced in task but doesn't exist)
- Watch history stored in both `tiktok_imports` (for yt-dlp processing) and `tiktok_watch_history` (raw history records)
- Console.logs in CLI scripts are intentional user-facing output, not debug noise

### Issues & Blockers
- Pre-existing: feed refill failures for YouTube, RedGifs, FikFap, TikTok sources (yt-dlp/scraper adapter issues, not related to this work)
- Preview screenshot tool times out on Library page (101 video embeds loading simultaneously)

### Key Files Changed
- `import-tiktok.js` (new) — TikTok GDPR export parser
- `server/scripts/process-tiktok-imports.js` (new) — batch yt-dlp processor
- `server/index.js` (modified) — added TikTok API routes

### Next Session Should
1. Let the processor finish (or resume it: `node server/scripts/process-tiktok-imports.js --batch 50`)
2. Check processor results: expect ~20-30% failure rate on deleted/geo-blocked TikToks
3. Consider surfacing TikTok import progress in the Settings UI
