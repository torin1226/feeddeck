#!/usr/bin/env node
// Test: verify the FikFap adapter returns real video data.
// Run: cd feeddeck && node server/scripts/test-fikfap.mjs
//
// Validates:
//   1. searchFikFap() returns 5+ videos with populated title/url/thumbnail
//   2. search() routes fikfap.com correctly
//   3. fetchCategory() handles fikfap.com URLs
//   4. Different sort options (trending, new, top) all work

import { ScraperAdapter } from '../sources/scraper.js'

const scraper = new ScraperAdapter()
let passed = 0
let failed = 0

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  PASS: ${label}`)
    passed++
  } else {
    console.log(`  FAIL: ${label} ${detail}`)
    failed++
  }
}

async function testSearchFikFap() {
  console.log('\n=== 1. searchFikFap() direct call ===')
  try {
    const videos = await scraper.searchFikFap('https://fikfap.com/trending', { limit: 10 })
    assert(Array.isArray(videos), 'Returns an array')
    assert(videos.length >= 5, `At least 5 videos (got ${videos.length})`)

    // Check each video has required fields
    for (let i = 0; i < Math.min(3, videos.length); i++) {
      const v = videos[i]
      assert(v.title && v.title.length > 0, `Video ${i} has title: "${v.title?.slice(0, 60)}"`)
      assert(v.url && v.url.startsWith('https://fikfap.com/'), `Video ${i} has url: ${v.url?.slice(0, 60)}`)
      assert(v.thumbnail && v.thumbnail.startsWith('https://'), `Video ${i} has thumbnail`)
      assert(typeof v.source === 'string', `Video ${i} has source: ${v.source}`)
      assert(typeof v.uploader === 'string', `Video ${i} has uploader: ${v.uploader}`)
    }

    // Print first 5 videos for visual inspection
    console.log('\n  First 5 results:')
    for (const v of videos.slice(0, 5)) {
      console.log(`    "${v.title?.slice(0, 50)}" by ${v.uploader} | views=${v.view_count} | ${v.url}`)
    }
  } catch (err) {
    console.log(`  FAIL: searchFikFap threw: ${err.message}`)
    failed++
  }
}

async function testSearchRouting() {
  console.log('\n=== 2. search() routing for fikfap.com ===')
  try {
    // Test with URL-as-query (the refillCategory pattern)
    const videos = await scraper.search('https://fikfap.com/trending', { site: 'fikfap.com', limit: 5 })
    assert(videos.length >= 3, `URL-as-query returns results (got ${videos.length})`)
    assert(videos[0]?.url?.includes('fikfap.com'), 'Results have fikfap URLs')
  } catch (err) {
    console.log(`  FAIL: search() routing threw: ${err.message}`)
    failed++
  }
}

async function testFetchCategory() {
  console.log('\n=== 3. fetchCategory() with fikfap.com URL ===')
  try {
    const videos = await scraper.fetchCategory('https://fikfap.com/trending', { limit: 5 })
    assert(videos.length >= 3, `fetchCategory returns results (got ${videos.length})`)
    assert(videos[0]?.thumbnail?.startsWith('https://'), 'Results have thumbnails')
  } catch (err) {
    console.log(`  FAIL: fetchCategory threw: ${err.message}`)
    failed++
  }
}

async function testSortOptions() {
  console.log('\n=== 4. Sort options ===')
  const sorts = [
    ['trending', 'https://fikfap.com/trending'],
    ['new', 'https://fikfap.com/new'],
    ['top', 'https://fikfap.com/top'],
  ]
  for (const [label, query] of sorts) {
    try {
      const videos = await scraper.searchFikFap(query, { limit: 3 })
      assert(videos.length >= 1, `sort=${label} returns results (got ${videos.length})`)
    } catch (err) {
      console.log(`  FAIL: sort=${label} threw: ${err.message}`)
      failed++
    }
  }
}

async function testSiteKey() {
  console.log('\n=== 5. _getSiteKey() handles fikfap.com ===')
  assert(scraper._getSiteKey('fikfap.com') === 'fikfap.com', 'fikfap.com')
  assert(scraper._getSiteKey('www.fikfap.com') === 'fikfap.com', 'www.fikfap.com')
}

async function testSupportedDomains() {
  console.log('\n=== 6. supportedDomains includes fikfap.com ===')
  assert(scraper.supportedDomains.includes('fikfap.com'), 'fikfap.com in supportedDomains')
  assert(scraper.handlesDomain('fikfap.com'), 'handlesDomain("fikfap.com")')
}

// Run all tests
try {
  await testSiteKey()
  await testSupportedDomains()
  await testSearchFikFap()
  await testSearchRouting()
  await testFetchCategory()
  await testSortOptions()
} catch (err) {
  console.error('\nUnexpected error:', err)
  failed++
}

// Summary
console.log(`\n${'='.repeat(40)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
console.log(`${'='.repeat(40)}`)

// Cleanup
await scraper.close()
process.exit(failed > 0 ? 1 : 0)
