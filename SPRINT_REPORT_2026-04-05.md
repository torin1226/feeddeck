# Morning Sprint Report — April 5, 2026

## Status: Project Stalled (14 days since last commit)

Last commit was March 26. Two critical branches have been sitting unmerged since the April 2 sprint flagged them. This is now **day 3** of that warning going unaddressed.

---

## Blocker #1: Unmerged Branches (REPEAT WARNING)

The same two branches flagged on April 2 are still unmerged:

**`fix-p0-qa-failures` (9 commits, 42 files, 410 insertions)**
Contains: all P0/P1/P2 QA bug fixes, command injection fix, SQL injection fix, N+1 query fix, Zustand selector migration (35 components), React.memo on hot-path items, hover preview fix, proxy-stream idle timeout. This branch alone resolves roughly half the open backlog items.

**`march-31` (1 commit)**
Contains: per-mode cookie files (3.4.1) and stability fixes.

**Merge order:** `fix-p0-qa-failures` first (larger, more critical), then `march-31` (will likely conflict on `server/index.js`).

**Action needed from Torin:** Run `git merge origin/claude/fix-p0-qa-failures-38hhB` on master, resolve any conflicts, then merge `origin/claude/march-31-deck-site-Pz7NJ`.

---

## Code Review: What I Fixed Today

**1. ESLint error fixed — `no-unsafe-finally` in queueStore.js**
A `throw` statement inside a `finally` block could silently swallow errors from the outer try/catch. Moved the pending-reorder processing out of the finally block so both code paths execute correctly.

**2. Unused variables removed**
- `useKeyboard.js:40` — `next` assigned from `advance()` but never read
- `FeedPage.jsx:226` — `getSharedVideoEl` destructured but never used

ESLint: 1 error → 0 errors. 24 warnings → 22 warnings.

---

## Open P0 Issues (Still Unaddressed on Master)

1. **NSFW content flashes on SFW first load** — Zustand persist middleware hydrates async, so the homepage can briefly render NSFW content before modeStore reads localStorage. This is the worst possible UX failure for this app. Fix: read localStorage synchronously in initial state, add a loading gate.

2. **Mobile feed: 5+ second black screen between videos** — Stream URL pre-warming or preload may be broken. Target is <2 seconds.

3. **Heart button not clickable on hero** — Likely z-index overlap with search bar.

*Note: Issues #2 and #3 may already be fixed in the unmerged `fix-p0-qa-failures` branch.*

---

## Backlog Summary

| Status | Count |
|--------|-------|
| Milestones 1-2 | ~95% complete |
| Milestone 3 | ~85% complete |
| Milestone 4 | ~40% complete |
| Milestone 5 | ~70% complete |
| Open QA failures | ~15 items |
| Discovered tasks | ~8 open items |

### Key open items worth tackling next (after merge):
- Gesture remap to unified scheme (2.2)
- Service worker video caching (2.8 Tier 3)
- Mobile testing gate (3.11) — blocks Pi deployment
- NSFW flash fix (P0 safety)
- Queue drawer redesign
- Category row spotlight-on-hover redesign
- Reddit export pipeline wiring

---

## Process Improvement Notes

**What's working:**
- Backlog-as-source-of-truth keeps Claude Code and Cowork aligned
- Scheduled morning sprints catch stale state
- QA sessions with structured test plans found real bugs

**What needs fixing:**
1. **Branch merge bottleneck.** Claude Code produces branches, but nobody merges them. We need either: (a) Torin reviews and merges periodically, or (b) Claude Code auto-merges to master after passing lint/build (risky but faster).

2. **Scope creep in QA findings.** The March 27 QA generated ~15 new tasks, some of which are full features (queue drawer redesign, category row redesign, video page with related content). These should be triaged as new milestone items, not P2 bugs.

3. **The morning sprint keeps finding the same stale branches.** This is the third time we've flagged these unmerged branches. Consider a skill that auto-creates a GitHub issue or notification when branches go unmerged for >48 hours.

---

## Recommended Next Session Priority

1. Merge the two branches
2. Fix NSFW flash on SFW load (P0 safety)
3. Run mobile testing gate (3.11)
4. Deploy to Beelink (4.1)

Everything else is polish. Ship what's built.
