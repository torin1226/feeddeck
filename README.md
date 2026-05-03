# FeedDeck

Personal media aggregator with dual content discovery modes. Desktop application built with React + Vite (frontend) and Express + SQLite (backend). Targets deployment to Beelink mini server (Ubuntu) by May 2026.

## Getting Started

### Prerequisites
- Node.js 18+ and npm
- Arc browser (for cookie extraction via yt-dlp)

### Installation

```bash
# Navigate to project directory
cd feeddeck

# Install dependencies
npm install

# Start dev server (frontend + backend)
npm run dev
```

**Access points:**
- Frontend: http://localhost:5173 (Vite dev server)
- Backend: http://localhost:3001 (Express API)
- Backend waits for database initialization on first run (~5-10 seconds)

### Common Commands

```bash
npm test                 # Run test suite
npm run lint             # Check code style
npm run build            # Build for production

# Cache management
npm run warm             # Warm all sources
npm run warm:social      # SFW content only
npm run warm:nsfw        # NSFW content only
npm run hydration:health # Check cache health by category
```

## Project Structure

```
feeddeck/
├── src/                  # React frontend
│   ├── components/       # Reusable UI (GalleryRow, Top10Card, etc.)
│   ├── pages/            # Page-level components
│   ├── stores/           # Zustand state managers
│   └── hooks/            # Custom React hooks
├── server/               # Express backend
│   ├── routes/           # API endpoints (/api/homepage, /api/ratings, etc.)
│   ├── sources/          # Content discovery adapters
│   ├── scripts/          # Utilities (warm-cache, probes, health checks)
│   └── feeddeck.db       # SQLite database
├── .claude/              # Claude Code configuration
├── vite.config.js        # Frontend build config (proxies /api to :3001)
└── CLAUDE.md             # Project rules & memory protocol
```

## Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| Frontend | React 18 + Vite + Tailwind | Hot reload, design tokens in tailwind.config.js |
| State | Zustand | modeStore, homeStore, libraryStore, playerStore, etc. |
| Backend | Express.js | Handles discovery, caching, user ratings |
| Database | SQLite via node:sqlite | Cache, watch history, ratings, subscriptions |
| Discovery | yt-dlp + Puppeteer | Extracts metadata & streaming URLs from sources |
| Cookies | Arc browser | `--cookies-from-browser arc` for authenticated sites |

## Architecture Overview

- Frontend requests `/api/homepage` → backend serves cached content from `homepage_cache` table
- Below-threshold cache → sources refill via `feed_cache` → `homepage_cache` pipeline
- Each source has a discovery adapter (yt-dlp for YouTube, Puppeteer for Cloudflare-protected sites, etc.)
- Watch history and ratings stored in SQLite; influence homepage ranking
- Theatre mode (full-screen playback) is primary interaction; no separate detail page

## Key Documentation

| File | Purpose |
|------|---------|
| [CLAUDE.md](./CLAUDE.md) | **START HERE** — project rules, memory protocol, architecture snapshot |
| [BACKLOG.md](../BACKLOG.md) | Priorities and milestone tracking (vault root) |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | System design and data flow (vault root) |
| [DESIGN_DECISIONS.md](../DESIGN_DECISIONS.md) | Rationale for past choices (vault root) |
| [Memory Vault](../_memory/) | Session logs, decisions, errors, project context (vault root) |
| ADR_taste-feedback-system.md | Rating/feedback engine design |
| CONTENT_QUERIES.md | All source queries and category definitions |

## Development Workflow

**Hot reload:** Both frontend (Vite) and backend (node --watch) reload on file changes.

**Testing:** `npm test` runs Vitest suite. Tests exist for scoring, routes, and source adapters.

**Debugging:** Check server logs in terminal for source adapter errors, cache issues, or cookie problems.

## Deployment Notes

**Target:** Beelink Mini S12 (Ubuntu Server 24.04), May 20, 2026.

**Current status:** Desktop frontend complete, content pipeline stable (8+ sources), PM2 config pending, yt-dlp headless verification needed.

**For deployment details:** See memory vault ([../_memory/](../_memory/)) for Beelink prep notes and recent decisions. Hardware: Intel N95, 8GB RAM, 256GB SSD, Ubuntu Server. Uses PM2 for process management and Tailscale for remote access. yt-dlp auto-updates daily at 3am.

**Key consideration:** YouTube extraction and thumbnail loading require tuning on low-spec hardware; see ARCHITECTURE.md for streaming/caching strategy.

## Troubleshooting

**Cache not populating:**
- Check `/api/rows/health` for category status
- Run `npm run hydration:health` for detailed report
- Check terminal for source adapter errors

**Known issues:** See [Memory Vault — Known Issues](../_memory/errors/feeddeck-known-issues.md) for file corruption recovery, anti-bot detection, cookie expiration handling.

**First-run setup:** Database initialization takes 5-10 seconds. Do not interrupt. Check terminal for CREATE TABLE or migration errors.
