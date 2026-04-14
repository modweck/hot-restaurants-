/**
 * tock-tonight-check.js
 *
 * Checks Tock availability for all Tock restaurants in BOOKING_MASTER.json
 * using Puppeteer to scrape exploretock.com pages.
 *
 * RUN:   node tock-tonight-check.js
 *
 * OPTIONS:
 *   --quick        Only check first 10 (for testing)
 *   --all          Re-check even ones already checked today
 *   --debug        Verbose output
 *
 * OUTPUT: Updates tonight_availability.json with Tock restaurants
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const CHECK_ALL = args.includes('--all');
const DEBUG = args.includes('--debug');

const TODAY = new Date().toISOString().split('T')[0];
const MASTER_FILE = path.join(__dirname, 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, 'tonight_availability.json');

const PARTY_SIZE = 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function randomDelay() { return 3000 + Math.floor(Math.random() * 4000); }

// ── Load data ──
let BOOKING_MASTER = {};
try {
  BOOKING_MASTER = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
  console.log(`✅ Loaded BOOKING_MASTER: ${Object.keys(BOOKING_MASTER).length} restaurants`);
} catch (e) {
  console.error('❌ Cannot load BOOKING_MASTER.json');
  process.exit(1);
}

// Get Tock restaurants
const TOCK_RESTAURANTS = Object.entries(BOOKING_MASTER)
  .filter(([_, v]) => v.platform === 'tock' && v.url)
  .map(([name, info]) => ({ name, url: info.url }));

console.log(`🎫 Found ${TOCK_RESTAURANTS.length} Tock restaurants`);

// Load existing results
let existing = {};
try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}

// ── Puppeteer setup ──
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
  });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  return page;
}

async function checkTockRestaurant(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(2000);

    // Click "Reservations" button if visible to reveal booking widget
    try {
      await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
          if (b.textContent.trim() === 'Reservations') { b.click(); break; }
        }
      });
      await sleep(2000);
    } catch {}

    const result = await page.evaluate(() => {
      const body = document.body?.innerText || '';
      const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());

      const isSoldOut = body.includes('Sold out') || body.includes('All reservations sold out');
      const hasNotify = buttons.some(b => b === 'Notify');
      const hasBookNow = buttons.some(b => b.includes('Book now'));
      const hasReservation = body.includes('Reservation for parties') || body.includes('Reservation\n');
      const is404 = body.length < 300 || body.includes('page not found');
      const isPickupOnly = (body.includes('Pickup') || body.includes('Delivery')) && !hasBookNow && !hasReservation && !isSoldOut;

      // Check for prepaid/experience pricing
      const priceMatch = body.match(/\$(\d+)\s*per person/);
      const price = priceMatch ? parseInt(priceMatch[1]) : null;

      // Check hours
      const hoursMatch = body.match(/Today\s*\n?\s*(\d{1,2}:\d{2}\s*[AP]M)\s*[–-]\s*(\d{1,2}:\d{2}\s*[AP]M)/);
      const openToday = !!hoursMatch;
      const hours = hoursMatch ? { open: hoursMatch[1], close: hoursMatch[2] } : null;

      // Count experiences/reservation types
      const reservationSections = (body.match(/Reservation\n/g) || []).length;

      return {
        isSoldOut,
        hasNotify,
        hasBookNow,
        hasReservation,
        is404,
        isPickupOnly,
        price,
        openToday,
        hours,
        reservationSections,
        bodyLen: body.length,
      };
    });

    if (result.is404) {
      return { tier: 'unknown', platform: 'tock', error: '404' };
    }

    if (result.isSoldOut || (result.hasNotify && !result.hasBookNow)) {
      return {
        tier: 'booked',
        dinner_slots: 0,
        early: 'booked',
        prime: 'booked',
        late: 'booked',
        sample_times: [],
        platform: 'tock',
        prepaid_price: result.price,
        open_today: result.openToday,
        hours: result.hours,
        checked_date: new Date().toISOString(),
      };
    }

    if (result.hasBookNow || result.hasReservation) {
      function parseHour(t) {
        const m = t.match(/(\d{1,2}):(\d{2})\s*([APap][Mm])/);
        if (!m) return null;
        let h = parseInt(m[1]);
        const isPM = m[3].toUpperCase() === 'PM';
        if (isPM && h !== 12) h += 12;
        if (!isPM && h === 12) h = 0;
        return h + parseInt(m[2]) / 60;
      }

      // ── Tasting menu / prepaid experience ──
      if (result.price) {
        return {
          tier: 'tasting_menu',
          dinner_slots: result.reservationSections || 1,
          early: null,
          prime: null,
          late: null,
          sample_times: [],
          platform: 'tock',
          prepaid_price: result.price,
          open_today: result.openToday,
          hours: result.hours,
          checked_date: new Date().toISOString(),
        };
      }

      // ── Standard reservation — click "Book now" to get time slots ──
      let timeSlots = [];
      try {
        await page.evaluate(() => {
          for (const b of document.querySelectorAll('button')) {
            if (b.textContent.trim() === 'Book now') { b.click(); break; }
          }
        });
        await sleep(3000);

        timeSlots = await page.evaluate(() => {
          const body = document.body?.innerText || '';
          const times = body.match(/\d{1,2}:\d{2}\s*[APap][Mm]/g) || [];
          return [...new Set(times)];
        });
      } catch {}

      const dinnerTimes = timeSlots.map(parseHour).filter(h => h !== null && h >= 17);

      // Same window logic as Resy: 0-1 = booked, 2-3 = limited, 4+ = available
      const earlySlots = dinnerTimes.filter(h => h >= 17 && h < 18.5);
      const primeSlots = dinnerTimes.filter(h => h >= 18.5 && h < 20.5);
      const lateSlots = dinnerTimes.filter(h => h >= 20.75);

      function windowStatus(count) {
        if (count === 0) return 'booked';
        if (count <= 3) return 'limited';
        return 'available';
      }

      const early = windowStatus(earlySlots.length);
      const prime = windowStatus(primeSlots.length);
      const late = windowStatus(lateSlots.length);

      let tier;
      if (dinnerTimes.length === 0) {
        tier = timeSlots.length > 0 ? 'limited' : 'booked';
      } else if (dinnerTimes.length <= 1) {
        tier = 'booked';
      } else if (dinnerTimes.length <= 3) {
        tier = 'limited';
      } else {
        tier = 'open';
      }

      const sampleDinner = timeSlots.filter(t => { const h = parseHour(t); return h !== null && h >= 17; }).sort((a, b) => parseHour(a) - parseHour(b)).slice(0, 10);

      return {
        tier,
        dinner_slots: dinnerTimes.length,
        early,
        prime,
        late,
        sample_times: sampleDinner,
        platform: 'tock',
        prepaid_price: null,
        open_today: result.openToday,
        hours: result.hours,
        checked_date: new Date().toISOString(),
      };
    }

    // Pickup/delivery only — not a dine-in restaurant on Tock
    if (result.isPickupOnly) {
      return {
        tier: 'pickup_only',
        platform: 'tock',
        open_today: result.openToday,
        checked_date: new Date().toISOString(),
      };
    }

    // No clear signal
    return {
      tier: 'unknown',
      platform: 'tock',
      open_today: result.openToday,
      checked_date: new Date().toISOString(),
    };
  } catch (e) {
    if (DEBUG) console.error(`  ⚠️ ${url}: ${e.message}`);
    return { tier: 'unknown', platform: 'tock', error: e.message };
  }
}

// ── Main ──
async function main() {
  let toCheck = TOCK_RESTAURANTS;

  if (!CHECK_ALL) {
    toCheck = toCheck.filter(r => {
      const key = r.name.toLowerCase();
      const prev = existing[key];
      if (!prev?.checked_date) return true;
      return prev.checked_date.split('T')[0] !== TODAY;
    });
    console.log(`⏭️  Skipping ${TOCK_RESTAURANTS.length - toCheck.length} already checked today`);
  }

  if (QUICK) toCheck = toCheck.slice(0, 10);

  console.log(`\n🔍 Checking ${toCheck.length} Tock restaurants`);
  console.log(`   Random delay 3-7s between requests\n`);

  let browser = await launchBrowser();
  let page = await setupPage(browser);
  let checked = 0, open = 0, limited = 0, booked = 0, unknown = 0;

  for (const restaurant of toCheck) {
    // Restart browser every 25
    if (checked > 0 && checked % 25 === 0) {
      await browser.close();
      await sleep(3000);
      browser = await launchBrowser();
      page = await setupPage(browser);
    }

    const key = restaurant.name.toLowerCase();
    const result = await checkTockRestaurant(page, restaurant.url);

    // Retry once on unknown
    if (result.tier === 'unknown' && !result.error?.includes('404')) {
      await sleep(5000);
      const retry = await checkTockRestaurant(page, restaurant.url);
      if (retry.tier !== 'unknown') {
        existing[key] = retry;
        checked++;
        if (retry.tier === 'open') open++;
        else if (retry.tier === 'limited') limited++;
        else if (retry.tier === 'booked') booked++;
        const icon = retry.tier === 'open' ? '🟢' : retry.tier === 'limited' ? '🟡' : '🔴';
        console.log(`  ${icon} [${checked}/${toCheck.length}] ${restaurant.name}: ${retry.tier} (retry)`);
        await sleep(randomDelay());
        continue;
      }
    }

    existing[key] = result;
    checked++;

    if (result.tier === 'open') open++;
    else if (result.tier === 'limited') limited++;
    else if (result.tier === 'booked') booked++;
    else unknown++;

    const icon = result.tier === 'open' ? '🟢' : result.tier === 'limited' ? '🟡' : result.tier === 'booked' ? '🔴' : '❓';
    const price = result.prepaid_price ? ` ($${result.prepaid_price}/pp)` : '';
    console.log(`  ${icon} [${checked}/${toCheck.length}] ${restaurant.name}: ${result.tier}${price}`);

    if (checked % 10 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));
    }
    await sleep(randomDelay());
  }

  // ── Phase 2: Future availability for booked restaurants ──
  const bookedList = [];
  for (const r of toCheck) {
    const key = r.name.toLowerCase();
    if (existing[key]?.tier === 'booked') bookedList.push(r);
  }

  if (bookedList.length > 0) {
    const OFFSETS = [3, 5, 7, 14];
    function futureDate(offset) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return d.toISOString().split('T')[0];
    }

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`🔮 Phase 2: Checking future availability for ${bookedList.length} booked Tock restaurants\n`);

    let hasFuture = 0, locked = 0;

    for (let i = 0; i < bookedList.length; i++) {
      if (checked % 25 === 0 && i > 0) {
        await browser.close();
        await sleep(3000);
        browser = await launchBrowser();
        page = await setupPage(browser);
      }

      const r = bookedList[i];
      const key = r.name.toLowerCase();
      let opensIn = null;

      for (const offset of OFFSETS) {
        const date = futureDate(offset);
        try {
          await page.goto(`${r.url}?date=${date}&size=${PARTY_SIZE}`, { waitUntil: 'networkidle2', timeout: 12000 });
          await sleep(1500);

          // Click Reservations button
          await page.evaluate(() => {
            for (const b of document.querySelectorAll('button')) {
              if (b.textContent.trim() === 'Reservations') { b.click(); break; }
            }
          });
          await sleep(1500);

          const hasAvail = await page.evaluate(() => {
            const body = document.body?.innerText || '';
            return body.includes('Book now') || (body.includes('Reservation for parties') && !body.includes('Sold out'));
          });

          if (hasAvail && !opensIn) opensIn = offset;
        } catch {}
        await sleep(randomDelay());
      }

      if (opensIn) {
        existing[key].opens_in = opensIn;
        hasFuture++;
        console.log(`  🟢 [${i+1}/${bookedList.length}] ${r.name}: opens in +${opensIn}d`);
      } else {
        existing[key].fully_locked = true;
        locked++;
        console.log(`  🔒 [${i+1}/${bookedList.length}] ${r.name}: locked`);
      }

      if ((i + 1) % 5 === 0) {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));
      }
    }

    console.log(`\n   🟢 Has future: ${hasFuture}  🔒 Locked: ${locked}`);
  }

  await browser.close();

  // Save
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Done! Checked ${checked} Tock restaurants`);
  console.log(`   🟢 Open: ${open}  🟡 Limited: ${limited}  🔴 Booked: ${booked}  ❓ Unknown: ${unknown}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
