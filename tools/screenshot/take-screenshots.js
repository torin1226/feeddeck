#!/usr/bin/env node
/**
 * FeedDeck Screenshot Tool
 *
 * Takes real browser screenshots of FeedDeck for design reviews.
 * Self-bootstrapping: installs puppeteer-core on first run, uses
 * the persisted Chromium binary in this directory.
 *
 * Usage: node tools/screenshot/take-screenshots.js
 *
 * Prerequisites:
 *   - Chromium binary at tools/screenshot/chromium (persisted, ~183MB)
 *   - puppeteer-core installed (auto-installs if missing, ~13MB from npm)
 *
 * How it works:
 *   1. Starts a mock server serving dist/ + mock API data
 *   2. Launches headless Chromium with the persisted binary
 *   3. Patches the Zustand hydration gate via request interception
 *   4. Screenshots all 4 pages
 *   5. Saves to docs/design-reviews/screenshots/
 */

const { execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ---------- Paths ----------
const TOOL_DIR = __dirname;
const PROJECT_ROOT = path.resolve(TOOL_DIR, '..', '..');
const DIST = path.join(PROJECT_ROOT, 'dist');
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'docs', 'design-reviews', 'screenshots');
const CHROMIUM_PATH = path.join(TOOL_DIR, 'chromium');

// ---------- Step 1: Bootstrap deps ----------
function ensureDeps() {
  try {
    require.resolve('puppeteer-core');
    console.log('[setup] puppeteer-core: found');
  } catch {
    console.log('[setup] puppeteer-core: installing...');
    execSync('npm install --prefix ' + JSON.stringify(TOOL_DIR), { stdio: 'inherit' });
    console.log('[setup] puppeteer-core: installed');
  }

  if (!fs.existsSync(CHROMIUM_PATH)) {
    console.error('[setup] ERROR: Chromium binary not found at', CHROMIUM_PATH);
    console.error('[setup] To fix: npm install @sparticuz/chromium in any session,');
    console.error('[setup] then copy the extracted binary to', CHROMIUM_PATH);
    process.exit(1);
  }
  console.log('[setup] chromium binary: found');
}

// ---------- Step 2: Mock Server ----------
function createMockServer() {
  const MIME = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  };

  function vid(id, title, thumb, dur, durFmt, uploader, views, source, tags) {
    return {
      id, title, thumbnail: thumb, duration: dur, durationFormatted: durFmt,
      uploader, view_count: views, source, tags: tags || [],
      url: `https://example.com/watch/${id}`,
      fetched_at: new Date(Date.now() - Math.random() * 3 * 86400000).toISOString(),
      rating: (7 + Math.random() * 2.5).toFixed(1),
    };
  }

  const mockData = {
    categories: [
      {
        key: 'trending', label: 'Trending Today',
        videos: [
          vid('t1', 'Why Every Designer Should Learn to Code', 'https://picsum.photos/seed/code1/400/225', 728, '12:08', 'DesignCourse', 340000, 'YouTube', ['design', 'code']),
          vid('t2', 'Neomorphism is Dead. Here is What Comes Next', 'https://picsum.photos/seed/neo1/400/225', 922, '15:22', 'Flux Academy', 89000, 'YouTube', ['design', 'trends']),
          vid('t3', 'I Rebuilt Netflix in 48 Hours', 'https://picsum.photos/seed/nf1/400/225', 1930, '32:10', 'Fireship', 1800000, 'YouTube', ['engineering', 'react']),
          vid('t4', 'The State of CSS in 2026', 'https://picsum.photos/seed/css1/400/225', 1245, '20:45', 'Kevin Powell', 210000, 'YouTube', ['css', 'frontend']),
          vid('t5', 'Design Leadership from Airbnb', 'https://picsum.photos/seed/airbnb1/400/225', 1710, '28:30', 'High Resolution', 67000, 'YouTube', ['leadership', 'design']),
          vid('t6', 'Building with AI in 2026', 'https://picsum.photos/seed/ai2026/400/225', 1180, '19:40', 'Two Minute Papers', 520000, 'YouTube', ['ai', 'tech']),
          vid('t7', 'The Figma Config Recap', 'https://picsum.photos/seed/figconf/400/225', 840, '14:00', 'Figma', 145000, 'YouTube', ['design', 'tools']),
          vid('t8', 'React Server Components Explained', 'https://picsum.photos/seed/rsc2/400/225', 2295, '38:15', 'Theo', 91000, 'YouTube', ['react', 'engineering']),
        ]
      },
      {
        key: 'design', label: 'Design Deep Dives',
        videos: [
          vid('d1', 'Building Design Systems at Scale', 'https://picsum.photos/seed/ds2/400/225', 1470, '24:30', 'Figma', 142000, 'YouTube', ['design', 'systems']),
          vid('d2', 'The Future of Creative Tools', 'https://picsum.photos/seed/ct2/400/225', 1125, '18:45', 'MKBHD', 2100000, 'YouTube', ['tech', 'creative']),
          vid('d3', 'Designing for Vision Pro', 'https://picsum.photos/seed/avp2/400/225', 1335, '22:15', 'WWDC Labs', 156000, 'YouTube', ['design', 'spatial']),
          vid('d4', 'Motion Design Principles', 'https://picsum.photos/seed/motion2/400/225', 870, '14:30', 'The Futur', 78000, 'YouTube', ['design', 'motion']),
          vid('d5', 'Typography That Speaks', 'https://picsum.photos/seed/type1/400/225', 960, '16:00', 'Layout Land', 55000, 'YouTube', ['design', 'typography']),
          vid('d6', 'Color Theory for Digital Interfaces', 'https://picsum.photos/seed/color1/400/225', 1080, '18:00', 'DesignCourse', 98000, 'YouTube', ['design', 'color']),
        ]
      },
      {
        key: 'engineering', label: 'Engineering',
        videos: [
          vid('e1', 'Vite 7 Changed Everything', 'https://picsum.photos/seed/vite8/400/225', 680, '11:20', 'Fireship', 890000, 'YouTube', ['engineering', 'vite']),
          vid('e2', 'Why I Left Big Tech', 'https://picsum.photos/seed/indie2/400/225', 1195, '19:55', 'TechLead', 445000, 'YouTube', ['career', 'indie']),
          vid('e3', 'Rust for JS Developers', 'https://picsum.photos/seed/rust1/400/225', 1500, '25:00', 'No Boilerplate', 230000, 'YouTube', ['engineering', 'rust']),
          vid('e4', 'The Bun Runtime Deep Dive', 'https://picsum.photos/seed/bun1/400/225', 1320, '22:00', 'Theo', 340000, 'YouTube', ['engineering', 'bun']),
          vid('e5', 'Docker in 100 Seconds', 'https://picsum.photos/seed/docker1/400/225', 100, '1:40', 'Fireship', 4200000, 'YouTube', ['engineering', 'docker']),
        ]
      },
      {
        key: 'tiktok', label: 'TikTok Picks',
        videos: [
          vid('tk1', 'POV: Your First Design Crit', 'https://picsum.photos/seed/crit2/400/225', 45, '0:45', '@designlife', 3200000, 'TikTok', ['humor', 'design']),
          vid('tk2', 'CSS Trick You Didn\'t Know', 'https://picsum.photos/seed/csstrick2/400/225', 30, '0:30', '@webdevtips', 1800000, 'TikTok', ['css', 'tips']),
          vid('tk3', 'Day in the Life: Design Manager', 'https://picsum.photos/seed/dm2/400/225', 80, '1:20', '@techcareers', 890000, 'TikTok', ['career']),
          vid('tk4', 'This Figma Plugin Saves Hours', 'https://picsum.photos/seed/plugin2/400/225', 55, '0:55', '@figmatips', 2400000, 'TikTok', ['tools', 'figma']),
        ]
      }
    ]
  };

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/api/homepage')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(mockData));
      }
      if (req.url.startsWith('/api/tags/preferences')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ liked: ['design', 'engineering'], disliked: [] }));
      }
      if (req.url.startsWith('/api/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok' }));
      }

      let filePath = path.join(DIST, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
      if (!fs.existsSync(filePath)) filePath = path.join(DIST, 'index.html');

      try {
        const content = fs.readFileSync(filePath);
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      console.log(`[server] Mock server on http://127.0.0.1:${port}`);
      resolve({ server, port });
    });
  });
}

// ---------- Step 3: Take Screenshots ----------
async function takeScreenshots(port) {
  const puppeteer = require('puppeteer-core');

  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const today = new Date().toISOString().split('T')[0];

  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--single-process', '--no-zygote',
    ],
    headless: 'shell',
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();
  page.on('pageerror', err => console.log('[page error]', err.message));

  // Intercept requests: patch Zustand hydration gate + block external fonts
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    // Block fonts (often unreachable in sandbox)
    if (req.url().includes('fonts.googleapis.com') || req.url().includes('fonts.gstatic.com')) {
      return req.abort();
    }

    // Patch the main bundle to force _hydrated: true
    // The Zustand persist middleware sets _hydrated:!1 (false) as default
    // and onRehydrateStorage never fires in headless shell mode
    const url = req.url();
    if (url.match(/\/assets\/index-[^.]+\.js$/)) {
      try {
        const urlPath = new URL(url).pathname;
        const filePath = path.join(DIST, urlPath);
        let js = fs.readFileSync(filePath, 'utf8');
        js = js.replace(/_hydrated:!1/g, '_hydrated:!0');
        return req.respond({ status: 200, contentType: 'application/javascript', body: js });
      } catch (e) {
        console.log('[patch] Failed to patch bundle:', e.message);
      }
    }

    req.continue();
  });

  // Pre-seed localStorage
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('fd-mode', JSON.stringify({ state: { isSFW: true, _hydrated: true }, version: 0 }));
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const pages = [
    ['/', 'homepage', true],
    ['/feed', 'feed', false],
    ['/library', 'library', false],
    ['/settings', 'settings', false],
  ];

  for (const [route, name, fullPage] of pages) {
    console.log(`[screenshot] ${name}...`);
    try {
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle2', timeout: 20000 });
      await new Promise(r => setTimeout(r, 4000));

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${today}-${name}.png`),
        fullPage: false,
      });

      if (fullPage) {
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `${today}-${name}-full.png`),
          fullPage: true,
        });
      }

      console.log(`[screenshot] ${name}: saved`);
    } catch (e) {
      console.log(`[screenshot] ${name}: FAILED - ${e.message}`);
    }
  }

  await browser.close();
  console.log(`[screenshot] All done. Files in: ${SCREENSHOT_DIR}`);
}

// ---------- Main ----------
async function main() {
  console.log('=== FeedDeck Screenshot Tool ===\n');

  ensureDeps();

  const { server, port } = await createMockServer();

  try {
    await takeScreenshots(port);
  } finally {
    server.close();
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
