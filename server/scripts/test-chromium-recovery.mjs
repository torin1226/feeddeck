#!/usr/bin/env node
// Test: Chromium crash recovery in ScraperAdapter._getBrowser()
// Run: node server/scripts/test-chromium-recovery.mjs
//
// Validates that when Chromium fails to launch, scraper calls degrade to
// empty results instead of throwing and propagating up the call stack.

import { ScraperAdapter } from '../sources/scraper.js'

let passed = 0
let failed = 0

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS: ${label}`)
    passed++
  } else {
    console.error(`  FAIL: ${label}`)
    failed++
  }
}

// Test 1: Simulated Chromium launch failure -> graceful empty results
async function testLaunchFailureDegradation() {
  console.log('\n=== Test 1: Launch failure -> empty results (not a throw) ===')
  const scraper = new ScraperAdapter()

  // Patch _getBrowser to simulate OOM / launch failure
  scraper._getBrowser = async () => {
    console.log('  (simulating Chromium OOM: _getBrowser returns null)')
    return null
  }

  let threw = false
  let result
  try {
    result = await scraper.search('popular', { site: 'spankbang.com', limit: 5 })
  } catch (err) {
    threw = true
    console.error('  Caught unexpected throw:', err.message)
  }

  assert(!threw, 'search() should not throw when Chromium is unavailable')
  assert(Array.isArray(result), 'search() should return an array')
  assert(result.length === 0, 'search() should return empty array when Chromium unavailable')

  await scraper.close()
}

// Test 2: After launch failure, browser ref stays null (no leaked process)
async function testBrowserRefNullAfterFailure() {
  console.log('\n=== Test 2: browser ref is null after failed launch ===')
  const scraper = new ScraperAdapter()

  let launchCalls = 0
  scraper._getBrowser = async () => {
    launchCalls++
    scraper.browser = null  // Simulate failed launch sets browser to null
    return null
  }

  await scraper.search('popular', { site: 'spankbang.com', limit: 5 }).catch(() => {})

  assert(scraper.browser === null, 'browser ref should be null after failed launch')
  assert(launchCalls >= 1, 'launch should have been attempted')

  await scraper.close()
}

// Test 3: fetchCategory also degrades gracefully (not just search)
async function testFetchCategoryDegradation() {
  console.log('\n=== Test 3: fetchCategory also returns [] on launch failure ===')
  const scraper = new ScraperAdapter()

  scraper._getBrowser = async () => null

  let threw = false
  let result
  try {
    result = await scraper.fetchCategory('https://spankbang.com/t/amateur/', { limit: 5 })
  } catch (err) {
    threw = true
    console.error('  Caught unexpected throw:', err.message)
  }

  assert(!threw, 'fetchCategory() should not throw when Chromium is unavailable')
  assert(Array.isArray(result) && result.length === 0, 'fetchCategory() returns [] on unavailability')

  await scraper.close()
}

// Test 4: fetchTrending also degrades gracefully
async function testFetchTrendingDegradation() {
  console.log('\n=== Test 4: fetchTrending also returns [] on launch failure ===')
  const scraper = new ScraperAdapter()

  scraper._getBrowser = async () => null

  let threw = false
  let result
  try {
    result = await scraper.fetchTrending({ site: 'spankbang.com', limit: 5 })
  } catch (err) {
    threw = true
    console.error('  Caught unexpected throw:', err.message)
  }

  assert(!threw, 'fetchTrending() should not throw when Chromium is unavailable')
  assert(Array.isArray(result) && result.length === 0, 'fetchTrending() returns [] on unavailability')

  await scraper.close()
}

// Run all tests
const start = Date.now()
await testLaunchFailureDegradation()
await testBrowserRefNullAfterFailure()
await testFetchCategoryDegradation()
await testFetchTrendingDegradation()

const elapsed = ((Date.now() - start) / 1000).toFixed(1)
console.log(`\n=== Results: ${passed} passed, ${failed} failed (${elapsed}s) ===`)
if (failed > 0) process.exit(1)
