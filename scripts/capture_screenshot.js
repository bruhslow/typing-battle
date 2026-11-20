// capture_screenshot.js
// Run with Node.js and Puppeteer to take a full‑page screenshot of the live Typendo site.
// Prerequisites: Node.js (v18+) installed and npm available.
//   npm install puppeteer
// Then execute:
//   node scripts/capture_screenshot.js
// The screenshot will be saved as "typendo_live.png" in the project root.

const puppeteer = require('puppeteer');

(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    console.log('Navigating to https://typendo.onrender.com ...');
    await page.goto('https://typendo.onrender.com', { waitUntil: 'networkidle2', timeout: 60000 });
    // Ensure any lazy‑loaded content is rendered
    await page.waitForTimeout(3000);
    const screenshotPath = 'typendo_live.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`✅ Screenshot saved to ${screenshotPath}`);
    await browser.close();
  } catch (err) {
    console.error('❌ Failed to capture screenshot:', err);
    process.exit(1);
  }
})();

