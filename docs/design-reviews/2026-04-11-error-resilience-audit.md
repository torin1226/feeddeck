# FeedDeck Design Review -- Run 9: Error Resilience & Recovery UX
**Date:** 2026-04-11
**Lens:** #9 -- Error Resilience (error states, loading states, empty states, timeouts, retry logic, graceful degradation)
**Previous Score:** 5.5/10 (run 8, Content Strategy & Visual Hierarchy)

---

## Screenshots

Fresh screenshots captured from all 4 pages + mobile viewports. Compared against Run 8 screenshots.

**Visual observations:**
- **Homepage:** Renders successfully. Hero with Ken Burns animation, Play/Theatre buttons, metadata. Category rows visible below Featured Section (still has ~900px dead space scroll zone). Thumbnails load from picsum.
- **Feed:** NOW LOADS (was crashing in Run 8). Shows "For You / Remix" pill nav, home button, Theatre toggle. Video card area with title and source badge ("YOUTUBE"). Mobile feed shows spinner + bottom nav.
- **Library:** NOW LOADS (was crashing in Run 8). Shows "Your Library" with filter tabs (All, Favorites, Watch History, Watch Later, Top Rated). 2 video cards with duration badges. Clean layout.
- **Settings:** STILL CRASHES (5th consecutive run). Same `Cannot read properties of undefined (reading 'map')` error. ErrorBoundary catches it with Try Again / Reload Page buttons.
- **Mobile Home:** Hero renders, Featured section scroll zone still dominates viewport.
- **Mobile Feed:** Shows spinner centered on screen with filter/refresh buttons at top, bottom nav visible.

**Key change from Run 8:** The dist/ rebuild fixed the mixed-build-artifact P0. Feed and Library are functional again. Settings remains broken.

---

## Pillar Scores (Error Resilience Lens)

### 1. USEFUL -- 3.5/5

**What works:**
- Error boundaries per-route prevent single crash from killing the whole app
- Smart error type detection (chunk load errors auto-reload, network errors show connection UI)
- Context-aware empty states in Feed (distinguishes "no sources" vs. "no matching filters" with different CTAs)
- Queue has optimistic updates + rollback on failure
- Skeleton loaders on all major pages (hero, categories, library, feed)
- Toast system exists for user-initiated action feedback (source ops, cookies)

**What's broken or missing:**
- **Settings crash is now 5 runs old.** Line 536 in SettingsPage.jsx calls `.map()` on `adapterHealth.adapters` without null check. `adapterHealth` is set from raw API response (line 53) with no validation. If the API returns `{}` or `{adapters: null}`, crash. This is a 1-line fix: `adapterHealth?.adapters?.map(...)`.
- **Zero API calls have timeouts.** No `AbortController`, no `Promise.race()`, no timeout wrapper. Every fetch waits indefinitely. A slow endpoint freezes the entire page.
- **Homepage fetch failure is invisible.** homeStore falls back to placeholder data silently. The user sees "Puppy Compilation" placeholder content and has no idea they're looking at fake data. No staleness indicator, no retry button.
- **Feed loading has no timeout awareness.** Spinner says "Loading feed..." forever. No elapsed time, no retry countdown, no escape hatch to cached content.
- **6+ silent error swallows in SettingsPage.** `fetchSources()` catch block (line 56) only console.errors. Username fetch (line 67) catches with empty handler `() => {}`. Cookie delete (line 178), tag pref add/remove (lines 188, 195) have no error handling at all.
- **markViewed() still never called** (from Run 8). Impression tracking is dead code.

### 2. USABLE -- 3/5

**What works:**
- Feed and Library recovered from Run 8 crashes (dist/ rebuild)
- ErrorBoundary recovery UX has clear CTAs (Try Again, Reload Page)
- Queue polling has exponential backoff (3s to 60s cap) with tab visibility awareness
- OfflineBanner shows when queue server is unreachable
- Skeletons have directional shimmer animation (L-to-R sweep)
- Feed has context-aware empty states with actionable buttons

**What's broken:**
- **Settings has been unusable for 5 consecutive runs.** The null guard fix is 5 minutes. This is the longest-standing P0 in the project.
- **No retry mechanism on 4 of 5 major fetch paths.** Only queue polling retries. Homepage, Feed init, Library load, and Settings all make a single attempt.
- **Error boundary recovery is generic.** Every crash shows the same UI: emoji + "Something went wrong" + "The [Section] section crashed." + raw error string + Try Again + Reload. No contextual help, no partial recovery options, no "what happened" in human language.
- **Feed "Try Again" does a full reset.** FeedPage's retry button calls `resetFeed()` + `initFeed()`, which clears the entire buffer and starts over. If the user had scrolled through 20 videos and the next page fetch fails, they lose all progress.
- **Queue add/remove has zero feedback.** Optimistic update works, but user gets no confirmation toast. If sync fails, rollback happens silently. User can't tell if their action worked.
- **No network state detection.** No `navigator.onLine` check, no connection quality indicator. OfflineBanner only fires when queue sync specifically fails, not for general connectivity.

### 3. MODERN -- 3.5/5

**What works:**
- Skeleton shimmer animation is cinematic quality
- ErrorBoundary has clean visual hierarchy (icon, title, subtitle, detail, buttons)
- Toast system has smooth fade-in/out with typed colors (error/success/info)
- Feed empty states have good icon usage and contextual messaging
- OfflineBanner uses amber color coding consistently

**What doesn't work:**
- **Error screens look like developer tools.** Raw error messages like "Cannot read properties of undefined (reading 'map')" are visible to users. Netflix shows "We're having trouble playing this title right now. Please try again later." FeedDeck shows a stack trace.
- **No progressive disclosure on errors.** Technical details should be collapsed by default with a "Show details" toggle for power users.
- **Loading states don't communicate progress.** Modern apps show what's happening: "Connecting to sources...", "Loading your library...", "Checking for updates...". FeedDeck shows "Loading feed..." with no specificity.
- **No transition between states.** Loading to loaded is a hard cut. Loading to error is a hard cut. Modern apps crossfade between states or use shared element transitions.
- **Error recovery animations are absent.** When "Try Again" is clicked, there's no loading state on the button itself. No disabled state, no spinner, no progress indicator during retry.

---

## Detailed Findings

### CRITICAL (P0)

#### C1. Settings Page: 5th Consecutive Crash
**Severity:** P0 -- 5 consecutive runs, 1-line fix
**File:** SettingsPage.jsx
**Problem:** Line 536: `adapterHealth.adapters.map(...)` crashes when `adapters` is undefined or null.
- Line 16: `useState(null)` -- starts null
- Line 53: `setAdapterHealth(healthData)` -- raw API response, no validation
- Line 532: `{adapterHealth && (` -- checks object exists but not `.adapters`

**Fix:**
```jsx
// Line 536 -- change:
{adapterHealth.adapters.map((adapter) => (
// To:
{(adapterHealth?.adapters || []).map((adapter) => (
```

Also add defensive check at line 53:
```jsx
setAdapterHealth(healthData?.adapters ? healthData : { ...healthData, adapters: [] })
```

**Estimated effort:** 5 minutes.

### HIGH (P1)

#### H1. No API Timeout Infrastructure
**Severity:** P1 -- affects all pages
**Problem:** Zero fetch calls use AbortController or any timeout mechanism. Every API call can hang indefinitely, freezing the page in a loading state with no escape.

**Affected call sites:**
- homeStore.js `fetchHomepage()` -- homepage data
- feedStore.js `initFeed()`, `fetchMore()` -- feed content
- libraryStore.js `loadFromServer()` -- library data
- SettingsPage.jsx `fetchSources()` -- settings data (6+ fetch calls)
- playerStore.js `resolveStream()` -- video stream URLs

**Proposal:** Create a `fetchWithResilience()` utility:
```jsx
// utils/resilientFetch.js
export async function fetchRetry(url, { timeout = 8000, retries = 2, backoff = 'exponential', onRetry } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) throw err;
      const delay = backoff === 'exponential' ? 1000 * 2 ** attempt : 1000;
      onRetry?.({ attempt: attempt + 1, delay, error: err });
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
```

**Estimated effort:** 30 minutes for utility + 1 hour to wire into all stores.

#### H2. Homepage Silent Fallback
**Severity:** P1 -- UX deception
**Problem:** homeStore.js catches fetch errors and falls back to placeholder data with puppy videos. The user sees content and has no idea it's fake. No "offline" indicator, no "cached" badge, no retry option.

**Proposal:**
1. Add `fetchError` state to homeStore
2. When fallback activates, show amber banner: "Showing cached content. Server unreachable."
3. Add "Retry" button in the banner
4. Slightly dim content (opacity: 0.85) to signal "not live"
5. Show "Last updated: [timestamp]" on cached content

**Estimated effort:** 1 hour.

#### H3. Feed Loading Has No Timeout/Progress Signal
**Severity:** P1 -- UX dead end
**Problem:** FeedPage shows a spinner with "Loading feed..." indefinitely. No elapsed time, no retry countdown, no cached fallback option. Mobile feed screenshot shows a spinner centered on a black screen with no other information.

**Proposal:**
1. After 5s: change text to "Taking longer than usual..."
2. After 10s: show elapsed time + "Retry" button
3. After 15s: auto-retry once, show "Retry 1/2..."
4. After 30s: show "Server may be down" + offer cached content

**Estimated effort:** 45 minutes.

#### H4. Error Boundary Shows Raw Error Messages
**Severity:** P1 -- looks unfinished
**Problem:** ErrorBoundary.jsx shows the raw JavaScript error message to users. "Cannot read properties of undefined (reading 'map')" means nothing to a non-developer. This makes the app feel like a developer tool, not a premium product.

**Proposal:**
1. Map common errors to human-readable messages:
   - TypeError/ReferenceError -> "This section hit a bug. Retrying usually fixes it."
   - fetch/network errors -> "Connection lost. Check your internet and try again."
   - Chunk load errors -> "App was updated. Reloading..."
2. Collapse raw error into a "Technical details" disclosure toggle
3. Add contextual suggestions based on the error type

**Estimated effort:** 45 minutes.

### MEDIUM (P2)

#### M1. Queue Operations Have No Feedback
**Problem:** Adding/removing videos from queue gives zero visual confirmation. Optimistic updates work silently. Sync failures rollback silently. User can't tell if their action succeeded.

**Proposal:**
1. Show toast on queue add: "Added to Queue" with Undo option
2. Show toast on queue remove: "Removed from Queue"
3. If sync fails: amber toast "Queued locally. Will sync when connected."
4. Button icon transition: "+" morphs to checkmark on success

**Estimated effort:** 30 minutes.

#### M2. SettingsPage Has 6+ Silent Error Swallows
**Problem:** Multiple catch blocks in SettingsPage either console.error only (line 56), use empty handlers `() => {}` (line 69), or have no error handling at all (lines 178, 188, 195).

**File-level inventory:**
- Line 56: `fetchSources()` -- console.error only, no UI feedback
- Line 69: username fetch -- `catch(() => {})` empty handler
- Line 178: `handleCookieDelete()` -- no try/catch
- Line 188: `addTagPref()` -- no try/catch
- Line 195: `removeTagPref()` -- no try/catch

**Proposal:** Add toast feedback to all user-initiated actions:
```jsx
try { /* operation */ showToast('Preference saved', 'success') }
catch { showToast('Failed to save. Try again.', 'error') }
```

**Estimated effort:** 30 minutes.

#### M3. No Network State Detection
**Problem:** App has no global awareness of connectivity. OfflineBanner only triggers when queue sync fails. If the user loses internet, nothing happens until they try to navigate or load content.

**Proposal:** Add `navigator.onLine` listener + connection quality detection:
```jsx
// hooks/useNetworkStatus.js
const [online, setOnline] = useState(navigator.onLine)
useEffect(() => {
  window.addEventListener('online', () => setOnline(true))
  window.addEventListener('offline', () => setOnline(false))
}, [])
```

Show global offline banner immediately when connection drops, not just when a specific sync fails.

**Estimated effort:** 30 minutes.

#### M4. Feed Retry Loses Scroll Progress
**Problem:** Feed "Try Again" calls `resetFeed()` + `initFeed()`, clearing the entire video buffer. If the user scrolled through 20 videos and a page fetch fails, retry throws away their progress and starts from video 1.

**Proposal:** Separate "retry last fetch" from "reset entire feed":
- Retry button should only re-attempt the failed fetch
- Keep existing buffer intact
- Only reset on explicit "Refresh" action

**Estimated effort:** 20 minutes.

### LOW (P3)

#### L1. Loading State Transitions Are Hard Cuts
**Problem:** Loading -> loaded and loading -> error are instant swaps. No crossfade, no shared element transition, no motion.
**Estimated effort:** 1 hour for crossfade transitions on all major state changes.

#### L2. Error Recovery Buttons Have No Loading State
**Problem:** Clicking "Try Again" has no visual feedback on the button itself. No spinner, no disabled state, no "Retrying..." text.
**Estimated effort:** 15 minutes.

#### L3. Toast Queue Is Last-One-Wins
**Problem:** toastStore only holds one message. If two actions fire quickly, the first toast is overwritten. Should queue toasts.
**Estimated effort:** 20 minutes.

---

## Sprint-Ready Fix List (Priority Order)

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 1 | Settings null guard (line 536) | 5 min | Fixes 5-run P0 |
| 2 | fetchWithResilience() utility | 30 min | Root cause fix for all timeout/retry issues |
| 3 | Wire fetchRetry into homeStore + feedStore | 1 hr | Timeout + retry on 2 critical paths |
| 4 | Error boundary human-readable messages | 45 min | Hides raw errors, adds contextual help |
| 5 | Homepage transparent degradation | 1 hr | Shows "cached" state instead of silent fake |
| 6 | Feed timeout-aware loading | 45 min | Progress signal + auto-retry + escape hatch |
| 7 | Queue action toasts | 30 min | Feedback for add/remove/sync-fail |
| 8 | SettingsPage silent error fixes | 30 min | Toast on all user actions |
| 9 | Network state detection hook | 30 min | Global offline awareness |
| 10 | Feed retry without buffer reset | 20 min | Preserve scroll progress on retry |

**Total estimated: ~6 hours for comprehensive error resilience upgrade.**

---

## Overall Score: 6.5/10 (up from 5.5)

**Score recovered because Feed and Library load again** (dist/ rebuild fixed the Run 8 regression). Settings still crashes, but 3/4 pages working is a material improvement. The error resilience audit reveals that the infrastructure is thin but the patterns that exist (error boundaries, skeletons, empty states) are well-implemented.

**Score breakdown:**
- Useful: 7/10 (error boundaries work, empty states are contextual, but no retry/timeout)
- Usable: 6/10 (3/4 pages work, Settings still P0, no timeout = potential dead ends)
- Modern: 6.5/10 (skeletons are cinematic, but error UX shows raw JS errors)

**The gap in one sentence:** FeedDeck handles the happy path beautifully but treats every failure as a surprise it never prepared for.

---

## Before/After Mock

Interactive mockup saved to: `docs/design-reviews/2026-04-11-before-after-mock.html`

**What to look for:**
1. **Settings crash** -- contextual error card with human-language explanation + "Load Without Health Check" partial recovery option
2. **Feed loading** -- timeout detection with elapsed timer, auto-retry countdown, "Try Offline Cache" escape hatch
3. **Homepage failure** -- amber reconnecting bar + "showing cached content" transparency + staleness timestamp
4. **Queue feedback** -- micro-confirmation toast with Undo, plus icon-to-checkmark transition
5. **API infrastructure** -- fetchWithResilience() utility code comparison (raw fetch vs. timeout + retry + backoff)

---

## Carryover Items from Previous Runs (Still Open)

From the 8 previous runs, these remain unresolved:
- **P0:** Settings .map() crash (5 runs, 5 minutes to fix)
- **P1:** Featured Section 900px dead space (runs 1, 8)
- **P1:** No curation context on hero/categories (run 8)
- **P1:** Category row visual monotony (run 8)
- **P1:** Full Zustand store subscriptions cause 10-100x re-renders (run 5)
- **P2:** Animation timing tokens unused (0/132 declarations, run 7)
- **P2:** Personalized row titles not surfaced (run 8)
- **P2:** No source badges on cards (run 8)

---

## Next Run Lens

**Run 10 suggestion: Mobile-First Responsive Audit**

We've never done a focused mobile audit. The mobile screenshots show real issues: Featured scroll zone dominates the viewport, Feed spinner is centered with no context, bottom nav bar placement needs validation. Touch targets, viewport behavior, responsive breakpoints, gesture tuning, and bottom nav placement all need scrutiny. This lens has been queued since Run 8 and would complete coverage of a major surface.

Alternative: **Animation & Motion System** -- enforce timing tokens across all 132 transition declarations, add exit animations, test reduced-motion. This is the carryover from Run 7 that keeps getting deferred.
