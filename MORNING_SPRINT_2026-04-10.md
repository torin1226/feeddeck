# Morning Sprint — 2026-04-10

## Backlog Sync

Local backlog (886 lines) read successfully. GitHub shows 820 lines (last push Apr 7). Local copy has ~66 lines of additional content from recent sessions not yet pushed.

## Backlog Status

**No [~] in-progress or [!] blocked items.** Project is in a clean state between work sessions.

**[?] Needs-decision items (manual testing gates):**
- 2.7: Real mobile device testing (iOS Safari, Android Chrome)
- 5a.2: 8 playback test items all need manual browser verification (Chrome blocks media in MCP tabs)
- 5.4: 3 color token consolidation items deferred to cleanup pass
- 5.6: Hero content positioning deferred (requires scroll animation rework)

**Highest-priority open work (P0 from Design Review 2026-04-08):**
1. **Continue Watching row on Homepage** — currently only in Library page, Netflix/HBO both feature this prominently
2. **Search UI in Header** — feedStore has searchQuery infra, needs header search icon expanding to input
3. **Hero autoplay (muted)** — pre-resolve stream URL, auto-play replacing Ken Burns, mute toggle

**Other notable open P1 items:**
- Library loading skeleton
- Settings action feedback (toasts instead of alert())
- Pre-resolve hero stream URL on set (not on Play click)
- Personalized row titles ("Because You Watched X")
- Carousel navigation arrows on category rows
- Progress indicator bar on cards (Netflix red bar pattern)

## Code Review (commit 1de640d)

### Bug Found
- **HeroSection.jsx**: Like button has no `onClick` handler — it renders but does nothing. The `libraryStore` import is also missing. This was supposed to be wired in this commit per the message.

### ESLint Warnings (3)
- `VideoCard.jsx:60` — unused parameter `e`
- `HeroSection.jsx:28` — unused variable `reducedMotion`
- `useHoverPreview.js:118` — unnecessary eslint-disable directive

### Cleanup Opportunities
- **20 stale `vite.config.js.timestamp-*` files** in project root — safe to delete, should be in `.gitignore`
- **Duplicate staggered animation logic** in `ContinueWatchingRow.jsx` and `CategoryRow.jsx` — identical IntersectionObserver + 300ms stagger pattern, candidate for `useStaggeredAnimation()` hook extraction
- **Large files**: `SettingsPage.jsx` (606 lines), `FeedPage.jsx` (549 lines) — candidates for component extraction
- **Build permission error**: `dist/` has locked files preventing clean rebuild

### Positive Notes
- No console.log leaks
- No unused imports (besides the 3 ESLint items)
- Proper cleanup in all useEffect hooks
- AbortController correctly implemented in useHeroAutoplay
- Toast system is clean and minimal

## Recommendations for Today's Session

1. **Quick win**: Fix the Hero Like button wiring (5 min)
2. **Quick win**: Delete the 20 timestamp files + add to .gitignore (2 min)
3. **Quick win**: Fix 3 ESLint warnings (5 min)
4. **Feature work**: Continue Watching row on Homepage is the highest-impact P0
5. **Feature work**: Header search UI is competitive parity gap

## Process Notes

- The local backlog has diverged from GitHub by ~66 lines. Next Claude Code session should push to keep them in sync.
- No new skills needed — existing workflow is functioning well.
- Consider extracting the staggered animation pattern to a shared hook to reduce duplication as more row components are added.
