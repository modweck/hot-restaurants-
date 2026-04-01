/**
 * verify-264-puppeteer.js
 *
 * Uses Puppeteer to visit each of the 264 broken Resy URLs and check
 * if the page actually loads a venue or shows "not found".
 * The API returns 404 for these but the website might still work.
 *
 * Much faster than the old verifier — 15s per page, headless.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const INPUT_FILE = path.join(__dirname, '..', 'data', 'resy_264_deep_check.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'resy_264_puppeteer_results.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function checkResyPage(page, url, name) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(3000);

    const result = await page.evaluate(() => {
      const body = document.body ? document.body.innerText : '';
      const title = document.title || '';

      const notFound = body.includes('page you were looking for') ||
                       body.includes('couldn\'t find') ||
                       body.includes('no longer available') ||
                       body.includes('page not found');

      const closed = body.includes('permanently closed') ||
                     body.includes('this venue is closed');

      const hasVenueName = !!document.querySelector('.VenuePage__name, [class*="VenueName"], [class*="venue-name"], h1');
      const venueName = document.querySelector('.VenuePage__name, [class*="VenueName"], [class*="venue-name"], h1')?.textContent?.trim() || '';

      const hasBooking = !!document.querySelector('[class*="ReservationButton"], [class*="TimeSlot"], [class*="time-slot"], .BookingWidget');

      return { notFound, closed, hasVenueName, venueName, hasBooking, title, bodySnippet: body.slice(0, 300) };
    });

    return {
      status: result.notFound ? 'not_found' : result.closed ? 'closed' : 'alive',
      venueName: result.venueName,
      hasBooking: result.hasBooking,
      title: result.title,
    };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
}

async function main() {
  const entries = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));

  let results = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    results = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  }

  const remaining = entries.filter(e => !results[e.name] && e.url && e.url.includes('resy.com'));
  console.log(`\n🔍 Puppeteer verification of Resy pages`);
  console.log(`   Total: ${entries.length}`);
  console.log(`   Already done: ${Object.keys(results).length}`);
  console.log(`   Remaining (with resy URL): ${remaining.length}\n`);

  if (remaining.length === 0) {
    console.log('Nothing to check!');
    return;
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });

  let alive = 0, dead = 0, errors = 0;

  for (let i = 0; i < remaining.length; i++) {
    const e = remaining[i];
    const pct = ((i + 1) / remaining.length * 100).toFixed(0);

    const result = await checkResyPage(page, e.url, e.name);
    results[e.name] = { ...result, url: e.url };

    if (result.status === 'alive') {
      alive++;
      console.log(`✅ [${pct}%] ${e.name} — ALIVE (${result.venueName || 'no name found'})`);
    } else if (result.status === 'not_found') {
      dead++;
      console.log(`❌ [${pct}%] ${e.name} — NOT FOUND`);
    } else if (result.status === 'closed') {
      dead++;
      console.log(`🔒 [${pct}%] ${e.name} — CLOSED`);
    } else {
      errors++;
      console.log(`⚠️ [${pct}%] ${e.name} — ERROR: ${result.error}`);
    }

    // Save every 10
    if ((i + 1) % 10 === 0 || i === remaining.length - 1) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    }

    // Small delay to be polite
    await sleep(2000 + Math.random() * 2000);
  }

  await browser.close();

  console.log(`\n📊 Results:`);
  console.log(`   ✅ Alive: ${alive}`);
  console.log(`   ❌ Dead: ${dead}`);
  console.log(`   ⚠️ Errors: ${errors}`);

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\n💾 Saved to ${OUTPUT_FILE}`);
}

main().catch(console.error);
