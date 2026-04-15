#!/usr/bin/env node
// Diagnostic script: inspect SpankBang's live DOM to find working selectors.
// Run: node server/scripts/diagnose-spankbang.mjs
// Output: logs which selectors match and dumps the actual DOM structure of video cards.

import puppeteer from 'puppeteer'

const SPANKBANG_TRENDING = 'https://spankbang.com/trending_videos/'
const SPANKBANG_SEARCH = 'https://spankbang.com/s/test/'

// Current selectors from scraper.js to test
const CURRENT_SELECTORS = {
  videoCard: '.js-video-item, [data-testid="video-item"]',
  title: '.line-clamp-2 a[title], [data-testid="video-info-with-badge"] a[href*="/video/"][title]',
  thumbnail: 'img[x-ref="thumbnail"], picture img',
  duration: '[data-testid="video-item-length"]',
  views: '[data-testid="views"]',
  uploader: 'a[data-testid="title"]',
  link: 'a[href*="/video/"], a[href*="/video"]',
}

// Broad discovery selectors to find any video-like elements
const DISCOVERY_SELECTORS = [
  // Common video card patterns
  '[class*="video"]',
  '[class*="thumb"]',
  '[data-id]',
  'a[href*="/video/"]',
  'a[href*="/play/"]',
  '.video-item',
  '.video-list__item',
  '.js-video-item',
  '.video_item',
  // Common thumbnail patterns
  'img[data-src]',
  'img[loading="lazy"]',
  // Alpine.js patterns (SpankBang uses Alpine)
  '[x-data]',
  '[x-ref]',
  // Duration patterns
  '[class*="duration"]',
  '[class*="length"]',
  'time',
]

async function run() {
  console.log('Launching Puppeteer...')
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  })

  const page = await browser.newPage()
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
  )
  await page.setViewport({ width: 1920, height: 1080 })

  // Don't block anything -- we want to see the full page
  console.log(`\nNavigating to: ${SPANKBANG_TRENDING}`)
  try {
    await page.goto(SPANKBANG_TRENDING, { waitUntil: 'networkidle2', timeout: 30000 })
  } catch (e) {
    console.log(`Navigation warning: ${e.message}`)
  }

  const pageTitle = await page.title()
  const pageUrl = page.url()
  console.log(`Page title: "${pageTitle}"`)
  console.log(`Final URL: ${pageUrl}`)

  // Check if we got redirected to an age gate or error
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '(empty)')
  console.log(`\nFirst 500 chars of body text:\n${bodyText}\n`)

  // Test current selectors
  console.log('=== TESTING CURRENT SELECTORS ===')
  for (const [name, selector] of Object.entries(CURRENT_SELECTORS)) {
    const count = await page.evaluate((sel) => document.querySelectorAll(sel).length, selector)
    const status = count > 0 ? 'MATCH' : 'MISS'
    console.log(`  ${status}: ${name} = "${selector}" -> ${count} elements`)
  }

  // Test discovery selectors
  console.log('\n=== DISCOVERY SELECTORS ===')
  for (const selector of DISCOVERY_SELECTORS) {
    const count = await page.evaluate((sel) => {
      try { return document.querySelectorAll(sel).length } catch { return -1 }
    }, selector)
    if (count > 0) {
      console.log(`  FOUND: "${selector}" -> ${count} elements`)
    }
  }

  // Dump the structure of the first few elements that look like video cards
  console.log('\n=== DOM STRUCTURE ANALYSIS ===')

  // Strategy: find links to /video/ pages and work upward to find the card container
  const cardAnalysis = await page.evaluate(() => {
    const videoLinks = document.querySelectorAll('a[href*="/video/"]')
    const results = []
    const seen = new Set()

    for (const link of videoLinks) {
      if (results.length >= 5) break
      // Walk up to find the card container (usually 2-4 levels up)
      let card = link.parentElement
      for (let i = 0; i < 5 && card && card !== document.body; i++) {
        // A card container typically has multiple children (thumb, info, etc.)
        if (card.children.length >= 2) break
        card = card.parentElement
      }
      if (!card || seen.has(card)) continue
      seen.add(card)

      // Dump card info
      const info = {
        tagName: card.tagName,
        className: card.className?.slice(0, 200) || '',
        id: card.id || '',
        dataAttrs: {},
        childrenSummary: [],
      }

      // Collect data attributes
      for (const attr of card.attributes) {
        if (attr.name.startsWith('data-') || attr.name.startsWith('x-')) {
          info.dataAttrs[attr.name] = attr.value?.slice(0, 100)
        }
      }

      // Summarize immediate children
      for (const child of card.children) {
        const childInfo = {
          tag: child.tagName,
          class: child.className?.slice(0, 150) || '',
          text: child.textContent?.trim()?.slice(0, 80) || '',
        }
        // Check for links
        const a = child.querySelector('a[href]')
        if (a) childInfo.href = a.getAttribute('href')?.slice(0, 100)
        // Check for images
        const img = child.querySelector('img')
        if (img) {
          childInfo.imgSrc = img.getAttribute('src')?.slice(0, 100)
          childInfo.imgDataSrc = img.getAttribute('data-src')?.slice(0, 100)
          childInfo.imgXRef = img.getAttribute('x-ref') || ''
        }
        info.childrenSummary.push(childInfo)
      }

      // Also get the link's own info
      info.linkHref = link.getAttribute('href')
      info.linkTitle = link.getAttribute('title')
      info.linkText = link.textContent?.trim()?.slice(0, 80)

      results.push(info)
    }
    return results
  })

  if (cardAnalysis.length === 0) {
    console.log('No video links found! The page may be an age gate or error.')
    // Dump full HTML structure for debugging
    const html = await page.evaluate(() => document.documentElement.outerHTML.slice(0, 3000))
    console.log('\nFirst 3000 chars of HTML:\n', html)
  } else {
    for (let i = 0; i < cardAnalysis.length; i++) {
      console.log(`\n--- Card ${i + 1} ---`)
      console.log(JSON.stringify(cardAnalysis[i], null, 2))
    }
  }

  // Find duration elements specifically
  console.log('\n=== DURATION ELEMENTS ===')
  const durationInfo = await page.evaluate(() => {
    // Look for any element whose text looks like a duration (MM:SS or H:MM:SS)
    const all = document.querySelectorAll('*')
    const matches = []
    for (const el of all) {
      if (matches.length >= 10) break
      const text = el.textContent?.trim()
      if (text && /^\d{1,2}:\d{2}(:\d{2})?$/.test(text) && el.children.length === 0) {
        matches.push({
          tag: el.tagName,
          class: el.className?.slice(0, 150),
          text,
          parentClass: el.parentElement?.className?.slice(0, 150),
          dataAttrs: Object.fromEntries(
            [...el.attributes].filter(a => a.name.startsWith('data-') || a.name.startsWith('x-')).map(a => [a.name, a.value])
          ),
        })
      }
    }
    return matches
  })

  if (durationInfo.length > 0) {
    for (const d of durationInfo) {
      console.log(`  Duration "${d.text}": <${d.tag} class="${d.class}"> (parent: "${d.parentClass}")`, d.dataAttrs)
    }
  } else {
    console.log('  No duration elements found with MM:SS pattern')
  }

  // Find view count elements
  console.log('\n=== VIEW COUNT ELEMENTS ===')
  const viewsInfo = await page.evaluate(() => {
    const all = document.querySelectorAll('*')
    const matches = []
    for (const el of all) {
      if (matches.length >= 10) break
      const text = el.textContent?.trim()
      if (text && /^\d[\d,.]*[KkMm]?\s*(views?|plays?)?$/i.test(text) && el.children.length === 0) {
        matches.push({
          tag: el.tagName,
          class: el.className?.slice(0, 150),
          text: text.slice(0, 50),
          parentClass: el.parentElement?.className?.slice(0, 150),
        })
      }
    }
    return matches
  })

  if (viewsInfo.length > 0) {
    for (const v of viewsInfo) {
      console.log(`  Views "${v.text}": <${v.tag} class="${v.class}"> (parent: "${v.parentClass}")`)
    }
  } else {
    console.log('  No view count elements found')
  }

  await browser.close()
  console.log('\nDone.')
}

run().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
