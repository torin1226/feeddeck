// Find the user's actual subscriptions list on PH. The /subscriptions
// page is a "videos from similar creators" recommender, not the real list.
// Drill into the profile page's "Subscriptions" tab and any channel-subs
// equivalent to discover where the real list lives.

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

const URLS = [
  `https://www.pornhub.com/users/${PH_USERNAME}/subscriptions`,
  `https://www.pornhub.com/users/${PH_USERNAME}/subscriptions/pornstars`,
  `https://www.pornhub.com/users/${PH_USERNAME}/subscriptions/channels`,
  `https://www.pornhub.com/users/${PH_USERNAME}/subscriptions/users`,
  `https://www.pornhub.com/users/${PH_USERNAME}/subscriptions/models`,
]

async function main() {
  const { cookies } = parseCookieFile('pornhub.com')
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

    for (const url of URLS) {
      console.log(`\n=== ${url} ===`)
      try {
        const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        const finalUrl = page.url()
        console.log(`  HTTP ${r?.status()} → ${finalUrl}`)
        await new Promise(res => setTimeout(res, 1500))

        const data = await page.evaluate(() => {
          // eslint-disable-next-line no-undef
          const allLinks = Array.from(document.querySelectorAll('a'))

          // Pornstar / model / channel profile links typically use /pornstar/, /model/, /channels/, /users/
          const profileLinks = allLinks
            .map(a => ({
              href: a.getAttribute('href') || '',
              text: a.textContent?.trim() || '',
            }))
            .filter(l =>
              /\/(pornstar|model|channels|users)\//.test(l.href) &&
              l.text.length > 0 && l.text.length < 60 &&
              !/log\s*in|sign\s*up|premium|claim|free week|achievement|playlist/i.test(l.text)
            )

          // Dedupe by href
          const seen = new Set()
          const unique = []
          for (const l of profileLinks) {
            if (!seen.has(l.href)) { seen.add(l.href); unique.push(l) }
          }

          // Section context: try to find section titles to group results
          // eslint-disable-next-line no-undef
          const sections = Array.from(document.querySelectorAll('h2, h3, .sectionTitle, .sectionTitleParent'))
            .map(e => e.textContent?.trim())
            .filter(Boolean)
            .slice(0, 20)

          return { sections, profileLinks: unique.slice(0, 50) }
        })

        console.log(`  Sections: ${JSON.stringify(data.sections)}`)
        console.log(`  Profile-link candidates (${data.profileLinks.length}):`)
        for (const l of data.profileLinks.slice(0, 30)) {
          console.log(`    ${l.text.padEnd(35)} → ${l.href}`)
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

main().catch(err => { console.error('Diag failed:', err); process.exit(1) })
