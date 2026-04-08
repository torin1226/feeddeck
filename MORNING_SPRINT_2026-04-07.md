# Morning Sprint Report - April 7, 2026

## Backlog Status Summary

**Milestones 1-4:** Fully complete. Desktop MLP, Swipe Feed, Discovery & Organization, and Deploy are all shipped.

**Milestone 5 (Design Polish):** ~90% complete. Major wins from the April 6 runs: typography scale cleanup, page transition animations, shimmer skeletons, z-index and shadow token systems, ESLint cleanup (zero warnings). Most P0/P1 items done.

**Milestone 5a (Video Playback):** Core playback fixed. All automated checks pass. 8 items marked `[?]` need manual browser testing (theatre mode, feed autoplay, queue autoadvance, etc.). These cannot be verified via automation.

**Milestones 6-7 (TV Mode, Visual Identity):** Not started. Long-horizon.

## Open Items Needing Attention

### Blocked / Needs Decision `[?]`
- **5.4 Color tokens consolidation** (replace raw `bg-gray-900` etc with tokens) -- flagged as large cleanup pass
- **5.4 Glass material tokens** -- deferred
- **5.4 Card top highlights** -- deferred
- **5.6 Hero content positioning** -- requires animation system rework
- **2.7 Real mobile device testing** -- needs manual test on phone

### Not Started (High Value)
- **2.8 Tier 3: Service worker video caching** -- would eliminate remaining swipe stutter
- **5.5 Hero scroll affordance** (85vh peek) -- approved design decision, not implemented
- **5.5 FeaturedSection scroll tightening** (550vh to 300vh) -- approved, not implemented
- **5.3 Logo SVG treatment** -- deferred but still open

### QA Failures Still Open
- **P1: Mobile long-press source control sheet broken** -- sheet never appears
- **P1: 5+ second load between feed videos** -- stream URL pre-warming may be broken on mobile
- **P2: "Your Subscriptions" and "Up Next" show same videos** -- needs design-strategist pass
- **P2: Play vs Theatre buttons do same thing** -- needs differentiated behavior
- **P2: Category spotlight-on-hover redesign** -- detailed spec written, not built
- **P2: Category video click should open video page** -- feature doesn't exist yet
- **P2: Mode toggle redesign** (subtle iOS-style switch)
- **P2: All social feed content is YouTube-only** -- core multi-platform issue

### Infrastructure
- **3.4.1 Per-mode cookie files** -- architecture defined, adapter not updated yet
- **3.3.1 Playlist crawling** -- playlists are high-signal but scraping not implemented
- **3.3.1 Settings UI for PornHub username** -- endpoint exists, no UI field

## Code Review Findings (This Sprint)

### Fixed
1. **Dockerfile: Added `USER node` directive** -- container was running as root. Now runs as non-root `node` user for security.
2. **yt-dlp `--js-runtimes node` inconsistency** -- `isAvailable()` version check was missing the flag that all other yt-dlp calls use. Fixed for consistency.

### Flagged (Not Fixed)
3. **`safeStorage.js` uses `console.warn` instead of logger module** -- frontend stores use raw console; should migrate to structured logging if/when a frontend logger is added.

## Recommended Next Tasks for Claude Code

**If doing code work today, priority order:**

1. **5.5 Hero scroll affordance + FeaturedSection tightening** -- both are approved design decisions with clear specs. High visual impact, no blockers.
2. **P1 QA: Mobile feed video load time** -- 5+ second black screen between swipes is the worst UX bug. Investigate pre-warming pipeline on mobile.
3. **3.4.1 Per-mode cookie files** -- small adapter change, big hygiene win for keeping NSFW cookies separate from social requests.

## Files Changed This Sprint
- `Dockerfile` -- added `USER node` security directive
- `server/sources/ytdlp.js` -- added `--js-runtimes node` to `isAvailable()` check
