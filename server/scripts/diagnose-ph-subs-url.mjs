// What is /subscriptions actually showing? The current scraper returns
// uploaders that aren't in the user's subscription list. Probe candidate
// URLs and capture page header / first few uploaders to identify the
// correct authenticated subscriptions feed.

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

const PH_USERNAME = process.env.PH_USERNAME || 'Tonjone92'

const CANDIDATES = [
  'https://www.pornhub.com/subscriptions',
  'https://www.pornhub.com/feed',
  `https://www.pornhub.com/users/${PH_USERNAME}/subscriptions`,
  `https://www.pornhub.com/users/${PH_USERNAME}/videos/subscriptions`,
  `https://www.pornhub.com/users/${PH_USERNAME}/videos/recent`,
  `https://www.pornhub.com/users/${PH_USERNAME}/feed`,
  `https://www.pornhub.com/users/${PH_USERNAME}/notifications/videos`,
]

async function main() {
  const { cookies } = parseCookieFile('pornhub.com')
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

    for (const url of CANDIDATES) {
      console.log(`\n=== ${url} ===`)
      try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        const finalUrl = page.url()
        console.log(`  HTTP ${resp?.status()} → ${finalUrl}`)
        if (/\/login|signin/i.test(finalUrl)) {
          console.log('  ⚠️ login redirect')
          continue
        }

        await page.waitForSelector('.pcVideoListItem, li.videoBox, h1, h2', { timeout: 8000 }).catch(() => {})

        const data = await page.evaluate(() => {
          const grab = (sel) =>
            // eslint-disable-next-line no-undef
            Array.from(document.querySelectorAll(sel)).map(e => e.textContent?.trim()).filter(Boolean).slice(0, 3)
          // eslint-disable-next-line no-undef
          const cards = document.querySelectorAll('.pcVideoListItem, li.videoBox')
          const uploaders = []
          for (const c of cards) {
            const u = c.querySelector('.usernameWrap a')?.textContent?.trim()
            if (u) uploaders.push(u)
          }
          // PH "subscription list" pages usually have channel/creator cards
          const subscribedCreators = []
          // eslint-disable-next-line no-undef
          const subscriberItems = document.querySelectorAll(
            '.subscriberContainer a, .subscribersList a, [class*="subscription"] a, [data-name]'
          )
          for (const a of subscriberItems) {
            const name = a.getAttribute('data-name') || a.textContent?.trim()
            if (name && name.length < 50) subscribedCreators.push(name)
          }
          return {
            h1: grab('h1'),
            h2: grab('h2'),
            sectionTitles: grab('.sectionTitle, .sectionTitleParent'),
            cardCount: cards.length,
            uploaders: uploaders.slice(0, 10),
            subscribedCreators: [...new Set(subscribedCreators)].slice(0, 15),
          }
        })

        console.log(`  H1: ${JSON.stringify(data.h1)}`)
        console.log(`  H2: ${JSON.stringify(data.h2)}`)
        console.log(`  Section titles: ${JSON.stringify(data.sectionTitles)}`)
        console.log(`  Cards: ${data.cardCount}, uploaders: ${JSON.stringify(data.uploaders)}`)
        if (data.subscribedCreators.length) {
          console.log(`  Possible subscribed creators on page: ${JSON.stringify(data.subscribedCreators)}`)
        }
      } catch (err) {
        console.log(`  ERROR: ${err.message}`)
      }
    }
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

main().catch(err => {
  console.error('Diag failed:', err)
  process.exit(1)
})
