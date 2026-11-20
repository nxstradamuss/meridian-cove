const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = [
  { name: '1-city', params: '?shot=city', wait: 3000 },
  { name: '2-chase', params: '?shot=chase', wait: 3000 },
  { name: '3-mission', params: '?shot=mission', wait: 5000 },
  { name: '4-standoff', params: '?shot=standoff', wait: 3000 },
];

const OUTPUT_DIR = path.join(__dirname, 'screenshots');
const BASE_URL = 'http://localhost:8080';

async function capture() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // Listen for all console messages
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      console.log('BROWSER ERROR:', text);
    } else if (text.includes('gta') || text.includes('ready') || text.includes('particle')) {
      console.log('BROWSER:', text);
    }
  });

  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message);
  });

  for (const shot of SHOTS) {
    const url = BASE_URL + shot.params;
    console.log(`Capturing ${shot.name}...`);
    await page.goto(url, { waitUntil: 'networkidle' });

    // Wait for the game to signal ready (gta.ready = true)
    try {
      await page.waitForFunction(() => window.__gta?.ready === true, { timeout: 60000 });
      console.log(`${shot.name}: gta.ready = true`);
    } catch (e) {
      console.log(`${shot.name}: TIMEOUT waiting for gta.ready`);
      // Check what gta exists
      const gtaState = await page.evaluate(() => window.__gta);
      console.log('gta object:', JSON.stringify(gtaState, (k, v) => typeof v === 'function' ? '[Function]' : v, 2));
    }

    // Extra settle time for particles/animation
    await page.waitForTimeout(shot.wait);

    const outputPath = path.join(OUTPUT_DIR, `${shot.name}.png`);
    await page.screenshot({ path: outputPath, fullPage: false });
    console.log(`Saved ${outputPath}`);
  }

  await browser.close();
  console.log('All shots captured!');
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});