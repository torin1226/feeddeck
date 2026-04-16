# FeedDeck Update Log

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
