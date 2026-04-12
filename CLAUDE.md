# FeedDeck

## Local Environment
- **Local path:** `C:\Users\torin\Documents\Claude\area 51\feeddeck`

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

## Current Architecture (as of 2026-04-11)
Homepage: `HomePage -> BrowseSection -> TheatreRow`. Hero at 100vh with Up Next carousel (infinite scroll). 3 theatre-size card rows with parallax. Feed transition at end of last row.

Dead code (not imported): FeaturedSection, useFeaturedScroll, CategoryRow, CategoryRows, ContinueWatchingRow, Top10Row.

Build is clean as of 2026-04-11.
