// Find the canonical "View All subscriptions" URLs by inspecting the
// section headers on /users/{u}/subscriptions and following the
// "View All" anchors. Then enumerate each to capture the FULL list of
// creators the user is subscribed to.

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

    const profileUrl = `https://www.pornhub.com/users/${PH_USERNAME}/subscriptions`
    console.log(`\n=== Probing ${profileUrl} for "View All" links ===`)
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await new Promise(r => setTimeout(r, 1500))

    // Find every section header and its associated "View All" link
    const sections = await page.evaluate(() => {
      // PH wraps sections in containers with section titles. Walk the DOM
      // around each "Subscription" / "Subscribed" heading and find sibling
      // / nearby anchors.
      // eslint-disable-next-line no-undef
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, .sectionTitle, .sectionTitleParent, .title-container'))
      const out = []
      for (const h of headings) {
        const text = h.textContent?.trim() || ''
        if (!/(subscription|subscribed)/i.test(text)) continue
        // Find a "View All" anchor in this heading or its parent
        const root = h.closest('section, div, .sectionWrapper') || h.parentElement || h
        // eslint-disable-next-line no-undef
        const viewAll = Array.from(root.querySelectorAll('a')).find(a => /view\s*all/i.test(a.textContent || ''))
        out.push({
          heading: text.slice(0, 100),
          viewAllHref: viewAll?.getAttribute('href') || null,
          rootTag: root?.tagName,
          rootClass: root?.className?.slice(0, 100),
        })
      }
      return out
    })

    console.log(`\nSections containing "subscription"/"subscribed":`)
    for (const s of sections) {
      console.log(`  • ${s.heading}`)
      console.log(`      viewAll: ${s.viewAllHref || '(none found)'}`)
      console.log(`      root: <${s.rootTag} class="${s.rootClass}">`)
    }

    // Also dump every <a href containing "subscriptions"
    const subsLinks = await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      return Array.from(document.querySelectorAll('a'))
        .map(a => ({ href: a.getAttribute('href') || '', text: (a.textContent || '').trim().slice(0, 60) }))
        .filter(l => /subscription/i.test(l.href) && !/^(http)?s?:\/\/(de|fr|it|pt|es|rt|pl|jp|nl|fil|cz|cn)\./.test(l.href))
        .slice(0, 30)
    })
    console.log(`\nAnchors with "subscription" in href:`)
    for (const l of subsLinks) {
      console.log(`  ${l.text.padEnd(35)} → ${l.href}`)
    }

    // For each unique View All target, navigate and enumerate the full list of profile links
    const targets = [...new Set(sections.map(s => s.viewAllHref).filter(Boolean))]
    for (const target of targets) {
      const fullUrl = target.startsWith('http') ? target : `https://www.pornhub.com${target}`
      console.log(`\n=== Following View All: ${fullUrl} ===`)
      try {
        const r = await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        const finalUrl = page.url()
        console.log(`  HTTP ${r?.status()} → ${finalUrl}`)
        await new Promise(res => setTimeout(res, 1500))
        const content = await page.evaluate(() => {
          // eslint-disable-next-line no-undef
          const h1 = document.querySelector('h1')?.textContent?.trim()
          // eslint-disable-next-line no-undef
          const links = Array.from(document.querySelectorAll('a'))
            .map(a => ({
              href: a.getAttribute('href') || '',
              text: (a.textContent || '').trim(),
            }))
            .filter(l =>
              /^\/(pornstar|model|channels|users)\//.test(l.href) &&
              l.text.length > 0 && l.text.length < 60 &&
              !/log\s*in|sign\s*up|premium|claim|free week|achievement|playlist|view all/i.test(l.text)
            )
          // dedupe by href
          const seen = new Set()
          const unique = []
          for (const l of links) {
            if (!seen.has(l.href)) { seen.add(l.href); unique.push(l) }
          }
          return { h1, total: unique.length, items: unique.slice(0, 60) }
        })
        console.log(`  H1: ${content.h1}`)
        console.log(`  Total profile links on page: ${content.total}`)
        for (const it of content.items) {
          console.log(`    ${it.text.padEnd(35)} → ${it.href}`)
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

main().catch(err => { console.error(err); process.exit(1) })
