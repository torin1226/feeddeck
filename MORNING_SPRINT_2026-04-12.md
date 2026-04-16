# Morning Sprint — 2026-04-12

## Backlog
Diverged. Local: 495 items (30 unchecked). GitHub: 429 items (20 unchecked). Local is ahead of remote.

## Fixes Applied
- Stripped null bytes from 76 source files (`src/**/*.{js,jsx}`), filesystem corruption from prior session crash
- Restored truncated `src/components/home/PosterCard.jsx` from git HEAD (cut off at line 201 of 209)
- Reconstructed `src/components/AppShell.jsx` with uncommitted VideoDetailPage route that was lost in truncation
- Reconstructed `src/pages/HomePage.jsx` with uncommitted GalleryShelf/BrowseSection/Top10Row layout
- Reconstructed `src/components/home/BrowseSection.jsx` with uncommitted GalleryRow refactor + Continue Watching logic
- Restored `Skeletons.jsx`, `Top10Row.jsx`, `useHoverPreview.js` from git HEAD
- Removed 5 unused declarations in `GalleryRow.jsx`: `useMemo`, `FOCUS_SCALE`, `CARD_HEIGHT`, `EASE_SPRING`, `EASE_OUT`
- ESLint: 0 errors, 0 warnings (was 9 errors + 5 warnings)

## New Risks Found
- **Git index corruption**: `.git/index` has bad signature, `.git/index.lock` cannot be removed (permission denied). All git operations (status, diff, commit, checkout) fail. Must be fixed on the host machine before any commits can be made. Run: `rm .git/index.lock && git reset` from Windows.
- **Reconstructed files need verification**: BrowseSection and HomePage had uncommitted architectural changes (GalleryRow replacing TheatreRow/PosterShelf) that only existed in the truncated working tree. Manually reconstructed from partial content. Verify these match intended state before committing.
