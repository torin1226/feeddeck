# Design Review Process Notes

Last updated: 2026-04-10 (run 8)

## How This Works
- Daily automated review via scheduled task
- Reviews saved to `/docs/design-reviews/YYYY-MM-DD-daily-design-review.md`
- Read THIS file first each session to avoid repeating work

## Session History
| Date | Focus | Score | Key Findings |
|------|-------|-------|-------------|
| 2026-04-06 | Full baseline audit | 6.5/10 | No TV mode, generic dark palette, no Continue Watching on home, HLS previews skipped, cards need redesign |
| 2026-04-06 (run 2) | Edge cases & resilience | 6.0/10 | Silent API failures everywhere, no retry UX, z-index chaos (0-9999), 40+ arbitrary spacing values, 6 empty alt attrs, 0 focus traps in modals, queue polling no backoff. Built: design token system in tailwind config + directional shimmer skeletons |
| 2026-04-07 | User journey audit (5 flows) | 6.2/10 | 4-6 friction points per flow, dead Like button in hero, no loading states in theatre/library/settings, touch users can't queue/rate, 38+ source files truncated on disk (dist intact), demo data seeds silently. Built: comprehensive prefers-reduced-motion, sr-only utility, aria-live containment |
| 2026-04-08 | Competitive comparison (Netflix + HBO Max) | 6.5/10 | Live page structure analysis of both competitors. Biggest gaps: no Continue Watching on homepage, no personalized row titles, no search UI, no hero autoplay, no Top 10 social proof, no progress bars on cards. Visual layer is competitive; information architecture and personalization are not. Fixed since last run: theatre spinner, hero Like, touch long-press, toast system, CSS truncation. Built: skeleton-to-content crossfade CSS, fixed random year bug in hero. |
| 2026-04-08 (run 5) | Performance & Bundle | 6.7/10 | Bundle is excellent (273KB gzipped, proper chunk splitting). CSS animations are GPU-efficient. THE MAIN ISSUE: Full Zustand store subscriptions in 4 high-frequency components (FeedPage, HeroSection, CategoryRow, VideoCard) cause 10-100x unnecessary re-renders during scroll/playback. 15-minute fix. Also: random year still unfixed in HeroSection:275, 6 backdrop-blur elements risk frame drops, no React.lazy() for routes, no pre-compression. |
| 2026-04-09 | Accessibility Deep Dive | 6.5/10 | See 2026-04-09-accessibility-deep-dive.md for details. |
| 2026-04-09 (run 7) | Micro-Interaction Audit | 6.5/10 | Animation timing tokens defined but used 0/132 times. 60+ clickable elements lack click feedback. Skeleton→content instant swap. No exit animations. Settings crashes 3rd consecutive run. Heart burst + Ken Burns + queue pulse are Netflix-tier; everything below hero feels like prototype. Sprint-ready fix list ~10 hours. |
| 2026-04-10 (run 8) | Content Strategy & Visual Hierarchy | 5.5/10 | REGRESSION: 3/4 pages crash (dist/ has mixed build artifacts from 2 Vite builds). Settings crash is 4th consecutive run. Featured section creates ~900px dead space. Hero has zero curation context. Category rows visually identical. Personalized row titles not surfaced despite tag preference data existing. Before/after mock created. Fix dist + add curation context + personalize row titles = biggest wins. |

## Known Limitations
- **Screenshots: SOLVED (run 5).** Use `@sparticuz/chromium` npm package (installs via npm registry, no external CDN needed) + `puppeteer-core`. Must patch `_hydrated:!1` to `_hydrated:!0` in the main bundle via request interception because Zustand persist middleware never fires `onRehydrateStorage` in headless shell mode. Must block fonts.googleapis.com (403 in sandbox). Mock server at port 8765 serves dist/ + mock API JSON. Scripts saved to `docs/design-reviews/take-screenshots.js` and `mock-server.js`.
- **Screenshot recipe:** `npm install @sparticuz/chromium puppeteer-core` → start mock-server.js → run take-screenshots.js → images land in docs/design-reviews/screenshots/
- **IMPORTANT (run 8 discovery):** dist/ has chunks from 2 different builds. HTML references `index-CVz1Ci54.js` but its chunk imports point to missing files. The mock-server.js now patches HTML to use `index-CeqlfrPt.js` + `index-CfTDLE5_.css` which have matching chunks. Screenshot script patches `_hydrated` in the correct bundle. If dist/ is rebuilt, update these filenames in both scripts.
- **Server not running in sandbox:** The mounted filesystem is read-only for node_modules/.vite cache. Can't run vite dev server. Dist build is intact but zustand hydration blocks rendering in headless preview. HOWEVER: a simple Node mock server serving dist/ + mock API JSON works fine on port 8765.

## What to Check Each Run
1. `git log --oneline -20` to see recent changes (note: git branch may be broken, check refs directly)
2. Diff any changed components against last review's findings
3. Check if any P0/P1 items from previous reviews were addressed
4. Look for new components that may not match design language
5. Check bundle sizes for regression

## Lens Rotation (cycle through these)
1. **Architecture & Visual** (run 1, 2026-04-06) -- DONE
2. **Edge Cases & Resilience** (run 2, 2026-04-06) -- DONE
3. **User Journey** (run 3, 2026-04-07) -- DONE
4. **Competitive Comparison** (run 4, 2026-04-08) -- DONE
5. **Performance & Bundle** (run 5, 2026-04-08) -- DONE
6. **Accessibility Deep Dive** (run 6, 2026-04-09) -- DONE
7. **Micro-interaction Audit** (run 7, 2026-04-09) -- DONE
8. **Content Strategy & Visual Hierarchy** (run 8, 2026-04-10) -- DONE
9. **Error Resilience & Recovery UX** (NEXT) -- error states, loading states, empty states, recovery flows, graceful degradation. Especially relevant now that 3/4 pages crash.
10. **Mobile-First Responsive** -- touch targets, viewport behavior, responsive breakpoints, gesture tuning, bottom nav placement
11. **Animation & Motion System** -- audit all 132 transition declarations, enforce timing tokens, add exit animations, test reduced-motion
12. **Content Freshness & Rotation** -- how content ages, TTL signals, staleness indicators, "seen it all" states

## Active Design Debt (Track Across Sessions)
- [x] Hero Like button has no onClick handler (FIXED 2026-04-08 scheduled run)
- [x] Theatre mode has no loading state (FIXED 2026-04-08 scheduled run)
- [x] Touch users cannot queue or rate videos (FIXED 2026-04-08 scheduled run — long-press)
- [x] Loading shimmer has no directionality (FIXED run 2: directional sweep in Skeletons.jsx)
- [x] No design token system (FIXED run 2: z-index/shadow/radius/sizing/animation tokens in tailwind.config.js)
- [x] Animations don't respect prefers-reduced-motion (FIXED run 3: comprehensive reduced-motion in index.css)
- [x] No sr-only utility class (FIXED run 3: added to index.css)
- [x] No toast feedback for queue operations (FIXED 2026-04-08 scheduled run)
- [x] Random year in HeroSection metadata (FIXED run 4: replaced with upload year extraction)
- [ ] No Continue Watching row on Homepage (CRITICAL — both Netflix and HBO have this)
- [ ] No search UI despite feedStore having searchQuery filter (CRITICAL — both competitors prioritize this)
- [ ] No hero autoplay (HIGH — every streaming service auto-plays muted in billboard)
- [ ] No personalized row titles (CRITICAL — Netflix/HBO personalize every row name)
- [ ] No progress indicator bar on cards (HIGH — Netflix red bar, HBO blue bar)
- [ ] No carousel navigation arrows on category rows (MEDIUM)
- [ ] No Top 10 / trending row (HIGH — both platforms feature ranked lists)
- [ ] No content-aware color extraction for hero backgrounds
- [ ] No skeleton → content crossfade (FIXED run 4: added fadeIn animation)
- [ ] CRITICAL: Full Zustand store subscriptions in FeedPage:25, HeroSection:17-23, CategoryRow:12, VideoCard:18-19 — causes 10-100x re-renders (15 min fix)
- [ ] FeedPage gesture callbacks recreate on every buffer change (useRef fix needed)
- [ ] 6 non-critical backdrop-blur elements risk frame drops on low-end hardware
- [ ] No React.lazy() for page routes (all page JS loads upfront)
- [ ] No pre-compression (vite-plugin-compression)
- [ ] No bundle size tracking (rollup-plugin-visualizer)
- [ ] Duplicate view-transition CSS rules in index.css (lines 107-120 and 209-213)
- [ ] Puppy placeholder data still in homeStore.js fallback
- [ ] HLS hover preview skip (useHoverPreview.js line 44)
- [ ] watchedIds Set not persisted across sessions
- [ ] No TV/remote mode
- [ ] Settings page is a flat form dump
- [ ] Empty states use emoji instead of branded illustrations
- [ ] Silent API failure pattern -- no user-facing error/retry anywhere
- [ ] Queue polling no exponential backoff (hammers server every 3s when down)
- [ ] Z-index soup: 12 files, values 0-9999, no semantic scale used yet
- [ ] 40+ arbitrary pixel values in spacing/sizing
- [ ] 6 images with empty alt="" attributes
- [ ] 3 clickable divs without role/keyboard support
- [ ] 0 focus traps in modals (AddVideoModal, FeedFilterSheet, ContextMenu)
- [ ] Touch targets below 44px (VideoPlayer buttons, timeline, filter toggles)
- [ ] P0: 38+ source files truncated on disk -- need recovery from git
- [ ] P0 (run 8): dist/ has mixed build artifacts — 3/4 pages crash. Clean dist/ and rebuild.
- [ ] P1 (run 8): Featured Section 300vh scroll zone creates ~900px dead space between hero and content
- [ ] P1 (run 8): Hero has no curation context (no "Trending in Design", no "Because you watch X")
- [ ] P1 (run 8): Category rows visually identical — no row type variety (trending vs editorial vs short-form)
- [ ] P2 (run 8): Personalized row titles not surfaced despite tag preference data existing in homeStore
- [ ] P2 (run 8): Video cards lack source badges (YouTube vs TikTok indistinguishable)
- [ ] P2 (run 8): Card info hierarchy flat — channel name same visual weight as view count
- [ ] LibraryPage has no loading spinner during server fetch
- [ ] Demo data seeds silently with no disclosure
- [ ] Settings page CRASHES with "Cannot read properties of undefined (reading 'map')" — likely missing null guard on categories/sources array (P0 BUG found in run 5 screenshots)
- [ ] Settings actions have no success/error feedback
- [ ] watchedIds not persisted from server on feed init (causes re-watches)
- [ ] Empty states use emoji instead of branded SVG illustrations

## Long-Horizon Backlog (Prioritized — Updated Apr 8)

### Month 1 (Competitive Parity)
1. Continue Watching row on Homepage
2. Search UI (header + results)
3. Hero autoplay (muted, with toggle)
4. Personalized row titles ("Because You Watched X", editorial names)
5. Progress indicator bar on video cards
6. Carousel navigation arrows

### Month 2 (Differentiation)
7. Top 10 / Trending row with rank numbers
8. Content-aware ambient color extraction
9. Lightweight detail card on hover/click
10. Editorial row variety (8-10 row types)
11. Card hover expansion animation
12. Persistent watch history dedup
13. HLS hover preview fix

### Month 3 (Polish & Identity)
14. TV Mode MVP
15. Branded empty state illustrations
16. Cinematic transition upgrade
17. Custom loading states per page
18. Settings UX overhaul
19. Noise/grain texture on dark surfaces
20. Maturity/content rating badges
