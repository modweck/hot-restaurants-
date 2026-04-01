/**
 * resy-puppeteer-verify.js
 *
 * Puppeteer-based verification for Resy restaurants marked as "booked" or "unknown"
 * by the API check. Also checks future availability (+3, +5, +7, +14 days).
 *
 * Phase 1: Verify tonight's booked/unknown restaurants on resy.com
 * Phase 2: Check future dates for confirmed booked restaurants
 *
 * RUN:   node scripts/utilities/resy-puppeteer-verify.js
 * OPTIONS:
 *   --quick       Only check first 15 (testing)
 *   --batch N     Check N restaurants then stop
 *   --debug       Verbose output
 *
 * OUTPUT: Updates tonight_availability.json in place
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const DEBUG = args.includes('--debug');
function getArg(name, def) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}
const BATCH_LIMIT = parseInt(getArg('batch', '0'), 10);
const BROWSER_RESTART_EVERY = 50;

const MASTER_FILE = path.join(__dirname, '../../netlify/functions/BOOKING_MASTER.json');
const AVAIL_FILE = path.join(__dirname, '../../netlify/functions/tonight_availability.json');
const FUTURE_FILE = path.join(__dirname, '../../data/booked_future_availability.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function randomDelay() { return 3000 + Math.floor(Math.random() * 5000); }

const TODAY = new Date().toISOString().split('T')[0];

// ── Load data ──
let BOOKING_MASTER = {};
try {
  BOOKING_MASTER = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
  console.log(`✅ Loaded BOOKING_MASTER: ${Object.keys(BOOKING_MASTER).length} restaurants`);
} catch (e) {
  console.error('❌ Cannot load BOOKING_MASTER.json');
  process.exit(1);
}

let AVAIL = {};
try {
  AVAIL = JSON.parse(fs.readFileSync(AVAIL_FILE, 'utf8'));
  console.log(`✅ Loaded tonight_availability.json: ${Object.keys(AVAIL).length} entries`);
} catch (e) {
  console.error('❌ Cannot load tonight_availability.json');
  process.exit(1);
}

// ── Find booked/unknown Resy restaurants ──
const toVerify = [];
for (const [name, info] of Object.entries(BOOKING_MASTER)) {
  if (info.platform !== 'resy' || !info.url) continue;
  const slug = extractResySlug(info.url);
  if (!slug) continue;

  const key = name.toLowerCase ? name.toLowerCase() : name;
  const avail = AVAIL[key] || AVAIL[name];
  if (!avail) continue;

  // Check booked, unknown, or error entries
  if (avail.tier === 'booked' || avail.tier === 'unknown' || avail.error) {
    toVerify.push({ name, slug, url: info.url, key });
  }
}

function extractResySlug(url) {
  if (!url) return null;
  const v = url.match(/resy\.com\/cities\/[a-z-]+\/venues\/([a-z0-9-]+)\/?/i);
  if (v) return v[1];
  const m = url.match(/resy\.com\/cities\/[a-z-]+\/([a-z0-9-]+)\/?/i);
  return m ? m[1] : null;
}

console.log(`🔍 Found ${toVerify.length} booked/unknown Resy restaurants to verify`);

// ── Puppeteer setup ──
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

async function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1280,800']
  });
}

async function setupPage(browser) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  const vp = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
  await page.setViewport(vp);
  return page;
}

async function checkResyPage(page, slug, date) {
  const url = `https://resy.com/cities/ny/${slug}?date=${date}&seats=2`;
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

    // Wait for page to load
    await sleep(2000);

    // Click "7:00 PM" time option to trigger slot loading
    try {
      await page.evaluate(() => {
        // Find the time picker and try to select a prime time
        const allOptions = document.querySelectorAll('option, li, button, div');
        for (const el of allOptions) {
          const text = el.textContent.trim();
          if (text === '7:00 PM' || text === '7:30 PM' || text === '8:00 PM') {
            el.click();
            break;
          }
        }
      });
    } catch {}

    // Wait for slots/notify to render after time selection
    await sleep(3000);

    const result = await page.evaluate(() => {
      const body = document.body?.innerText || '';

      // After clicking a time, "Notify" appears if booked
      const hasNotify = body.includes('Notify') && !body.includes('Notifications');
      const noAvail = hasNotify ||
                      body.includes('No availability') ||
                      body.includes('no times available') ||
                      body.includes('sold out');

      // Check for slot buttons that appear after time selection
      const slots = [];
      const selectors = [
        'button[data-test-id="time-slot"]',
        '.ReservationButton__time',
        '.ShiftInventory__time',
        '[class*="TimeSlot"]',
        '[class*="timeslot"]',
        '[class*="slot-button"]',
        '[data-test-id="venue-slot"]'
      ];
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const text = el.textContent.trim();
          if (text && text.match(/\d{1,2}:\d{2}/)) slots.push(text);
        }
        if (slots.length > 0) break;
      }

      // Also check for any clickable time elements that appeared
      if (slots.length === 0) {
        const allBtns = document.querySelectorAll('button');
        for (const btn of allBtns) {
          const text = btn.textContent.trim();
          // Match time patterns like "5:30 PM" or "7:00 PM Dining Room"
          const m = text.match(/^(\d{1,2}:\d{2}\s*(AM|PM))/i);
          if (m) slots.push(m[1]);
        }
      }

      const is404 = body.includes('page not found') || body.includes('404') || body.includes('no longer available');

      return { slots, noAvail, hasNotify, is404, bodyLength: body.length };
    });

    if (result.is404) return { status: 'dead', slots: 0, early: 'booked', prime: 'booked', late: 'booked' };
    if (result.noAvail && result.slots.length === 0) {
      return { status: 'booked', slots: 0, early: 'booked', prime: 'booked', late: 'booked' };
    }

    if (result.slots.length > 0) {
      // Parse time slots into early/prime/late
      let early = 0, prime = 0, late = 0;
      for (const timeStr of result.slots) {
        const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
        if (!m) continue;
        let h = parseInt(m[1]);
        const min = parseInt(m[2]);
        const ampm = (m[3] || '').toUpperCase();
        if (ampm === 'PM' && h !== 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        // If no AM/PM and hour < 12, assume PM for dinner
        if (!m[3] && h < 12 && h >= 1 && h <= 6) h += 12;
        const hour = h + min / 60;

        if (hour >= 17.0 && hour < 18.5) early++;
        else if (hour >= 18.5 && hour < 20.5) prime++;
        else if (hour >= 20.5 && hour < 24.0) late++;
      }

      const total = result.slots.length;
      const tier = total >= 8 ? 'open' : total >= 1 ? 'limited' : 'booked';
      const earlyStatus = early > 0 ? (early >= 3 ? 'available' : 'limited') : 'booked';
      const primeStatus = prime > 0 ? (prime >= 3 ? 'available' : 'limited') : 'booked';
      const lateStatus = late > 0 ? (late >= 3 ? 'available' : 'limited') : 'booked';

      return {
        status: 'available', tier, slots: total,
        early: earlyStatus, prime: primeStatus, late: lateStatus,
        sample_times: result.slots.slice(0, 5)
      };
    }

    // If page loaded but no clear signal, likely booked
    return { status: result.bodyLength > 500 ? 'booked' : 'unknown', slots: 0, early: 'booked', prime: 'booked', late: 'booked' };
  } catch (e) {
    if (DEBUG) console.error(`  ⚠️ ${slug}: ${e.message}`);
    return { status: 'error', slots: 0, error: e.message };
  }
}

// ── Phase 1: Verify tonight's booked/unknown ──
async function main() {
  let list = toVerify;
  if (QUICK) list = list.slice(0, 15);
  if (BATCH_LIMIT > 0) list = list.slice(0, BATCH_LIMIT);

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📋 PHASE 1: Verify ${list.length} booked/unknown restaurants for tonight`);
  console.log(`${'═'.repeat(50)}\n`);

  let browser = await launchBrowser();
  let page = await setupPage(browser);
  let sessionCount = 0;
  let flipped = 0, confirmed = 0, errors = 0;

  for (let i = 0; i < list.length; i++) {
    if (sessionCount >= BROWSER_RESTART_EVERY) {
      console.log(`\n  🔄 Restarting browser...\n`);
      await browser.close();
      await sleep(5000);
      browser = await launchBrowser();
      page = await setupPage(browser);
      sessionCount = 0;
    }

    const r = list[i];
    const result = await checkResyPage(page, r.slug, TODAY);
    sessionCount++;

    if (result.status === 'available') {
      // Flip from booked to available with early/prime/late
      const entry = AVAIL[r.key] || AVAIL[r.name];
      if (entry) {
        entry.tier = result.tier || (result.slots >= 8 ? 'open' : 'limited');
        entry.dinner_slots = result.slots;
        entry.early = result.early;
        entry.prime = result.prime;
        entry.late = result.late;
        entry.sample_times = result.sample_times || [];
        entry.puppeteer_verified = true;
        entry.checked_date = new Date().toISOString();
        flipped++;
      }
      const windows = `[${result.early}/${result.prime}/${result.late}]`;
      console.log(`  🟢 [${i+1}/${list.length}] ${r.name}: FLIPPED → ${result.slots} slots ${windows} (${result.sample_times?.join(', ')})`);
    } else if (result.status === 'error') {
      errors++;
      console.log(`  ❓ [${i+1}/${list.length}] ${r.name}: error`);
    } else {
      confirmed++;
      console.log(`  🔴 [${i+1}/${list.length}] ${r.name}: confirmed booked`);
    }

    if ((i + 1) % 10 === 0) {
      fs.writeFileSync(AVAIL_FILE, JSON.stringify(AVAIL, null, 2));
    }
    await sleep(randomDelay());
  }

  fs.writeFileSync(AVAIL_FILE, JSON.stringify(AVAIL, null, 2));
  console.log(`\n  Phase 1 done: ${flipped} flipped, ${confirmed} confirmed booked, ${errors} errors\n`);

  // ── Phase 2: Future availability for confirmed booked ──
  const bookedList = [];
  for (const r of list) {
    const entry = AVAIL[r.key] || AVAIL[r.name];
    if (entry && (entry.tier === 'booked') && !entry.puppeteer_verified) {
      bookedList.push(r);
    }
  }

  const OFFSETS = [3, 5, 7, 14];
  function futureDate(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().split('T')[0];
  }

  if (bookedList.length > 0) {
    console.log(`${'═'.repeat(50)}`);
    console.log(`🔮 PHASE 2: Check future availability for ${bookedList.length} booked restaurants`);
    console.log(`${'═'.repeat(50)}\n`);

    let hasFuture = 0, locked = 0;
    const futureResults = {};

    for (let i = 0; i < bookedList.length; i++) {
      if (sessionCount >= BROWSER_RESTART_EVERY) {
        await browser.close();
        await sleep(5000);
        browser = await launchBrowser();
        page = await setupPage(browser);
        sessionCount = 0;
      }

      const r = bookedList[i];
      let opensIn = null;
      const dates = {};

      for (const offset of OFFSETS) {
        const date = futureDate(offset);
        const result = await checkResyPage(page, r.slug, date);
        sessionCount++;
        dates[`+${offset}`] = { available: result.status === 'available', slots: result.slots };

        if (result.status === 'available' && !opensIn) {
          opensIn = offset;
        }
        await sleep(randomDelay());
      }

      const entry = AVAIL[r.key] || AVAIL[r.name];
      if (opensIn) {
        if (entry) entry.opens_in = opensIn;
        hasFuture++;
        console.log(`  🟢 [${i+1}/${bookedList.length}] ${r.name}: opens in +${opensIn}d`);
      } else {
        if (entry) entry.fully_locked = true;
        locked++;
        console.log(`  🔒 [${i+1}/${bookedList.length}] ${r.name}: locked`);
      }

      futureResults[r.name] = { hasAnyAvailability: !!opensIn, dates };

      if ((i + 1) % 5 === 0) {
        fs.writeFileSync(AVAIL_FILE, JSON.stringify(AVAIL, null, 2));
      }
      await sleep(randomDelay());
    }

    // Save future results
    let existingFuture = {};
    try { existingFuture = JSON.parse(fs.readFileSync(FUTURE_FILE, 'utf8')); } catch {}
    existingFuture.results = { ...(existingFuture.results || {}), ...futureResults };
    existingFuture.last_puppeteer_run = new Date().toISOString();
    fs.writeFileSync(FUTURE_FILE, JSON.stringify(existingFuture, null, 2));

    console.log(`\n  Phase 2 done: ${hasFuture} have future slots, ${locked} fully locked`);
  }

  await browser.close();

  // Final save
  fs.writeFileSync(AVAIL_FILE, JSON.stringify(AVAIL, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ All done!`);
  console.log(`   Phase 1: ${flipped} flipped from booked → available`);
  console.log(`   Phase 2: future availability checked for ${bookedList.length} restaurants`);
  console.log(`${'═'.repeat(50)}\n`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
