// ============================================================
// Source Adapter Index
// Sets up all adapters and registers them with the registry.
// Import this once at server startup.
//
// Architecture:
//   Discovery (finding new content):
//     - ScraperAdapter: Puppeteer-based, handles NSFW site browsing
//     - YtDlpAdapter: fallback search via yt-dlp playlist extraction
//
//   Extraction (getting stream URLs / metadata for known URLs):
//     - YtDlpAdapter: primary extractor (1000+ sites)
//     - CobaltAdapter: SFW fallback (YouTube, TikTok, Instagram, etc.)
//
//   The registry routes requests to the right adapter and falls
//   through the chain if one fails. No single point of failure.
// ============================================================

import { registry } from './registry.js'
import { YtDlpAdapter } from './ytdlp.js'
import { ScraperAdapter } from './scraper.js'
import { CobaltAdapter } from './cobalt.js'

// Create adapter instances
const ytdlp = new YtDlpAdapter()
const scraper = new ScraperAdapter()
const cobalt = new CobaltAdapter()

// Register adapters
// Order matters: first registered with a capability becomes primary for fallback chains

// Scraper is primary for NSFW discovery (search, categories, trending)
registry.register(scraper, { primary: true })

// yt-dlp is the universal fallback and primary extractor
registry.register(ytdlp, { primary: false })

// Cobalt is the SFW extraction fallback
registry.register(cobalt, { primary: false })

// Cleanup hook for graceful shutdown
export async function closeAllSources() {
  await scraper.close()
}

// Export individual adapters for direct access when needed
export { registry, ytdlp, scraper, cobalt }
