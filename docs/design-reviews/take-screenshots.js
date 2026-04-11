const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = '/sessions/eloquent-nice-fermat/mnt/area 51/feeddeck/docs/design-reviews/screenshots';
const OUTPUT_DIR = '/sessions/eloquent-nice-fermat/mnt/area 51';

async function run() {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const execPath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    executablePath: execPath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process', '--no-zygote'],
    headless: 'shell',
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();
  page.on('pageerror', err => console.log('[ERR]', err.message));

  // Intercept requests to patch the hydration gate
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    if (req.url().includes('index-DyzO066L.js')) {
      // Read the JS file, patch the hydration check, serve modified version
      try {
        const jsPath = '/sessions/eloquent-nice-fermat/mnt/area 51/feeddeck/dist/assets/index-DyzO066L.js';
        let js = fs.readFileSync(jsPath, 'utf8');
        
        // Find and patch the _hydrated check. In minified code it will be something like:
        // if(!something._hydrated) return <loading div>
        // We need to find the pattern and force _hydrated to true
        
        // The modeStore has: _hydrated: false and onRehydrateStorage sets it true
        // In the minified bundle, let's find "_hydrated" and force it
        const hydCount = (js.match(/_hydrated/g) || []).length;
        console.log('Found _hydrated occurrences:', hydCount);
        
        // Replace `_hydrated:!1` (minified false) with `_hydrated:!0` (minified true)  
        js = js.replace(/_hydrated:!1/g, '_hydrated:!0');
        // Also try the pattern where it's set in the initial state
        js = js.replace(/_hydrated:false/g, '_hydrated:true');
        
        const hydCount2 = (js.match(/_hydrated:!0/g) || []).length;
        console.log('After patch _hydrated:!0 occurrences:', hydCount2);
        
        req.respond({
          status: 200,
          contentType: 'application/javascript',
          body: js,
        });
        return;
      } catch(e) {
        console.log('Patch failed:', e.message);
      }
    }
    
    // Block font requests to avoid the ERR_EMPTY_RESPONSE noise
    if (req.url().includes('fonts.googleapis.com') || req.url().includes('fonts.gstatic.com')) {
      req.abort();
      return;
    }
    
    req.continue();
  });

  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('fd-mode', JSON.stringify({ state: { isSFW: true, _hydrated: true }, version: 0 }));
  });

  console.log('Loading with patched JS...');
  await page.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle2', timeout: 30000 });
  
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const html = await page.evaluate(() => document.getElementById('root')?.innerHTML?.slice(0, 120));
    const loaded = !html?.includes('h-screen w-full bg-surface</div>');
    console.log(`[${i+1}s] ${loaded ? '✓ LOADED' : '... waiting'}`);
    if (loaded) {
      // Give images time to load
      await new Promise(r => setTimeout(r, 3000));
      break;
    }
  }

  // Take all screenshots
  const finalHTML = await page.evaluate(() => document.getElementById('root')?.innerHTML?.slice(0, 300));
  console.log('Final DOM:', finalHTML);

  await page.screenshot({ path: path.join(OUTPUT_DIR, 'feeddeck-homepage-screenshot.png') });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '2026-04-08-homepage.png') });
  console.log('Homepage saved');
  
  // Full page
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '2026-04-08-homepage-full.png'), fullPage: true });
  console.log('Full page saved');

  // Other pages
  for (const [route, name] of [['/feed', 'feed'], ['/library', 'library'], ['/settings', 'settings']]) {
    await page.goto(`http://127.0.0.1:8765${route}`, { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise(r => setTimeout(r, 4000));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `2026-04-08-${name}.png`) });
    console.log(`${name} saved`);
  }

  await browser.close();
  console.log('\nDone! All screenshots in:', SCREENSHOT_DIR);
}

run().catch(console.error);
