/**
 * verify-switched-87.js
 *
 * Verifies the 87 restaurants that were switched to new platforms
 * are actually bookable at their new URLs.
 *
 * RUN:   node scripts/verify-switched-87.js
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const RESULTS_FILE = path.join(__dirname, '..', 'data', 'dead_resy_298_results.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function checkUrl(page, url, platform) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(2500);

    return await page.evaluate((plat) => {
      const body = document.body?.innerText || '';
      const finalUrl = window.location.href;
      const bodyLen = body.length;

      if (plat === 'resy') {
        const hasBooking = body.includes('Find a Time') || body.includes('Notify Me') || body.includes('Reserve Now');
        const is404 = body.includes("can't find") || body.includes('page you were looking for') ||
                       window.location.pathname === '/' || window.location.pathname === '/cities/ny';
        return { alive: !is404 && bodyLen > 500, hasBooking, finalUrl };
      }
      if (plat === 'opentable') {
        const hasBooking = body.includes('Make a reservation') || body.includes('Find a time') ||
                          body.includes('availability') || body.includes('party size');
        const is404 = body.includes('Page Not Found') || finalUrl.includes('/s?');
        return { alive: !is404 && bodyLen > 500, hasBooking, finalUrl };
      }
      if (plat === 'tock') {
        const hasBooking = body.includes('Reserve') || body.includes('Book') || body.includes('Reservation');
        const is404 = body.includes('page not found') || bodyLen < 300;
        return { alive: !is404, hasBooking, finalUrl };
      }
      return { alive: bodyLen > 500, hasBooking: false, finalUrl };
    }, platform);
  } catch {
    return { alive: false, hasBooking: false, error: true };
  }
}

async function main() {
  const master = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
  const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  const switched = Object.entries(results).filter(([, v]) => v.status === 'switched');

  console.log(`\n✅ Verifying ${switched.length} switched restaurants\n`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });
  let page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

  let verified = 0, failed = 0, reverted = 0;

  for (let i = 0; i < switched.length; i++) {
    const [name, info] = switched[i];
    process.stdout.write(`  [${i + 1}/${switched.length}] ${name.substring(0, 30).padEnd(30)} ${info.newPlatform.padEnd(10)} `);

    const check = await checkUrl(page, info.newUrl, info.newPlatform);

    if (check.alive) {
      verified++;
      console.log(`✅ ${check.hasBooking ? 'bookable' : 'alive'}`);
    } else {
      failed++;
      console.log(`❌ dead — reverting to website`);

      // Revert to website in BOOKING_MASTER
      const masterKey = Object.keys(master).find(k => k.toLowerCase() === name.toLowerCase()) || name;
      if (master[masterKey]) {
        master[masterKey].platform = 'website';
        master[masterKey].url = info.website || master[masterKey].website || '';
        reverted++;
      }
    }

    // Restart browser every 50
    if ((i + 1) % 50 === 0) {
      await browser.close();
      await sleep(2000);
      const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
      page = await b.newPage();
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    }

    await sleep(3000 + Math.random() * 3000);
  }

  await browser.close();

  if (reverted > 0) {
    fs.writeFileSync(MASTER_FILE, JSON.stringify(master, null, 2));
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Verified: ${verified}`);
  console.log(`❌ Failed (reverted to website): ${failed}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
