# Design Review Process Notes

Last updated: 2026-04-06

## How This Works
- Daily automated review via scheduled task
- Reviews saved to `/docs/design-reviews/YYYY-MM-DD-daily-design-review.md`
- Read THIS file first each session to avoid repeating work

## Session History
| Date | Focus | Score | Key Findings |
|------|-------|-------|-------------|
| 2026-04-06 | Full baseline audit | 6.5/10 | No TV mode, generic dark palette, no Continue Watching on home, HLS previews skipped, cards need redesign |
| 2026-04-06 (run 2) | Edge cases & resilience | 6.0/10 | Silent API failures everywhere, no retry UX, z-index chaos (0-9999), 40+ arbitrary spacing values, 6 empty alt attrs, 0 focus traps in modals, queue polling no backoff. Built: design token system in tailwind config + directional shimmer skeletons |

## Known Limitations
- **Screenshots:** Sandbox can't expose localhost to user's Chrome. Try Torin's Beelink URL if deployed, or use `npx vite preview` on a port the browser can reach.
- **Server not running in sandbox:** The mounted filesystem is read-only for node_modules/.vite cache. Can't run vite dev server. Can serve pre-built dist/ with Python http.server but Chrome can't reach sandbox network.

## What to Check Each Run
1. `git log --oneline -20` to see recent changes
2. Diff any changed components against last review's findings
3. Check if any P0/P1 items from previous reviews were addressed
4. Look for new components that may not match design language
5. Check bundle sizes for regression

## Lens Rotation (cycle through these)
1. **Architecture & Visual** (baseline) -- component structure, color, layout, typography
2. **Edge Cases & Resilience** (run 2) -- error states, empty states, loading, offline, state persistence
3. **User Journey** (next) -- walk 5 key flows end-to-end, note every friction point
4. **Competitive Comparison** -- screenshot Netflix/HBO/Mubi, compare specific UI patterns
5. **Performance & Bundle** -- measure load times, find render bottlenecks, check bundle size
6. **Accessibility Deep Dive** -- WCAG AA compliance, screen reader walkthrough, keyboard-only navigation

## Active Design Debt (Track Across Sessions)
- [ ] Random year in HeroSection metadata (line ~274)
- [ ] Puppy placeholder data still in homeStore.js fallback
- [ ] HLS hover preview skip (useHoverPreview.js line 44)
- [ ] watchedIds Set not persisted across sessions
- [ ] No TV/remote mode
- [ ] No search UI despite feedStore having searchQuery filter
- [ ] Settings page is a flat form dump
- [ ] Empty states use emoji instead of branded illustrations
- [x] Loading shimmer has no directionality (FIXED run 2: directional sweep in Skeletons.jsx)
- [ ] Silent API failure pattern -- no user-facing error/retry anywhere
- [ ] Queue polling no exponential backoff (hammers server every 3s when down)
- [ ] Z-index soup: 12 files, values 0-9999, no semantic scale used yet
- [ ] 40+ arbitrary pixel values in spacing/sizing
- [ ] 6 images with empty alt="" attributes
- [ ] 3 clickable divs without role/keyboard support
- [ ] 0 focus traps in modals (AddVideoModal, FeedFilterSheet, ContextMenu)
- [ ] Touch targets below 44px (VideoPlayer buttons, timeline, filter toggles)
- [x] No design token system (FIXED run 2: z-index/shadow/radius/sizing/animation tokens in tailwind.config.js)

## Long-Horizon Backlog (Prioritized)
1. TV Mode MVP (Month 1)
2. Ambient color extraction from thumbnails (Month 1)
3. Continue Watching row on Homepage (Month 1)
4. Card component redesign (Month 1)
5. Client-side recommendation sorting (Month 2)
6. Persistent watch history dedup (Month 2)
7. Search UI (Month 2)
8. HLS hover preview fix (Month 2)
9. Cinematic transition upgrade (Month 3)
10. Custom empty states/loading (Month 3)
11. Settings UX overhaul (Month 3)
12. Signature accent color + noise texture (Month 3)
