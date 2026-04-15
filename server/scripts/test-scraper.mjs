#!/usr/bin/env node
// End-to-end test: run the actual scraper against SpankBang + RedGifs.
// Run: node server/scripts/test-scraper.mjs
// Tests trending, search, category, URL-as-query (refillCategory path), and RedGifs.

import { ScraperAdapter } from '../sources/scraper.js'

const scraper = new ScraperAdapter()

async function testTrending() {
  console.log('=== SpankBang Trending (fetchTrending) ===')
  try {
    const videos = await scraper.fetchTrending({ site: 'spankbang.com', limit: 3 })
    console.log(`Got ${videos.length} videos`)
    for (const v of videos) {
      console.log(`  "${v.title?.slice(0, 50)}" dur=${v.duration}s url=${v.url?.slice(0, 70)}`)
    }
  } catch (err) {
    console.error(`FAILED:`, err.message)
  }
}

async function testCategoryUrl() {
  console.log('\n=== SpankBang Category (fetchCategory) ===')
  try {
    const videos = await scraper.fetchCategory('https://spankbang.com/t/amateur/', { limit: 3 })
    console.log(`Got ${videos.length} videos`)
    for (const v of videos) {
      console.log(`  "${v.title?.slice(0, 50)}" dur=${v.duration}s url=${v.url?.slice(0, 70)}`)
    }
  } catch (err) {
    console.error(`FAILED:`, err.message)
  }
}

async function testSearch() {
  console.log('\n=== SpankBang Search (text query) ===')
  try {
    const videos = await scraper.search('popular', { site: 'spankbang.com', limit: 3 })
    console.log(`Got ${videos.length} videos`)
    for (const v of videos) {
      console.log(`  "${v.title?.slice(0, 50)}" dur=${v.duration}s url=${v.url?.slice(0, 70)}`)
    }
  } catch (err) {
    console.error(`FAILED:`, err.message)
  }
}

async function testUrlAsQuery() {
  console.log('\n=== SpankBang URL-as-query (refillCategory path) ===')
  console.log('This simulates what refillCategory does: registry.search(url, {site})')
  try {
    // This is the exact call refillCategory makes for nsfw_spankbang
    const videos = await scraper.search('https://spankbang.com/trending_videos/', { site: 'spankbang.com', limit: 3 })
    console.log(`Got ${videos.length} videos`)
    for (const v of videos) {
      console.log(`  "${v.title?.slice(0, 50)}" dur=${v.duration}s url=${v.url?.slice(0, 70)}`)
    }
  } catch (err) {
    console.error(`FAILED:`, err.message)
  }
}

async function testRedGifs() {
  console.log('\n=== RedGifs Search ===')
  try {
    const videos = await scraper.search('popular', { site: 'redgifs.com', limit: 3 })
    console.log(`Got ${videos.length} videos`)
    for (const v of videos) {
      console.log(`  "${v.title?.slice(0, 40)}" dur=${v.duration}s url=${v.url?.slice(0, 60)}`)
    }
  } catch (err) {
    console.error(`FAILED:`, err.message)
  }
}

async function run() {
  await testTrending()
  await testCategoryUrl()
  await testSearch()
  await testUrlAsQuery()
  await testRedGifs()
  await scraper.close()
  console.log('\nAll tests complete.')
}

run().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
