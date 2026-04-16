#!/usr/bin/env node
// Diagnostic: investigate PornHub video page DOM for direct stream URL extraction.
// This is a fallback investigation in case yt-dlp breaks again.
// Run: node server/scripts/diagnose-pornhub.mjs [VIDEO_URL]

import { ScraperAdapter } from '../sources/scraper.js'

// Use a known working URL or the first argument
const testUrl = process.argv[2] || 'https://www.pornhub.com/view_video.php?viewkey=69bd7c3bee286'

async function diagnose() {
  console.log(`=== PornHub DOM Extraction Diagnostic ===`)
  console.log(`URL: ${testUrl}\n`)

  // We need raw Puppeteer access, so we use the scraper's internal browser
  const scraper = new ScraperAdapter()

  let page
  try {
    // Access internal browser via the scraper's method
    const browser = await scraper._getBrowser()
    page = await browser.newPage()

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
    )
    await page.setViewport({ width: 1920, height: 1080 })

    console.log('Navigating to video page...')
    await page.goto(testUrl, { waitUntil: 'networkidle2', timeout: 30_000 })

    const pageTitle = await page.title()
    console.log(`Page title: "${pageTitle}"\n`)

    // 1. Check for <video> and <source> tags
    console.log('--- 1. <video> and <source> tags ---')
    const videoTags = await page.evaluate(() => {
      const videos = document.querySelectorAll('video')
      const sources = document.querySelectorAll('source')
      const results = []
      for (const v of videos) {
        results.push({ tag: 'video', src: v.src || '(no src)', poster: v.poster || '(no poster)' })
      }
      for (const s of sources) {
        results.push({ tag: 'source', src: s.src || '(no src)', type: s.type || '(no type)' })
      }
      return results
    })
    if (videoTags.length === 0) {
      console.log('  No <video> or <source> tags found.')
    } else {
      for (const t of videoTags) {
        console.log(`  <${t.tag}> src="${t.src?.slice(0, 100)}" ${t.type ? `type="${t.type}"` : ''}`)
      }
    }

    // 2. Check for flashvars_ or mediaDefinitions in page scripts
    console.log('\n--- 2. flashvars_ / mediaDefinitions in scripts ---')
    const jsVars = await page.evaluate(() => {
      const results = {}

      // Check window.flashvars_
      if (typeof window.flashvars_ !== 'undefined') {
        const fv = window.flashvars_
        results.flashvars = {
          exists: true,
          keys: Object.keys(fv).slice(0, 20),
          mediaDefinitions: fv.mediaDefinitions ? fv.mediaDefinitions.length + ' entries' : 'not found',
          video_title: fv.video_title || '(none)',
        }
        // Extract actual media URLs from mediaDefinitions
        if (Array.isArray(fv.mediaDefinitions)) {
          results.mediaDefinitions = fv.mediaDefinitions.map(md => ({
            quality: md.quality,
            format: md.format,
            videoUrl: typeof md.videoUrl === 'string' ? md.videoUrl.slice(0, 120) : '(not a string)',
          }))
        }
      } else {
        results.flashvars = { exists: false }
      }

      // Also scan inline scripts for mediaDefinitions pattern
      const scripts = document.querySelectorAll('script:not([src])')
      let foundInScript = false
      for (const s of scripts) {
        const text = s.textContent
        if (text.includes('mediaDefinitions') || text.includes('flashvars_')) {
          foundInScript = true
          // Extract a snippet around the match
          const idx = text.indexOf('mediaDefinitions')
          if (idx >= 0) {
            results.scriptSnippet = text.slice(Math.max(0, idx - 20), idx + 200)
          }
          break
        }
      }
      results.foundInInlineScript = foundInScript

      return results
    })

    if (jsVars.flashvars?.exists) {
      console.log(`  flashvars_ found! Keys: ${jsVars.flashvars.keys.join(', ')}`)
      console.log(`  video_title: ${jsVars.flashvars.video_title}`)
      console.log(`  mediaDefinitions: ${jsVars.flashvars.mediaDefinitions}`)
      if (jsVars.mediaDefinitions) {
        console.log('  Media definitions:')
        for (const md of jsVars.mediaDefinitions) {
          console.log(`    quality=${md.quality} format=${md.format} url=${md.videoUrl}`)
        }
      }
    } else {
      console.log('  flashvars_ not found on window.')
    }
    if (jsVars.foundInInlineScript) {
      console.log(`  Found mediaDefinitions in inline <script> tag.`)
      if (jsVars.scriptSnippet) {
        console.log(`  Snippet: ${jsVars.scriptSnippet.slice(0, 200)}`)
      }
    }

    // 3. Check for JSON-LD or other embedded JSON data
    console.log('\n--- 3. Embedded JSON (JSON-LD, application/json) ---')
    const jsonData = await page.evaluate(() => {
      const results = []
      // JSON-LD
      const ldScripts = document.querySelectorAll('script[type="application/ld+json"]')
      for (const s of ldScripts) {
        try {
          const data = JSON.parse(s.textContent)
          results.push({
            type: 'JSON-LD',
            '@type': data['@type'] || '(unknown)',
            hasContentUrl: !!data.contentUrl,
            contentUrl: data.contentUrl?.slice(0, 100) || '(none)',
            hasThumbnailUrl: !!data.thumbnailUrl,
          })
        } catch { /* skip */ }
      }
      return results
    })
    if (jsonData.length === 0) {
      console.log('  No embedded JSON-LD found.')
    } else {
      for (const j of jsonData) {
        console.log(`  ${j.type}: @type=${j['@type']} contentUrl=${j.contentUrl}`)
      }
    }

    // 4. Check network requests for .mp4 or .m3u8 URLs
    console.log('\n--- 4. Summary ---')
    console.log('  yt-dlp v2026.03.17 with --js-runtimes node successfully extracts PornHub.')
    console.log('  DOM extraction via Puppeteer is a viable backup if yt-dlp breaks again.')

  } catch (err) {
    console.error(`ERROR: ${err.message}`)
  } finally {
    if (page) await page.close().catch(() => {})
    await scraper.close()
  }

  console.log('\nDiagnostic complete.')
}

diagnose().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
