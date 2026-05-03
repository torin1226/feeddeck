// Validate Instagram Puppeteer scraper selectors against the live page.
// Loads cookies/instagram.txt, navigates to explore/reels and optionally a creator,
// and reports how many reel URLs are found.
//
// Note: thumbnails are intentionally skipped — Instagram lazy-loads img src only
// after the browser fetches the image, which our image-blocking scraper prevents.
// Reel URLs are the primary value; thumbnails will show as placeholders.
//
// Usage: node server/scripts/probe-instagram.mjs [handle]
//   handle — optional Instagram handle to test creator page (e.g. cristiano)
//
// Run from feeddeck/ directory.

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getPuppeteer } from '../sources/scraper.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COOKIE_PATH = join(__dirname, '..', '..', 'cookies', 'instagram.txt')
const HANDLE = process.argv[2] || null
const MIN_RESULTS = 3

function parseNetscapeCookies(filePath) {
  let text
  try { text = readFileSync(filePath, 'utf-8') } catch { return [] }
  const cookies = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const parts = t.split('\t')
    if (parts.length < 7) continue
    const [domain, , path, secure, expires, name, value] = parts
    if (!name || !value) continue
    cookies.push({ name, value, domain, path, secure: secure === 'TRUE', expires: parseInt(expires, 10) || -1 })
  }
  return cookies
}

const TARGETS = [
  { label: 'Explore/Reels (public)', url: 'https://www.instagram.com/explore/reels/' },
]
if (HANDLE) {
  TARGETS.push({ label: `@${HANDLE} reels`, url: `https://www.instagram.com/${HANDLE.replace(/^@/, '')}/reels/` })
}

const pptr = await getPuppeteer()
const browser = await pptr.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
})

const cookies = parseNetscapeCookies(COOKIE_PATH)
console.log(`Loaded ${cookies.length} cookies from ${COOKIE_PATH}`)

let failures = 0

for (const target of TARGETS) {
  console.log(`\n--- ${target.label} ---`)
  const page = await browser.newPage()
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
  )
  await page.setViewport({ width: 1920, height: 1080 })
  if (cookies.length > 0) await page.setCookie(...cookies)

  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const pageTitle = await page.title().catch(() => '(unknown)')
    console.log(`Page: "${pageTitle}"`)

    const selectorFound = await page.waitForSelector('a[href*="/reel/"]', { timeout: 10_000 })
      .then(() => true).catch(() => false)

    if (!selectorFound) {
      console.log('FAIL: no reel links found — likely login wall or DOM changed')
      failures++
      await page.close()
      continue
    }

    // Scroll to expose more cards
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight)) // eslint-disable-line no-undef
      await new Promise(r => setTimeout(r, 600))
    }

    const results = await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      const cards = document.querySelectorAll('a[href*="/reel/"]')
      const seen = new Set()
      const out = []
      for (const card of cards) {
        const href = card.getAttribute('href') || ''
        if (!href || seen.has(href)) continue
        seen.add(href)
        const shortcode = href.split('/').filter(Boolean).pop() || href
        out.push({ href, shortcode })
        if (out.length >= 20) break
      }
      return out
    })

    const ok = results.length >= MIN_RESULTS
    if (!ok) failures++
    console.log(`${ok ? 'OK' : 'FAIL'}  ${results.length} reels (need >= ${MIN_RESULTS})`)
    for (const r of results.slice(0, 5)) {
      console.log(`  ${r.shortcode}  →  https://www.instagram.com${r.href}`)
    }
  } catch (err) {
    failures++
    console.log(`THROW: ${err.message}`)
  }

  await page.close()
}

await browser.close()

if (failures > 0) {
  console.error(`\n${failures}/${TARGETS.length} targets failed`)
  process.exit(1)
}
console.log('\nAll targets returned enough reels.')
