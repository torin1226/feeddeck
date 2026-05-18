// ============================================================
// Structural test: boundary.fetch acceptHtml registry
//
// Locks the 2026-05-18 acceptHtml audit. Every boundary.fetch call site
// in server/ is registered with its expected body kind ('json' or 'html').
// The four assertions below guarantee:
//   1. Every call site declares a `name:` field.
//   2. Every name appears in REGISTRY.
//   3. 'json' callers MUST NOT set acceptHtml.
//   4. 'html' callers MUST set acceptHtml: true.
//
// Why this exists:
//   classifyHttp() in server/boundary/outcomes.js defaults to treating any
//   2xx response with HTML-shaped body as `wrong_shape`. That broke every
//   HTML-scraping caller silently in 2026-05-17 (soundgasm × 4 calls,
//   twitter-trends explore + bundle, scraper OG enrichment, cookie-health
//   IG probe). The `acceptHtml: true` opt-in (commit e49980d) fixed the
//   known offenders but the rule is easy to miss when adding new callers.
//
// Failure mode this catches:
//   - Adding a new boundary.fetch call without registering its kind here.
//   - Forgetting acceptHtml: true on an HTML/JS/binary caller (false
//     wrong_shape outcomes silently torch the snitch stats).
//   - Setting acceptHtml: true on a JSON caller (would mask a real
//     wrong_shape regression — e.g. an API returning an HTML error page).
//
// When you add a new boundary.fetch caller: add its `name` to REGISTRY
// with 'json' or 'html'. The test failure message tells you what to do.
// ============================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_DIR = join(__dirname, '..')

// One entry per boundary.fetch call site. Keep alphabetised within each
// section so additions don't churn diffs.
const REGISTRY = Object.freeze({
  // ---- JSON callers (parse body via JSON.parse) ----
  'audio-reddit-api': 'json',           // server/sources/audio-fetcher.js
  'cobalt-api': 'json',                 // server/sources/cobalt.js
  'creator-reddit-api': 'json',         // server/sources/creator.js
  'nsfw-eporner-api': 'json',           // server/sources/eporner.js
  'nsfw-fikfap-api': 'json',            // server/sources/scraper.js
  'nsfw-redgifs-auth': 'json',          // server/sources/scraper.js
  'nsfw-redgifs-search': 'json',        // server/sources/scraper.js
  'twitter-trends-graphql': 'json',     // server/sources/twitter-trends.js
  'twitter-trends-v11': 'json',         // server/sources/twitter-trends.js

  // ---- HTML/JS/binary callers (scrape, regex, or piped) ----
  'audio-soundgasm-post': 'html',       // server/sources/soundgasm.js
  'audio-soundgasm-resolve': 'html',    // server/sources/soundgasm.js (×2 call sites, same name)
  'audio-soundgasm-user': 'html',       // server/sources/soundgasm.js
  'cookie-health-ig-probe': 'html',     // server/cookie-health.js
  'nsfw-og-enrich': 'html',             // server/sources/scraper.js
  'twitter-trends-bundle-js': 'html',   // server/sources/twitter-trends.js (JS bundle)
  'twitter-trends-explore-page': 'html', // server/sources/twitter-trends.js
})

const SKIP_DIRS = new Set(['__tests__', 'node_modules', 'boundary'])

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, files)
    else if (entry.endsWith('.js') && !entry.endsWith('.test.js')) files.push(full)
  }
  return files
}

// Extract every boundary.fetch(...) call block from a file's source.
// Paren-aware AND string-aware: skips over string literals (single,
// double, template) and line/block comments so a `(` inside a
// User-Agent header doesn't throw off the paren depth count.
function findBoundaryFetchCalls(content, file) {
  const calls = []
  const marker = 'boundary.fetch('
  let cursor = 0
  while (true) {
    const start = content.indexOf(marker, cursor)
    if (start === -1) break
    let depth = 0
    let i = start + marker.length - 1 // start counting at the '('
    let end = -1
    let inString = null // null | "'" | '"' | '`'
    let inLineComment = false
    let inBlockComment = false
    while (i < content.length) {
      const c = content[i]
      const next = i + 1 < content.length ? content[i + 1] : ''
      if (inLineComment) {
        if (c === '\n') inLineComment = false
      } else if (inBlockComment) {
        if (c === '*' && next === '/') { inBlockComment = false; i++ }
      } else if (inString) {
        if (c === '\\') { i += 2; continue } // skip escaped char
        if (c === inString) inString = null
      } else {
        if (c === '/' && next === '/') { inLineComment = true; i++ }
        else if (c === '/' && next === '*') { inBlockComment = true; i++ }
        else if (c === "'" || c === '"' || c === '`') inString = c
        else if (c === '(') depth++
        else if (c === ')') {
          depth--
          if (depth === 0) { end = i; break }
        }
      }
      i++
    }
    if (end === -1) {
      // Unbalanced parens — caller has a syntax error, let the build catch it.
      cursor = start + marker.length
      continue
    }
    const block = content.slice(start, end + 1)
    const nameMatch = block.match(/name:\s*['"]([^'"]+)['"]/)
    const acceptHtml = /acceptHtml:\s*true/.test(block)
    calls.push({ name: nameMatch ? nameMatch[1] : null, acceptHtml, file })
    cursor = end + 1
  }
  return calls
}

function allCalls() {
  return walk(SERVER_DIR).flatMap(f => findBoundaryFetchCalls(readFileSync(f, 'utf8'), f))
}

describe('boundary.fetch acceptHtml registry', () => {
  it('every call site declares a name field', () => {
    const nameless = allCalls().filter(c => !c.name)
    if (nameless.length) {
      const detail = nameless.map(c => `  - ${c.file}`).join('\n')
      throw new Error(
        `boundary.fetch call(s) missing the required name: field:\n${detail}\n` +
        'Add name: \'kebab-case-tag\' so /debug/boundary-stats can tally outcomes.'
      )
    }
    expect(nameless).toEqual([])
  })

  it('every call site name is registered with a body kind', () => {
    const names = new Set(allCalls().map(c => c.name).filter(Boolean))
    const missing = [...names].filter(n => !(n in REGISTRY))
    if (missing.length) {
      throw new Error(
        `boundary.fetch name(s) not in REGISTRY: ${missing.join(', ')}\n` +
        'Open server/__tests__/boundary-fetch-acceptHtml-registry.test.js and add each ' +
        "name with its body kind ('json' or 'html'). HTML/JS/binary callers MUST also pass " +
        'acceptHtml: true at the call site.'
      )
    }
    expect(missing).toEqual([])
  })

  it('json callers do not set acceptHtml', () => {
    const wrong = allCalls().filter(c => c.name && REGISTRY[c.name] === 'json' && c.acceptHtml)
    if (wrong.length) {
      const detail = wrong.map(c => `  - ${c.name} (${c.file})`).join('\n')
      throw new Error(
        `JSON callers must NOT set acceptHtml: true (it would mask wrong_shape regressions):\n${detail}\n` +
        'Either remove the acceptHtml flag, or change REGISTRY entry to \'html\' if the body is actually HTML.'
      )
    }
    expect(wrong).toEqual([])
  })

  it('html callers set acceptHtml: true', () => {
    const wrong = allCalls().filter(c => c.name && REGISTRY[c.name] === 'html' && !c.acceptHtml)
    if (wrong.length) {
      const detail = wrong.map(c => `  - ${c.name} (${c.file})`).join('\n')
      throw new Error(
        `HTML callers must set acceptHtml: true (otherwise classifyHttp returns wrong_shape on every call):\n${detail}\n` +
        'Add acceptHtml: true to the boundary.fetch options object at the call site.'
      )
    }
    expect(wrong).toEqual([])
  })

  it('REGISTRY does not carry stale entries (every entry maps to at least one live call site)', () => {
    const liveNames = new Set(allCalls().map(c => c.name).filter(Boolean))
    const stale = Object.keys(REGISTRY).filter(n => !liveNames.has(n))
    if (stale.length) {
      throw new Error(
        `REGISTRY entries have no matching boundary.fetch call site: ${stale.join(', ')}\n` +
        'Remove them — likely the caller was deleted or renamed.'
      )
    }
    expect(stale).toEqual([])
  })
})
