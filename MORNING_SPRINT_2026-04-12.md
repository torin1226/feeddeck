# Morning Sprint Report — 2026-04-12

## Backlog Status

**No blockers. No in-progress items.** GitHub backlog synced and matches local copy. 20 open tasks remain, all `[ ]` not-started or `[?]` awaiting user decision.

### Open Items by Priority

**Manual Testing Gates (blocks Milestone 4):**
- [ ] 3.11: Full mobile device testing + user sign-off
- [ ] 5a.2: 8 manual playback tests (theatre, feed, queue, error states)
- [ ] 2.7: Real mobile device testing (iOS Safari, Android Chrome)

**Deferred Feature Work:**
- [ ] 3.3.1: Playlist crawling for recommendation seeding
- [ ] 3.4.1: Cookie mode forwarding to all callers
- [ ] 2.8 Tier 3: Service worker video caching
- [ ] 4.2: Social mode content pipeline (deferred)
- [ ] 4.4-4.7: AI recommendations, browser extension, cross-device sync, offline mode

**Design Polish (P2/P3):**
- [ ] 5.3: Logo SVG treatment (deferred, emoji is fine)
- [ ] Content-aware skeleton shapes, ambient color extraction, branded empty state SVGs
- [ ] Noise/grain texture, card hover expansion, maturity badges, "More Like This"
- [ ] Color token consolidation, glass material tokens, card highlight borders
- [ ] Content-aware hero gradient, lightweight detail card on hover, editorial row variety

## Code Review: Subscription Backup System (commit 7395416)

Reviewed the 1,493-line subscription backup commit (10 new/changed files). Two smaller fixes applied from the previous commit (infinite retry loop fix, vite timestamp cleanup).

### Issues Found & Fixed (this sprint)

**ESLint Errors (6) — FIXED:**
- `server/routes/creators.js`: 6 unnecessary escape characters in regex (`\/` → `/`) across 3 lines
- All 3 occurrences fixed with `replace_all`

**ESLint Warnings (4) — FIXED:**
- `server/routes/feed.js:67`: unused `src` variable → prefixed with `_`
- `server/sources/creator.js:16`: unused `randomUUID` import → removed
- `server/sources/ytdlp.js:13`: unused `hasCachedChannels` import → removed
- `server/sources/ytdlp.js:256`: unused `isFallback` destructure → removed

**Division by Zero Risk — FIXED:**
- `server/routes/feed.js:78`: weighted shuffle used `1 / b.weight` without guarding against zero weight → added `|| 1` fallback

**Missing Input Validation — FIXED:**
- `server/routes/creators.js:44`: empty handle after regex cleanup would be accepted into DB → added early return with 400 error

**Convenience Script — ADDED:**
- `package.json`: added `"lint": "eslint src/ server/"` script. Previously `npm run lint` failed because no script existed, despite `eslint.config.js` being configured.

### Issues Found (Not Fixed — For Claude Code)

These are architectural or risk items from the subscription-backup system that warrant attention:

1. **No fetch timeouts** — `subscription-backup.js` makes HTTP requests to Twitter, Reddit, YouTube APIs with no `AbortSignal.timeout()`. A hung API response blocks the backup indefinitely. Apply the same 15s timeout pattern used in proxy-stream.

2. **Race condition in creator.js** — `last_fetched` and `fetch_failures` updates happen outside a transaction. Concurrent requests could increment failures independently. Wrap the fetch-then-update cycle in `db.transaction()`.

3. **Unbounded memory in feed.js** — The query at line 44 fetches `count * 10` records. For large `feed_cache` tables with concurrent requests, this could OOM. Consider adding a hard cap (e.g., `LIMIT 500`).

4. **Reddit pagination cursor not URL-encoded** — `subscription-backup.js` line ~285 interpolates the `after` cursor directly into the Reddit API URL. Should use `encodeURIComponent()`.

5. **Twitter HTML scraping is fragile** — Auto-discovery of API hash from JS bundles (fetching up to 5 scripts) has no per-bundle timeout and will break when Twitter changes their JS bundling.

## Process Improvements

**Recurring theme across sprints:** ESLint issues accumulate between sessions because there's no CI gate. The startup skill has ESLint checks, but Claude Code sessions can introduce warnings that don't get caught until the next morning sprint.

**Recommendation:** The new `npm run lint` script makes it trivial to add a pre-commit hook or a lint step to the Claude Code launch config. Consider adding `npm run lint` to `scripts/deploy.sh` as a gate before building.

## Summary

Clean backlog, no blockers. The subscription backup system is functional but needs fetch timeouts and transaction safety before it's production-ready. ESLint is now fully clean (0 errors, 0 warnings). Manual mobile testing remains the critical bottleneck for advancing to Milestone 4.
