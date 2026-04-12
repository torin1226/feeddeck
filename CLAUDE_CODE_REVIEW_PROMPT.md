# Claude Code Review Prompt — April 11, 2026

Paste this into Claude Code to address the critical and high-severity findings from today's automated review.

---

## Prompt

```
Review and fix the following issues in the FeedDeck codebase. Work through them in order. After each fix, run `npx eslint` on the changed file to verify no new issues.

### 1. CRITICAL: Fix package.json corruption
The file is truncated at ~line 44. Restore it:
- Run: `git log --oneline package.json` to find the last good commit
- Run: `git show <good-commit>:package.json > package.json`
- Run: `npm install` to verify it works
- Run: `npm run build` to verify the build passes

### 2. CRITICAL: EventSource memory leak in src/pages/SettingsPage.jsx
The `runSeed()` function creates an EventSource (~line 87) but never cleans it up on unmount.

Fix:
- Store the EventSource in a useRef
- Add a useEffect cleanup that calls `.close()` on the ref when the component unmounts or when seeding completes
- Also add a guard at the top of runSeed: `if (seedRunning) return` to prevent double-invocation

### 3. CRITICAL: Unhandled fetch rejections in src/pages/SettingsPage.jsx
These async functions call fetch() without try/catch and show success toasts even on failure:
- toggleSource (~line 114)
- deleteSource (~line 120)
- handleCookieUpload (~line 173)
- handleCookieDelete (~line 185)
- addTagPref
- removeTagPref

Fix: Wrap each in try/catch. On catch, show an error toast instead of success. Pattern:
```js
try {
  const res = await fetch(...)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  showToast('Source updated', 'success')
} catch (err) {
  showToast(`Failed: ${err.message}`, 'error')
}
```

### 4. HIGH: Puppeteer browser launch error handling in server/sources/scraper.js
In `_getBrowser()` (~line 155), if `pptr.launch()` throws, the browser ref stays in a bad state.

Fix:
```js
try {
  this.browser = await pptr.launch({...})
} catch (err) {
  this.browser = null
  throw new Error(`Puppeteer launch failed: ${err.message}`)
}
```

### 5. HIGH: Missing page.evaluate timeout in server/sources/scraper.js
The `page.evaluate()` call (~line 230) for DOM extraction has no timeout. If JS hangs, the process stalls.

Fix: Wrap in Promise.race with a 15-second timeout:
```js
const videos = await Promise.race([
  page.evaluate(extractFn),
  new Promise((_, reject) => setTimeout(() => reject(new Error('Page evaluate timeout (15s)')), 15000))
])
```

### 6. HIGH: Unvalidated JSON.parse in server/routes/feed.js
Around line 95, `JSON.parse(v.tags || '[]')` can crash on malformed data.

Fix: Use a safeParse utility or wrap in try/catch:
```js
let videoTags = []
try { videoTags = JSON.parse(v.tags || '[]').map(t => t.toLowerCase()) } catch {}
```

### 7. MEDIUM: NaN risk in scraper.js view count parsing
Around line 288, `parseFloat(viewMatch[1])` result is never checked for NaN.

Fix: Add `|| 0` fallback:
```js
viewCount = parseFloat(viewMatch[1]) || 0
```

After all fixes:
- Run `npx eslint src/ server/` — should be 0 errors
- Run `npm run build` — should succeed
- Run `npx vitest run` — existing tests should still pass
- Commit with message: "fix: address critical code review findings (EventSource leak, error handling, package.json)"
```

---

## Context for Claude Code

The codebase is a React + Express + SQLite video aggregator. Server is at `server/`, frontend at `src/`. The server was recently partially modularized from a monolith `server/index.js` into `server/routes/*.js` files. ESLint and Vitest are configured. The project uses ES modules throughout.
