// Diagnostic for the "ph_subs only returns 3" bug.
// Run: node server/scripts/diagnose-ph-subs-scroll.mjs
//
// Loads PH cookies, navigates to /subscriptions, and snapshots the
// rendered card count before and after a few scroll passes. Tells us
// whether the page lazy-loads cards on scroll (in which case the
// scraper needs a scroll loop) or paginates via ?page=N.

import { parseCookieFile } from '../cookies.js'

let _puppeteer = null
async function getPuppeteer() {
  if (_puppeteer) return _puppeteer
  try {
    const extra = await import('puppeteer-extra')
    const stealth = await import('puppeteer-extra-plugin-stealth')
    const pptr = extra.default || extra
    pptr.use((stealth.default || stealth)())
    _puppeteer = pptr
  } catch {
    const plain = await import('puppeteer')
    _puppeteer = plain.default || plain
  }
  return _puppeteer
}

const SUBS_URL = 'https://www.pornhub.com/subscriptions'
const SCROLL_PASSES = 6

async function main() {
  const { cookies, cookiePath } = parseCookieFile('pornhub.com')
  console.log(`Cookie file: ${cookiePath || '(none)'} (${Object.keys(cookies).length} cookies)`)
  if (Object.keys(cookies).length === 0) {
    console.log('No cookies — aborting.')
    process.exit(1)
  }

  const pptr = await getPuppeteer()
  const browser = await pptr.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  })
  const page = await browser.newPage()
  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
    )
    await page.setViewport({ width: 1920, height: 1080 })

    const cookieList = Object.entries(cookies).map(([name, value]) => ({
      name, value, domain: '.pornhub.com', path: '/', httpOnly: false, secure: true,
    }))
    await page.setCookie(...cookieList)

    const resp = await page.goto(SUBS_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    console.log(`\nNavigated to ${SUBS_URL}`)
    console.log(`  HTTP status: ${resp?.status()}`)
    console.log(`  Final URL: ${page.url()}`)
    if (/\/login/i.test(page.url()) || /signin/i.test(page.url())) {
      console.log('  ⚠️ Redirected to login — cookies expired.')
      return
    }

    await page.waitForSelector('.pcVideoListItem, li.videoBox', { timeout: 8000 }).catch(() => {})

    const countCards = () => page.evaluate(() =>
      // eslint-disable-next-line no-undef
      document.querySelectorAll('.pcVideoListItem, li.videoBox').length
    )

    const initial = await countCards()
    console.log(`\nInitial card count: ${initial}`)

    // Probe pagination affordances
    const pagination = await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      const pageLinks = Array.from(document.querySelectorAll('a[href*="?page="], a[href*="&page="]'))
        .map(a => a.getAttribute('href'))
        .slice(0, 10)
      // eslint-disable-next-line no-undef
      const loadMore = Array.from(document.querySelectorAll('button, a'))
        .filter(el => /load more|show more/i.test(el.textContent || ''))
        .map(el => el.outerHTML.slice(0, 120))
      // eslint-disable-next-line no-undef
      const docHeight = document.body.scrollHeight
      // eslint-disable-next-line no-undef
      const winHeight = window.innerHeight
      return { pageLinks, loadMore, docHeight, winHeight }
    })
    console.log(`  Page links found: ${pagination.pageLinks.length}`)
    if (pagination.pageLinks.length) console.log(`    e.g. ${pagination.pageLinks.slice(0, 3).join(', ')}`)
    console.log(`  Load-more buttons: ${pagination.loadMore.length}`)
    console.log(`  Document height: ${pagination.docHeight} (window: ${pagination.winHeight})`)

    // Scroll passes
    let prev = initial
    for (let i = 1; i <= SCROLL_PASSES; i++) {
      await page.evaluate(() => {
        // eslint-disable-next-line no-undef
        window.scrollTo(0, document.body.scrollHeight)
      })
      await new Promise(r => setTimeout(r, 1500))
      const n = await countCards()
      const docHeight = await page.evaluate(() =>
        // eslint-disable-next-line no-undef
        document.body.scrollHeight
      )
      console.log(`  Scroll pass ${i}: ${n} cards (docHeight=${docHeight}, delta=${n - prev})`)
      if (n === prev) {
        console.log('    → No new cards loaded; stopping.')
        break
      }
      prev = n
    }

    // Capture initial page video URLs for comparison
    const collectUrls = () => page.evaluate(() => {
      // eslint-disable-next-line no-undef
      const cards = document.querySelectorAll('.pcVideoListItem, li.videoBox')
      const out = []
      for (const c of cards) {
        const a = c.querySelector('.title a, a.linkVideoThumb')
        const href = a?.getAttribute('href') || ''
        out.push(href)
      }
      return out
    })

    // Re-navigate to page 1 to capture clean URL list
    await page.goto(SUBS_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForSelector('.pcVideoListItem, li.videoBox', { timeout: 8000 }).catch(() => {})
    const page1Urls = await collectUrls()
    console.log(`\nPage 1 URLs (${page1Urls.length}):`)
    page1Urls.forEach((u, i) => console.log(`  ${i + 1}. ${u.slice(0, 80)}`))

    // Probe pagination widgets — look at common PH paginator class names
    const paginationDom = await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      const widgets = ['.pagination3', '.paginationGated', '.page_next', '.page_current',
        'ul.pagination li', '[data-page]', 'a.orangeButton']
      const out = {}
      for (const sel of widgets) {
        // eslint-disable-next-line no-undef
        const els = document.querySelectorAll(sel)
        if (els.length) out[sel] = Array.from(els).slice(0, 5).map(el => el.outerHTML.slice(0, 200))
      }
      return out
    })
    console.log(`\nPagination DOM probe:`)
    if (Object.keys(paginationDom).length === 0) console.log('  (no known paginator selectors matched)')
    else for (const [sel, els] of Object.entries(paginationDom)) {
      console.log(`  ${sel}: ${els.length} match(es)`)
      els.forEach(el => console.log(`    ${el}`))
    }

    // Try pages 2 through 5
    const allUrls = new Set(page1Urls)
    for (let p = 2; p <= 5; p++) {
      const url = `${SUBS_URL}?page=${p}`
      const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForSelector('.pcVideoListItem, li.videoBox', { timeout: 8000 }).catch(() => {})
      const urls = await collectUrls()
      const newUnique = urls.filter(u => !allUrls.has(u))
      console.log(`\n?page=${p}: HTTP ${r?.status()}, ${urls.length} cards, ${newUnique.length} new unique`)
      urls.slice(0, 5).forEach((u, i) => console.log(`  ${i + 1}. ${u.slice(0, 80)}`))
      if (newUnique.length === 0) {
        console.log('  → No new URLs; pagination exhausted or page repeats.')
        break
      }
      newUnique.forEach(u => allUrls.add(u))
    }
    console.log(`\nTotal unique videos found across all probed pages: ${allUrls.size}`)
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

main().catch(err => {
  console.error('Diag failed:', err)
  process.exit(1)
})
