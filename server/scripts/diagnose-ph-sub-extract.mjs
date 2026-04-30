// Probe the exact DOM container that holds just the user's subscription
// items on /users/{u}/pornstar_subscriptions and /channel_subscriptions.
// Goal: find a stable selector so we extract the 11 real subs without
// the navigation/HOF noise.

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
  `https://www.pornhub.com/users/${PH_USERNAME}/pornstar_subscriptions`,
  `https://www.pornhub.com/users/${PH_USERNAME}/channel_subscriptions`,
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
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await new Promise(r => setTimeout(r, 1500))

      // Probe several plausible container selectors
      const probe = await page.evaluate(() => {
        const results = {}
        const selectors = [
          'ul.userList li',
          'ul.subscriberList li',
          'ul.pornstarsList li',
          'ul.channelsList li',
          '.userListItem',
          '.subscriberContainer',
          'ul.row-5-thumbs li',
          'section.subscriberContainer li',
          '.pornstarsListBlock li',
          '.channelsListBlock li',
          '#subscriberContainer li',
          // Generic: any UL whose items contain a /model|/pornstar|/channels link
          'ul li',
        ]
        for (const sel of selectors) {
          // eslint-disable-next-line no-undef
          const els = document.querySelectorAll(sel)
          if (!els.length) continue
          const matched = []
          for (const el of els) {
            const a = el.querySelector('a[href^="/pornstar/"], a[href^="/model/"], a[href^="/channels/"]')
            if (!a) continue
            matched.push({
              href: a.getAttribute('href'),
              text: (a.textContent || '').trim().slice(0, 40),
              parentClass: el.className?.slice(0, 80),
            })
          }
          if (matched.length > 0 && matched.length < 100) {
            results[sel] = { totalEls: els.length, matched: matched.slice(0, 20) }
          }
        }
        return results
      })

      console.log(`Selector probes returning <100 matches:`)
      for (const [sel, data] of Object.entries(probe)) {
        console.log(`  ${sel} → ${data.totalEls} elements, ${data.matched.length} with profile-link match`)
        for (const m of data.matched.slice(0, 5)) {
          console.log(`    ${m.text.padEnd(30)} → ${m.href}  (parent.class="${m.parentClass}")`)
        }
      }

      // Walk UP from a known user-sub anchor to find the enclosing list container
      const ancestors = await page.evaluate(() => {
        // Probe MULTIPLE different known handles to compare their containers
        const knownHandles = ['comatozze', 'gattouz0', 'creamy-spot', 'yunadoll', 'jess-cromwell',
          'ambie-bambii', 'pure-taboo', 'futanari', 'joi-babes', 'eva-elfie']
        const found = {}
        for (const h of knownHandles) {
          // eslint-disable-next-line no-undef
          const a = document.querySelector(`a[href$="/${h}"]`)
          if (a) found[h] = walkUp(a)
        }
        return found
        function walkUp(el) {
          const path = []
          let cur = el
          for (let i = 0; i < 8 && cur; i++) {
            path.push({
              tag: cur.tagName,
              id: cur.id || '',
              class: (cur.className || '').slice(0, 80),
              kids: cur.children?.length || 0,
            })
            cur = cur.parentElement
          }
          return { found: el.getAttribute('href'), path }
        }
        return null
      })
      console.log(`\n  Walk-up from each known handle:`)
      for (const [h, info] of Object.entries(ancestors || {})) {
        console.log(`  ${h} → ${info.found}`)
        info.path.forEach((p, i) => {
          console.log(`    [${i}] <${p.tag}${p.id ? ` id="${p.id}"` : ''}${p.class ? ` class="${p.class}"` : ''}>`)
        })
      }

      // Targeted: find an H1 and walk its sibling/closest container that holds the list items
      const aroundH1 = await page.evaluate(() => {
        // eslint-disable-next-line no-undef
        const h1 = document.querySelector('h1')
        if (!h1) return null
        const container = h1.closest('section, div, main, #mainContainer')
        if (!container) return null
        // Find next sibling section or list under the heading's parent
        // eslint-disable-next-line no-undef
        const lists = container.parentElement?.querySelectorAll('ul') || []
        const out = []
        for (const ul of lists) {
          const items = ul.querySelectorAll('li')
          let count = 0
          let sample = []
          for (const li of items) {
            const a = li.querySelector('a[href^="/pornstar/"], a[href^="/model/"], a[href^="/channels/"]')
            if (a) {
              count++
              if (sample.length < 3) sample.push({ text: a.textContent?.trim().slice(0, 30), href: a.getAttribute('href') })
            }
          }
          if (count > 0) out.push({ ulClass: ul.className?.slice(0, 80), ulId: ul.id, count, sample })
        }
        return out
      })

      console.log(`\n  ULs near H1 with profile links:`)
      for (const ul of aroundH1 || []) {
        console.log(`    <ul id="${ul.ulId}" class="${ul.ulClass}"> → ${ul.count} matches`)
        for (const s of ul.sample) console.log(`      ${s.text.padEnd(30)} → ${s.href}`)
      }

      // Direct extraction from #moreData (the container we found via walk-up)
      const fromMoreData = await page.evaluate(() => {
        // eslint-disable-next-line no-undef
        const ul = document.querySelector('#moreData')
        if (!ul) return null
        const items = ul.querySelectorAll('a[href^="/pornstar/"], a[href^="/model/"], a[href^="/channels/"], a[href^="/users/"]')
        return Array.from(items).map(a => ({ href: a.getAttribute('href'), text: (a.textContent || '').trim().slice(0, 40) }))
      })
      console.log(`\n  Items inside #moreData: ${fromMoreData?.length ?? '(no #moreData)'}`)
      if (fromMoreData) {
        for (const it of fromMoreData) console.log(`    ${it.text.padEnd(30)} → ${it.href}`)
      }
    }
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

main().catch(err => { console.error(err); process.exit(1) })
