/**
 * verify-ot-links.js
 *
 * Checks all booked+unknown OT URLs to see if they're still valid.
 * Categorizes each as: active, closed, 404, redirect, error
 *
 * RUN: node scripts/verify-ot-links.js
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const INPUT_FILE = path.join(__dirname, '..', 'data', 'ot_recheck_list.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'ot_link_verification.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function randomDelay() { return 2000 + Math.floor(Math.random() * 3000); }

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
];

async function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });
}

async function setupPage(browser) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };
  });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  const vp = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
  await page.setViewport(vp);
  return page;
}

async function checkLink(page, url, name) {
  try {
    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    const status = response?.status() || 0;
    const finalUrl = page.url();

    const info = await page.evaluate(() => {
      const title = document.title || '';
      const body = document.body?.innerText || '';
      const h1 = document.querySelector('h1')?.textContent?.trim() || '';

      const isClosed = body.includes('permanently closed') || body.includes('Permanently Closed') ||
                       title.includes('Permanently Closed');
      const is404 = title.includes('embarrassing') || body.includes('weren\'t able to find') ||
                     body.includes('Error code: 404');
      const hasBooking = body.includes('Make a reservation') || body.includes('Find a time') ||
                         body.includes('Available') || document.querySelector('[data-test*="time-slot"]') !== null ||
                         document.querySelector('button[data-test="make-reservation"]') !== null;
      const hasMenu = body.includes('Menu') || body.includes('menu');
      const rid = document.querySelector('[data-restaurant-id]')?.getAttribute('data-restaurant-id') || '';

      // Check for "no longer taking reservations" type messages
      const noReservations = body.includes('not taking reservations') || body.includes('no longer') ||
                             body.includes('currently not available');

      return { title: title.substring(0, 100), h1, isClosed, is404, hasBooking, hasMenu, noReservations, rid };
    });

    let status_category;
    if (info.is404 || status === 404) status_category = '404_not_found';
    else if (info.isClosed) status_category = 'permanently_closed';
    else if (info.noReservations) status_category = 'no_reservations';
    else if (finalUrl.includes('/s?') || finalUrl.includes('/search')) status_category = 'redirected_to_search';
    else if (info.hasBooking) status_category = 'active_with_booking';
    else if (status === 200) status_category = 'active_no_slots';
    else status_category = 'other';

    return {
      name,
      url,
      http_status: status,
      final_url: finalUrl,
      status_category,
      title: info.title,
      has_booking_ui: info.hasBooking,
      is_closed: info.isClosed,
      rid: info.rid,
    };
  } catch (e) {
    return {
      name,
      url,
      http_status: 0,
      status_category: 'error',
      error: e.message,
    };
  }
}

async function main() {
  const toCheck = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  console.log(`🔍 Verifying ${toCheck.length} OT links\n`);

  let browser = await launchBrowser();
  let page = await setupPage(browser);
  let sessionCount = 0;

  const results = [];
  const counts = { active_with_booking: 0, active_no_slots: 0, '404_not_found': 0, permanently_closed: 0, redirected_to_search: 0, no_reservations: 0, error: 0, other: 0 };

  for (let i = 0; i < toCheck.length; i++) {
    // Restart browser every 75
    if (sessionCount >= 75) {
      await browser.close();
      await sleep(3000);
      browser = await launchBrowser();
      page = await setupPage(browser);
      sessionCount = 0;
    }

    const r = toCheck[i];
    const result = await checkLink(page, r.url, r.name);
    results.push(result);
    counts[result.status_category] = (counts[result.status_category] || 0) + 1;
    sessionCount++;

    const icons = {
      active_with_booking: '✅',
      active_no_slots: '🟠',
      '404_not_found': '❌',
      permanently_closed: '💀',
      redirected_to_search: '↪️',
      no_reservations: '🚫',
      error: '⚠️',
      other: '❓',
    };
    const icon = icons[result.status_category] || '❓';
    console.log(`  ${icon} [${i+1}/${toCheck.length}] ${r.name}: ${result.status_category} (${result.http_status})`);

    // Save every 25
    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ counts, results }, null, 2));
    }

    await sleep(randomDelay());
  }

  await browser.close();
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ counts, results }, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log('✅ Verification complete!\n');
  console.log('  ✅ Active with booking UI:', counts.active_with_booking);
  console.log('  🟠 Active but no slots:', counts.active_no_slots);
  console.log('  ❌ 404 not found:', counts['404_not_found']);
  console.log('  💀 Permanently closed:', counts.permanently_closed);
  console.log('  ↪️  Redirected to search:', counts.redirected_to_search);
  console.log('  🚫 No longer taking reservations:', counts.no_reservations);
  console.log('  ⚠️  Error:', counts.error);
  console.log('  ❓ Other:', counts.other);
  console.log(`\n  Output: ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
