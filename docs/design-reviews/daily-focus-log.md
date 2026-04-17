# Daily Design Focus Log

One move per day. No audits, no scorecards, no padding-width complaints.

---

### 2026-04-16
**Surface:** Home hero + PosterShelf (Tier 1)
**Move:** Continue Watching hero strip — glass panel with up to 3 in-progress video cards, positioned between hero content and carousel
**Behavior change:** Torin resumes videos on first visit instead of re-entering the browse loop. Resume becomes the default action when in-progress content exists, not something discovered after 3 viewports of scrolling.
**Why this over everything else:** Continue Watching lives in BrowseSection, below 2 full GalleryShelf rows. It's the most important content for a returning user and it's in the least visible position. Every streaming app promotes resume above the fold. FeedDeck buries it.
**Status:** mocked
**Artifact:** [docs/design-reviews/2026-04-16-continue-watching-hero-strip.html](./2026-04-16-continue-watching-hero-strip.html)

---

### 2026-04-12
**Move:** (Transition day) Retired the comprehensive audit format after 10 runs. Previous runs cataloged 70+ issues across 12 lenses. The system was generating reports, not driving design quality. Switching to single-intervention format.
**Why this over everything else:** 10 runs of auditing produced a comprehensive bug list but zero taste-level improvements. Time to stop documenting problems and start making moves.
**Status:** shipped (new task instructions live)
**Artifact:** See `REVIEW_PROCESS_NOTES.md` for the full archive of runs 1-10.

---

## What's been covered (runs 1-10 archive)
For reference, the old rotation covered: baseline architecture, edge cases, user journeys, competitive comparison (Netflix/HBO), performance/bundle, accessibility, micro-interactions, content strategy, error resilience, mobile-first responsive. All findings are in the individual review files and the active debt list in REVIEW_PROCESS_NOTES.md.

## Known high-value moves not yet proposed
These emerged from 10 runs of auditing as the most impactful design-level changes (not bug fixes):
- Ambient color extraction from thumbnails for hero/card backgrounds
- "Top 10" row with large numbered overlays (Netflix pattern)
- Card hover expansion with synopsis + metadata reveal (Apple TV+ style)
- Shared-element transition between card click and theatre/player mode
- Hero autoplay with muted video preview
- Editorial row variety (8-10 distinct row types vs. current identical rows)
- TV Mode with 10-foot UI, D-pad nav, enlarged focus states
- Cinematic page transitions (not just route swaps)
