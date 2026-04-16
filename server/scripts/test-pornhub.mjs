#!/usr/bin/env node
// End-to-end test: run the scraper against PornHub.
// Run: node server/scripts/test-pornhub.mjs
// Tests trending discovery via Puppeteer CSS selectors.

import { ScraperAdapter } from '../sources/scraper.js'

const scraper = new ScraperAdapter()

async function testTrending() {
  console.log('=== PornHub Trending (fetchTrending) ===')
  try {
    const videos = await scraper.fetchTrending({ site: 'pornhub.com', limit: 5 })
    console.log(`Got ${videos.length} videos`)
    for (const v of videos) {
      console.log(`  "${v.title?.slice(0, 60)}" dur=${v.duration}s url=${v.url?.slice(0, 80)}`)
    }
    return videos
  } catch (err) {
    console.error(`FAILED:`, err.message)
    return []
  }
}

async function testSearch() {
  console.log('\n=== PornHub Search (text query) ===')
  try {
    const videos = await scraper.search('popular', { site: 'pornhub.com', limit: 3 })
    console.log(`Got ${videos.length} videos`)
    for (const v of videos) {
      console.log(`  "${v.title?.slice(0, 60)}" dur=${v.duration}s url=${v.url?.slice(0, 80)}`)
    }
    return videos
  } catch (err) {
    console.error(`FAILED:`, err.message)
    return []
  }
}

async function run() {
  const trending = await testTrending()
  const searched = await testSearch()
  await scraper.close()

  console.log('\n=== SUMMARY ===')
  console.log(`Trending: ${trending.length} videos found`)
  console.log(`Search: ${searched.length} videos found`)

  // Print URLs for yt-dlp testing
  const allUrls = [...trending, ...searched].map(v => v.url).filter(Boolean)
  if (allUrls.length > 0) {
    console.log('\nFirst 3 URLs for yt-dlp testing:')
    for (const url of allUrls.slice(0, 3)) {
      console.log(`  ${url}`)
    }
  }

  console.log('\nAll tests complete.')
}

run().catch(err => {
  console.error('Fatal:', err)
  scraper.close().catch(() => {})
  process.exit(1)
})
