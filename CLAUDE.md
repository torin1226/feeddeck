# FeedDeck

## Local Environment
- **Local path:** `C:\Users\torin\Documents\Claude\area 51\feeddeck`

## Backlog Location (NON-NEGOTIABLE)

**The backlog lives at the vault root: `../BACKLOG.md`** (one level up from this directory; absolute path `C:\Users\torin\Documents\Claude\area 51\BACKLOG.md`). Companion archive: `../BACKLOG-ARCHIVE.md`.

There used to be a `feeddeck/BACKLOG.md` here too. As of 2026-05-02 it is a redirect stub — do not edit it. Any reference to "BACKLOG.md" in skills, prompts, or docs that resolves into this directory is stale; treat it as pointing at `../BACKLOG.md`. See `../_memory/decisions/2026-05-02-backlog-consolidation.md` for the full rationale.

## Memory Protocol (NON-NEGOTIABLE)

This project has a persistent memory vault at `../_memory/`. You MUST read it before doing ANY work.

### On Session Start (BEFORE doing anything else):
1. Read `../_memory/_INDEX.md`
2. Read `../_memory/_GLOBAL.md`
3. Read `../_memory/projects/feeddeck/_PROJECT.md`
4. Find the most recent file in `../_memory/sessions/` and read it
5. Check `../_memory/errors/feeddeck-known-issues.md` if relevant

If you skip these reads, you will miss critical context and repeat solved problems. Torin will call you on it.

### On Session End (BEFORE stopping work):
1. Write a session log to `../_memory/sessions/YYYY-MM-DD-HH.md` (copy template from `_TEMPLATE.md`, fill every section)
2. If you made architectural decisions, create a note in `../_memory/decisions/`
3. If you hit a non-obvious bug, add to `../_memory/errors/feeddeck-known-issues.md`
4. Update `../_memory/projects/feeddeck/_PROJECT.md` if current state changed

### Backlinks
Use Obsidian `[[wikilink]]` syntax in all memory notes.

## Stack
React + Vite + Tailwind, Zustand stores, Express backend on port 3001, SQLite via node:sqlite, yt-dlp with Arc cookies.

## Modes
SFW (social) and NSFW (adult). Clean separation. Default SFW. Escape = panic to SFW. Don't mention adult content in code comments or filenames.

## Current Architecture (as of 2026-04-12)
Homepage: `HomePage -> GalleryShelf + BrowseSection -> GalleryRow, Top10Row`. Hero at 100vh with Up Next carousel. PosterShelf/GalleryShelf cards 50vh tall; landscape rows (BrowseSection categories, Continue Watching) capped at min(50vh, 360px). Hover previews via `useHoverPreview` hook (module-level singleton pattern, no separate manager file). Card clicks open theatre mode (setHeroItem + setTheatreMode), NOT navigate to `/video/:id`. VideoDetailPage.jsx exists but is unused from browse UI.

Dead code (deleted 2026-04-12): FeaturedSection, useFeaturedScroll, CategoryRow, CategoryRows.

Build is clean as of 2026-04-14.
