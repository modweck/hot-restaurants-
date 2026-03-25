/**
 * fetch-websites.js
 *
 * Uses Puppeteer to visit Google Maps for each walk_in entry without a URL,
 * extracts the website link from the place page.
 *
 * RUN: node scripts/fetch-websites.js
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BM_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'website_lookups.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWebsite(page, placeId, name) {
  try {
    const url = `https://www.google.com/maps/place/?q=place_id:${placeId}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(2000);

    const result = await page.evaluate(() => {
      // Look for website link
      const links = document.querySelectorAll('a[data-item-id="authority"]');
      if (links.length > 0) {
        return { website: links[0].href };
      }

      // Try alternate selectors
      const allLinks = document.querySelectorAll('a[href]');
      for (const link of allLinks) {
        const ariaLabel = link.getAttribute('aria-label') || '';
        if (ariaLabel.toLowerCase().includes('website')) {
          return { website: link.href };
        }
      }

      // Try to find in the page text
      const buttons = document.querySelectorAll('button[data-item-id="authority"]');
      if (buttons.length > 0) {
        return { website: buttons[0].textContent.trim() };
      }

      // Check for any booking links too
      const booking = {};
      for (const link of allLinks) {
        const href = link.href || '';
        if (href.includes('resy.com/cities')) booking.resy = href;
        if (href.includes('opentable.com')) booking.opentable = href;
        if (href.includes('exploretock.com')) booking.tock = href;
      }
      if (Object.keys(booking).length > 0) return { booking };

      return null;
    });

    return result;
  } catch (e) {
    return { error: e.message.slice(0, 80) };
  }
}

async function main() {
  const bm = JSON.parse(fs.readFileSync(BM_FILE, 'utf8'));

  const noUrl = Object.entries(bm).filter(([, v]) =>
    v.platform === 'walk_in' && !v.url && v.place_id
  );

  console.log(`\n🔍 Looking up websites for ${noUrl.length} walk-in entries...\n`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
  });

  const results = { found: [], not_found: [], booking: [], error: [] };

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    for (let i = 0; i < noUrl.length; i++) {
      const [name, data] = noUrl[i];
      process.stdout.write(`  [${i + 1}/${noUrl.length}] ${name} ... `);

      const result = await getWebsite(page, data.place_id, name);

      if (result?.booking) {
        const platform = result.booking.resy ? 'resy' : result.booking.opentable ? 'opentable' : 'tock';
        const url = result.booking.resy || result.booking.opentable || result.booking.tock;
        console.log(`🎯 ${platform}: ${url.slice(0, 60)}`);
        results.booking.push({ name, platform, url });
        bm[name].platform = platform;
        bm[name].url = url;
      } else if (result?.website) {
        console.log(`🌐 ${result.website.slice(0, 60)}`);
        results.found.push({ name, website: result.website });
        bm[name].platform = 'website';
        bm[name].url = result.website;
      } else if (result?.error) {
        console.log(`❌ ${result.error.slice(0, 50)}`);
        results.error.push({ name, error: result.error });
      } else {
        console.log(`❌ no website`);
        results.not_found.push({ name });
      }

      // Save progress
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
      fs.writeFileSync(BM_FILE, JSON.stringify(bm, null, 2));

      // 5-8 sec delay
      if (i < noUrl.length - 1) {
        await sleep(5000 + Math.random() * 3000);
      }
    }

    await page.close();
  } finally {
    await browser.close();
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🌐 Found website:    ${results.found.length}`);
  console.log(`🎯 Found booking:    ${results.booking.length}`);
  console.log(`❌ No website:       ${results.not_found.length}`);
  console.log(`⚠️  Errors:          ${results.error.length}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`💾 Saved`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
