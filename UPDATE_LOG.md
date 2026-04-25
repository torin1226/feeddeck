# FeedDeck Update Log

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
