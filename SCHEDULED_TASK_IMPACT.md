# Scheduled Task: Review Memory & Backlog Cleanup

Tracks cumulative impact across scheduled review sessions.

---

## Session 1 — 2026-04-10

**Branch:** `claude/loving-ritchie-Iobg5`
**Duration:** Single session
**Items completed:** 5 backlog items (planned 5, delivered 5)

### Planned Sequence
1. Cookie mode forwarding (3.4.1) — functional/security fix
2. Color token consolidation (5.4) — design debt
3. Glass material tokens (5.4) — design debt
4. Card top highlights (5.4) — design debt
5. Service worker video caching (2.8 Tier 3) — performance

### Items Delivered

| # | Backlog Item | Section | Impact |
|---|-------------|---------|--------|
| 1 | Cookie mode forwarding | 3.4.1 | **Security fix** — NSFW cookies no longer leak into social requests. Mode context threaded through entire adapter chain (cookies.js, base.js, registry.js, ytdlp.js, index.js). 12+ call sites updated. |
| 2 | Color token consolidation | 5.4 | **Design debt** — Added `highlight` token family (subtle/DEFAULT/medium/strong) with CSS vars + Tailwind config. Replaced ~35 raw color instances (`bg-gray-900/*`, `bg-white/*`, `border-white/*`) across 7 components. Light theme support included. |
| 3 | Glass material tokens | 5.4 | **Design debt** — Created `.glass` and `.glass-heavy` CSS utility classes with theme-aware CSS variables. Standardized backdrop-blur + opacity patterns across 5 glass panel components. |
| 4 | Card top highlights | 5.4 | **Design polish** — Added `border-t-highlight-medium` to 3 raised card panels for depth effect. Top border (15% white) is brighter than side borders (10%) to simulate overhead light on glass. |
| 5 | Service worker video caching | 2.8 T3 | **Performance** — Created `public/sw.js` that caches first 500KB of each video response. Max 30 entries with LRU eviction. Registered in `src/main.jsx`. Range requests (seeking) bypass cache. |

### Files Changed
- `server/cookies.js` — Added `mode` parameter to `getCookieArgs()`
- `server/sources/base.js` — Added `options` to extraction method signatures
- `server/sources/registry.js` — Threaded `options` through `extractMetadata()` and `getStreamUrl()`
- `server/sources/ytdlp.js` — Threaded `mode` through `ytdlp()` helper, all adapter methods, and `streamSearch()`
- `server/index.js` — Updated 12+ call sites to forward mode context, grouped TTL monitor by mode
- `src/index.css` — Added glass/highlight CSS variables and utility classes
- `tailwind.config.js` — Added `glass` and `highlight` color tokens
- `src/main.jsx` — Service worker registration
- `public/sw.js` — New service worker for video segment caching
- 7 JSX components — Replaced raw colors with design tokens

### Backlog Impact
- **M2 (Swipe Feed): 98% -> 100%** — Service worker was the last remaining item
- **M3 (Discovery): 3.4.1 cookie forwarding complete** — 1 sub-item resolved
- **M5 (Design Polish): 3 deferred [?] items resolved** — Color consolidation, glass materials, card highlights

### Overall Backlog Progress
- Before: ~198/224 tasks (88%)
- After: ~203/224 tasks (91%)
- M2 is now fully complete (55/55)

---

## Cumulative Impact

| Metric | Total |
|--------|-------|
| Sessions | 1 |
| Items completed | 5 |
| Files changed | 15 |
| Milestones completed | M2 (100%) |
| Security fixes | 1 (cookie isolation) |
| Design tokens added | 8 (4 highlight + 2 glass + 2 utility classes) |
| Components tokenized | 7 |
