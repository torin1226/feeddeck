# Morning Sprint Report - 2026-03-26 (Thursday)

## Status: Working Tree Restored + Backlog Synced

### Critical Finding: Corrupted Working Tree (FIXED)

The local working tree had **88 files with deletions/truncation** relative to HEAD. Files were truncated mid-line with null bytes appended. Root cause unknown (likely a previous session's filesystem operation that didn't complete cleanly).

**Action taken:** Restored all files from HEAD using `git show`. Working tree now matches HEAD. Zero data loss (git history was intact).

**Remaining cleanup:**
- 6 untracked temp files (old sprint reports, stale vite timestamps, a wireframe HTML)
- `BACKLOG.md` synced from origin/master (canonical GitHub version)

---

### Repo State

| Metric | Value |
|--------|-------|
| Local branch | `master` (14 commits ahead of origin) |
| Last commit | `75a8c33` - feat(feed): mobile adaptive video height + swipe-to-theatre |
| ESLint errors | 1 (`no-unsafe-finally` in queueStore.js:209) |
| Build | Compiles clean (102 modules), dist write blocked by sandbox perms |

### 14 Unpushed Commits (Summary)

These commits represent significant work that hasn't been pushed to GitHub:

1. **Bug fixes & hardening** (4 commits): SFW feed population fix, SpankBang scraper fix, Cobalt auth, per-domain cookie routing (`server/cookies.js`), NSFW/SFW nuclear switch (mode change flushes all content stores), ErrorBoundary, queue integrity, safe localStorage wrapper
2. **Desktop feed redesign** (10 commits): New ForYou + Remix dual-view desktop feed with tab bar, TheatreOverlay with mouse-reveal controls, hold-to-scrub TheatreTimeline, NextUpDialog with countdown auto-advance, RemixFeed Netflix-style browse, mobile adaptive video height, swipe-to-theatre gesture

**Decision needed:** These commits need to be pushed to origin. They introduce ~3,400 lines of new code.

---

### Backlog Analysis

**Milestones 1-2:** Complete (all items `[x]`)

**Milestone 3 (Discovery & Organization):** ~90% complete. Open items:
- [ ] Playlist crawling for seed recommendations (3.3.1)
- [ ] Settings UI: username text field (3.3.1)
- [ ] Per-mode cookie files adapter update (3.4.1) - 6 sub-tasks
- [ ] Mobile device testing gate (3.11) - manual checkpoint

**Milestone 4 (Deploy & Advanced):**
- [ ] Social mode content pipeline design (4.2) - deferred
- [ ] AI recommendations (4.4)
- [ ] Browser extension (4.5)
- [ ] Cross-device sync (4.6)
- [ ] Offline mode (4.7)

**Milestone 5a (Video Playback):** All code fixes done. 8 items marked `[?]` need **manual browser testing** (Chrome blocks media in MCP-controlled tabs).

**Milestone 5 (Design Polish):** ~85% complete. Open items:
- [ ] Page transition animation (5.5) - deferred, CSS-only
- [ ] Hero 85vh scroll peek (5.5) - deferred
- [ ] FeaturedSection 300vh tightening (5.5) - deferred
- [ ] Color token consolidation (5.4) - sweeping change
- [ ] Glass material tokens (5.4)
- [ ] Card depth highlights (5.4)
- [ ] Hero content positioning refactor (5.6)

**Discovered Tasks (open):**
- [ ] **HIGH:** Hover preview video element cleanup (54 `<video>` elements, memory leak)
- [ ] **HIGH:** Close Puppeteer browser on scrape failure (leaked instances)
- [ ] SIGTERM handler for background intervals + DB close
- [ ] Per-chunk timeout on proxy-stream pipe
- [ ] AbortController for `_warmStreamUrls()` on `resetFeed()`
- [ ] Log malformed JSON parse failures in tag processing
- [ ] 16 remaining `react-hooks/exhaustive-deps` ESLint warnings

---

### Decisions Needed

1. **Push 14 local commits?** The desktop feed redesign (ForYou + Remix views, TheatreOverlay, etc.) is substantial. Should these be pushed to origin as-is, or does Torin want to review/test first?

2. **Next priority:** The highest-impact open work is:
   - **Option A:** Push commits + manual playback testing (5a.2) to validate everything works
   - **Option B:** Fix the two HIGH discovered tasks (hover preview leak + Puppeteer browser leak)
   - **Option C:** Complete per-mode cookie files (3.4.1) to properly separate SFW/NSFW auth

3. **Mobile testing gate (3.11):** This is blocking Milestone 4. Torin needs to test on a real phone over local WiFi.

---

### Code Quality Notes

- `queueStore.js:209`: `throw` inside `finally` block (nested try/catch for serialized reorder). Low risk but should refactor the pending reorder logic into a separate async function.
- The `nuclearFlush()` in modeStore.js uses dynamic imports to break circular deps. Works but is fragile. Consider a centralized reset registry pattern.
- `safeStorage.js` is a good addition. Catches `QuotaExceededError` gracefully.
- Cookie routing (`server/cookies.js`) with temp file copies for concurrent yt-dlp is well-engineered.
