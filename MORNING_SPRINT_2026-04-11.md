# Morning Sprint Report — 2026-04-11

## Backlog Status

**No blockers. No in-progress items.** The backlog is clean — everything that was started has been completed.

### Open Items Worth Attention

**P0 (Design Review — Competitive Parity):**
- [ ] Continue Watching row on Homepage (Netflix has this as row 2)
- [ ] Search UI in Header (expand icon → input)
- [ ] Hero autoplay (muted video replacing Ken Burns)

**Manual Testing Gate (blocks Milestone 4):**
- [ ] 3.11: Full mobile device testing + user sign-off
- [ ] 5a.2: 8 manual playback tests (theatre, feed, queue, error states)
- [ ] 2.7: Real mobile device testing (iOS Safari, Android Chrome)

**Minor Open Work:**
- [ ] 3.3.1: Playlist crawling for recommendation seeding
- [ ] 3.4.1: Cookie mode forwarding to all callers
- [ ] 2.8 Tier 3: Service worker video caching
- [ ] 5.3: Logo SVG treatment (deferred, emoji is fine for now)

## Code Review Findings & Fixes

### Critical: Truncated Source File (FIXED)
`src/components/home/BrowseSection.jsx` was truncated at line 99 mid-word (`hover:bg-accent-hove`). The entire Feed CTA button, closing tags, and export were missing. **Rebuilt the missing JSX.** This would have caused a build failure or blank section on the homepage.

### Missing Dev Dependency (FIXED)
`eslint-plugin-react-hooks` was imported in `eslint.config.js` but never added to `package.json`. ESLint was completely broken — `npm run lint` would error out before checking any files. **Installed the package.**

### ESLint Cleanup (FIXED)
Resolved 8 lint warnings across 5 files:
- Prefixed unused variables with `_` (VideoCard, FeedVideo, HeroSection, SettingsPage)
- Removed stale eslint-disable directive (useHoverPreview)
- Added `caughtErrorsIgnorePattern` to ESLint config for `_err` catch vars
- Added intentional deps comment on FeedVideo stream URL effect

**Result:** ESLint now passes with 0 warnings on source files (excluding test parse errors from missing test parser config).

### Test File Parse Errors (NOT FIXED — low priority)
3 test files (`feedStore.test.js`, `playerStore.test.js`, `safeParse.test.js`) have parse errors under ESLint. Likely need a Vitest/globals ESLint environment config. Not blocking anything since tests run via Vitest, not ESLint.

## Active Sessions

- **Daily design review** (running)
- **Homepage redesign** (running) — likely working on the P0 competitive parity items
- **YouTube search fallback** (idle) — cookie staleness workaround

## Recommendations for Today

1. **Manual testing is the bottleneck.** Three separate backlog gates require hands-on mobile/browser testing. Nothing in M4+ can start until 3.11 is signed off. Torin should block 30 min with his phone on the same WiFi as the dev server.

2. **The P0 competitive parity items** (Continue Watching on homepage, Search UI, Hero autoplay) are the highest-leverage remaining work. The homepage redesign session may already be tackling these.

3. **Consider adding ESLint environment config for test files** — quick 5-min fix to add `vitest/globals` to the ESLint test file config so the 3 parse errors go away.
