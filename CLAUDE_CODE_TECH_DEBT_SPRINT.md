# Tech Debt Sprint — Parallel Sub-Agent Prompt

> Paste this into Claude Code. Each numbered section is designed to run as an independent sub-agent with no file conflicts between them. Launch all 5 in parallel.

---

## Instructions

Run these 5 tasks as parallel sub-agents. They are scoped to avoid file conflicts. Each agent should commit its own work to a feature branch. Do NOT modify files outside your assigned scope.

---

## Agent 1: Server Modularization (`server/index.js` → route modules)

**Branch:** `refactor/server-routes`

**Problem:** `server/index.js` is a 2,069-line monolith. Every feature touches this file, merge conflicts are guaranteed, and it's impossible to reason about.

**Task:** Extract route handlers into separate modules. Keep `server/index.js` as the Express app setup + middleware + route mounting only.

**File mapping (create these new files):**

| New File | Line Range in index.js | Routes |
|----------|----------------------|--------|
| `server/routes/stream.js` | ~153-378 | `/api/stream-url`, `/api/stream-formats`, `/api/proxy-stream`, `/api/hls-proxy` |
| `server/routes/library.js` | ~380-577 | `/api/videos/*`, `/api/cookies/*` |
| `server/routes/recommendations.js` | ~578-917 | `/api/tags/*`, `/api/recommendations/*`, `/api/discover` |
| `server/routes/content.js` | ~919-1450 | `/api/playlists/*`, `/api/search/*`, `/api/trending`, `/api/categories`, `/api/homepage/*` |
| `server/routes/feed.js` | ~1452-1669 | `/api/feed/*`, `/api/queue/*` |
| `server/routes/tiktok.js` | ~1670-2069 | `/api/tiktok/*` |

**Pattern for each route file:**
```js
import { Router } from 'express'
const router = Router()
// move route handlers here, keeping db/helpers as imports
export default router
```

**In index.js, mount like:**
```js
app.use('/api', streamRoutes)
app.use('/api', libraryRoutes)
// etc.
```

**Rules:**
- Shared helpers (db, getCookieArgs, execFileAsync, logger) stay in index.js or get extracted to `server/utils.js` and imported by each route file
- Do NOT change any route paths, request/response shapes, or business logic
- Do NOT touch any files in `src/` (frontend)
- After extraction, `server/index.js` should be under 200 lines
- Run the server and hit `/api/health` to verify it boots

---

## Agent 2: JSON.parse Safety + Error Handling Hardening (`server/` only, NOT index.js routes)

**Branch:** `fix/error-handling`

**Problem:** Bare `JSON.parse` on yt-dlp output crashes the server. Error handling is inconsistent.

**Wait for Agent 1 to finish if running sequentially. If parallel, work on these files only:**
- `server/utils.js` (create new)
- `server/scripts/process-tiktok-imports.js`
- `server/sources/scraper.js`

**If Agent 1 has already split routes**, apply JSON.parse fixes in the new route files instead. If not, apply directly in `server/index.js` at these locations:

**Task 1: Create `server/utils.js` with safeParse:**
```js
export function safeParse(str, fallback = null) {
  try {
    return JSON.parse(str)
  } catch (err) {
    console.error('[safeParse] Failed to parse:', str?.slice(0, 200), err.message)
    return fallback
  }
}
```

**Task 2: Fix unguarded JSON.parse calls on external data:**
- Line 227: `JSON.parse(stdout)` after yt-dlp exec — wrap with safeParse, return 502 if null
- Line 775: `JSON.parse(stdout)` after yt-dlp exec — wrap with safeParse, skip entry if null

**Task 3: Fix ESLint errors:**
- `server/scripts/process-tiktok-imports.js:77` — Add `{ cause: err }` to the thrown Error:
  ```js
  throw new Error(err.stderr?.split('\n')[0] || err.message, { cause: err })
  ```
- `server/sources/scraper.js:224,230` — Add eslint-disable comments for `no-undef` above `window.scrollBy` and `document.querySelectorAll` calls (they run inside Puppeteer's `page.evaluate` browser context)

**Task 4: Fix unused variables in server code** — address the 26 ESLint warnings, focusing on server/ files. Remove dead code, prefix intentionally unused params with `_`.

**Verify:** `npx eslint server/ --max-warnings 5` (target: 0 errors, under 5 warnings)

---

## Agent 3: Build Fix + Dev Tooling (`dist/`, `vite.config.js`, `package.json`, project root only)

**Branch:** `fix/build-and-tooling`

**Problem:** Vite build fails on dist/ permission errors. No test infrastructure exists. ESLint has regressions.

**Task 1: Fix Vite build**
- `rm -rf dist/`
- Run `npx vite build`
- If chunk size warnings appear, that's known and OK for now
- Verify `dist/index.html` exists and references built assets

**Task 2: Set up test infrastructure**
- Install vitest: `npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom`
- Create `vitest.config.js` at project root (use jsdom environment)
- Create `src/__tests__/` directory
- Write 3 starter tests proving the infra works:
  - `src/__tests__/playerStore.test.js` — test that playerStore initializes with null activeVideo
  - `src/__tests__/feedStore.test.js` — test that feedStore initializes with empty buffer
  - `src/__tests__/safeParse.test.js` — test the safeParse util (if Agent 2 created it) or create a local version
- Add `"test": "vitest run"` to package.json scripts
- Run `npm test` and verify all 3 pass

**Task 3: Clean up project root**
- Delete all `vite.config.js.timestamp-*` files (there are 15+ of them cluttering the root)
- These are Vite temp files that shouldn't persist

**Rules:**
- Do NOT modify any files in `src/components/`, `src/pages/`, `src/stores/`, or `server/`
- Only touch: `dist/`, `vite.config.js`, `vitest.config.js` (new), `package.json`, `package-lock.json`, project root cleanup

---

## Agent 4: MLP UX Polish — Feed + Playback Experience (`src/components/feed/`, `src/pages/FeedPage.jsx` only)

**Branch:** `feat/feed-mlp-polish`

**Problem:** The feed is the core product experience but has several gaps that prevent it from feeling "lovable": generic loading states, no error recovery, FeedVideo memory leak pattern.

**Task 1: Feed loading skeleton**
- Replace the text "Loading more..." in FeedPage.jsx with a proper skeleton card (match the SkeletonCard pattern from `src/components/Skeletons.jsx`)
- Show 1-2 skeleton cards while the next batch loads

**Task 2: Feed empty state improvement**
- Current empty state says "No videos in feed yet" — too vague
- Replace with guided empty state: "Add sources in Settings to start your feed" with a button/link to Settings
- If sources exist but feed is empty: "No videos match your current filters. Try adjusting your source or tag filters."

**Task 3: FeedVideo cleanup hardening**
- In `src/components/feed/FeedVideo.jsx`, the module-level `_sharedVideo` (line 19) is never destroyed if a component unmounts mid-error
- Add a safety check: if `_sharedVideo` exists but has no parent node, null it out and recreate
- Ensure the useEffect cleanup at ~line 240 always fires even if the component errors (wrap the cleanup return in the effect, not conditionally)

**Task 4: Error recovery in feed**
- When a video fails to load in the feed, show a retry card instead of silently skipping
- Pattern: "Couldn't load this video. [Tap to retry] [Skip]"
- Wire retry to re-fetch the stream URL via the existing `handleStreamError` pattern

**Rules:**
- Only modify files in `src/components/feed/` and `src/pages/FeedPage.jsx`
- Do NOT touch `src/pages/SettingsPage.jsx`, `src/components/home/`, or `server/`
- Reference existing patterns (Skeletons.jsx, toastStore) but don't modify them

---

## Agent 5: MLP UX Polish — Homepage + Global (`src/components/home/`, `src/components/AppShell.jsx`, `src/components/ErrorBoundary.jsx`, `src/hooks/`)

**Branch:** `feat/homepage-mlp-polish`

**Problem:** Homepage is functional but missing confirmation dialogs, focus traps on modals, and semantic landmarks that make it feel "finished."

**Task 1: Confirmation dialog for destructive actions**
- Create `src/components/ConfirmDialog.jsx` — minimal modal with title, message, Cancel/Confirm buttons
- Uses Zustand or simple state. Matches existing modal styling (backdrop-blur, dark card).
- Implement focus trap (a `useFocusTrap` hook already exists in `src/hooks/` — use it)

**Task 2: Wire confirmation into source deletion**
- Find where sources are hidden/deleted in the UI (likely in a context menu or settings-adjacent component in `src/components/home/`)
- Wrap the delete action with ConfirmDialog: "Remove this source? Videos already in your library won't be affected."
- If the delete action lives in SettingsPage.jsx (which is off-limits), just create the ConfirmDialog component and leave a TODO comment noting where to wire it

**Task 3: Semantic HTML landmarks**
- In `AppShell.jsx`, wrap the main content area in `<main>` with `role="main"`
- Wrap navigation in `<nav>` with `aria-label="Main navigation"`
- Add `<h1>` to each page (visually hidden if needed with `sr-only` class) for screen reader heading hierarchy

**Task 4: Error boundary upgrade**
- In `ErrorBoundary.jsx`, add error type detection:
  - Network errors: "Connection lost. Check your network and try again."
  - Chunk load errors (lazy import failures): "App updated. Refreshing..." + auto-reload
  - Generic: keep existing message
- Log errors to console with component stack for debugging

**Rules:**
- Only modify files in `src/components/home/`, `src/components/AppShell.jsx`, `src/components/ErrorBoundary.jsx`, `src/hooks/`, and new files in `src/components/`
- Do NOT touch `src/pages/`, `src/components/feed/`, `src/stores/`, or `server/`

---

## After All Agents Complete

1. Merge branches in order: Agent 1 → Agent 2 → Agent 3 → Agent 4 → Agent 5
2. Run `npx vite build` — must succeed
3. Run `npx eslint src/ server/` — target: 0 errors, under 5 warnings
4. Run `npm test` — all tests pass
5. Start the server and verify homepage loads with real data

If merge conflicts occur between Agent 4/5 (both touch `src/components/`), Agent 5 yields to Agent 4 on any shared files.
