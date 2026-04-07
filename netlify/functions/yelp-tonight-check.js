/**
 * yelp-tonight-check.js
 *
 * Checks Yelp reservation availability for google_reserve restaurants in BOOKING_MASTER.json
 * using Puppeteer scraping of Yelp search/reservation pages.
 *
 * RUN:   node yelp-tonight-check.js
 *
 * OPTIONS:
 *   --party 2      Party size (default: 2)
 *   --quick        Only check first 15 (for testing)
 *   --batch 200    Only check N restaurants then stop
 *   --all          Re-check even ones already checked for this date
 *   --date 2026-04-05   Check a specific date (default: tomorrow)
 *   --debug        Verbose output
 *
 * OUTPUT: tonight_availability_yelp.json
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// ── CLI args ──
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}
const QUICK_MODE = args.includes('--quick');
const CHECK_ALL  = args.includes('--all');
const DEBUG      = args.includes('--debug');
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);
const BATCH_LIMIT = parseInt(getArg('batch', '0'), 10);
const BROWSER_RESTART_EVERY = 75;

// Date: default to tomorrow
let CHECK_DATE = getArg('date', null);
if (!CHECK_DATE) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  CHECK_DATE = tomorrow.toISOString().split('T')[0];
}
const TODAY = new Date().toISOString().split('T')[0];

const MASTER_FILE = path.join(__dirname, 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, 'tonight_availability_yelp.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function randomDelay() { return 3000 + Math.floor(Math.random() * 5000); }

// ── Load files ──
let BOOKING_MASTER = {};
try {
  BOOKING_MASTER = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
  console.log(`✅ Loaded BOOKING_MASTER: ${Object.keys(BOOKING_MASTER).length} restaurants`);
} catch (e) {
  console.error('❌ Cannot load BOOKING_MASTER.json');
  process.exit(1);
}

// Get google_reserve restaurants (these are the ones likely on Yelp)
const YELP_RESTAURANTS = Object.entries(BOOKING_MASTER)
  .filter(([_, v]) => v.platform === 'google_reserve')
  .map(([name, info]) => ({ name, place_id: info.place_id || null }));

console.log(`🍽️  Found ${YELP_RESTAURANTS.length} Google Reserve restaurants to check on Yelp`);

// Load existing results
let existing = {};
try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}

// ── Puppeteer helpers ──
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
];

async function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,800',
    ]
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

function matchScore(search, found) {
  const c = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const sc = c(search), fc = c(found);
  if (sc === fc) return 1.0;
  if (fc.includes(sc) || sc.includes(fc)) return 0.9;
  const stop = ['the', 'and', 'restaurant', 'bar', 'grill', 'cafe', 'kitchen', 'nyc', 'new', 'york'];
  const sw = sc.split(' ').filter(w => w.length > 2 && !stop.includes(w));
  const fw = fc.split(' ').filter(w => w.length > 2 && !stop.includes(w));
  if (sw.length === 0) return 0;
  const overlap = sw.filter(w => fw.some(f => f.includes(w) || w.includes(f)));
  return overlap.length / sw.length;
}

async function checkRestaurant(page, name) {
  const cleanName = name.replace(/\(.*\)/g, '').replace(/[^\w\s'-]/g, '').replace(/\s+/g, ' ').trim();

  // Format date for Yelp: YYYY-MM-DD
  const url = `https://www.yelp.com/search?find_desc=${encodeURIComponent(cleanName + ' restaurant')}&find_loc=New+York%2C+NY&attrs=Reservations`;

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });

    // Check for captcha/block
    const blocked = await page.evaluate(() => {
      return document.title.includes('unusual activity') ||
             document.body.innerText.includes('unusual traffic') ||
             document.body.innerText.includes('verify you are human');
    });
    if (blocked) {
      console.log(`    ⚠️  Yelp blocked — captcha detected`);
      return { tier: 'unknown', error: 'blocked', platform: 'yelp', checked_date: new Date().toISOString() };
    }

    // Find restaurant cards in search results
    const cards = await page.evaluate(() => {
      const results = [];
      // Yelp search result cards
      const bizCards = document.querySelectorAll('[data-testid="serp-ia-card"], .businessName__09f24__EYSZE, h3 a, [class*="businessName"] a, .css-19v1rkv');
      // Broader approach: find all links that look like business pages
      const allLinks = document.querySelectorAll('a[href*="/biz/"]');
      const seen = new Set();
      for (const link of allLinks) {
        const href = link.getAttribute('href') || '';
        const bizMatch = href.match(/\/biz\/([\w-]+)/);
        if (!bizMatch || seen.has(bizMatch[1])) continue;
        seen.add(bizMatch[1]);
        const nameEl = link.closest('[data-testid]')?.querySelector('a[href*="/biz/"]') || link;
        const n = nameEl.textContent.replace(/^\d+\.\s*/, '').trim();
        if (!n || n.length < 2) continue;
        results.push({ name: n, slug: bizMatch[1], href: '/biz/' + bizMatch[1] });
        if (results.length >= 5) break;
      }
      return results;
    });

    if (cards.length === 0) {
      if (DEBUG) console.log(`    ⚠️  ${name}: no search results`);
      return { tier: 'unknown', dinner_slots: 0, sample_times: [], platform: 'yelp', checked_date: new Date().toISOString(), error: 'no_results' };
    }

    // Find best match
    let bestCard = null, bestScore = 0;
    for (const card of cards) {
      const score = matchScore(name, card.name);
      if (score > bestScore) { bestScore = score; bestCard = card; }
    }

    const nameTooShort = name.replace(/[^a-zA-Z]/g, '').length <= 3;
    if (!bestCard || bestScore < 0.7 || (nameTooShort && bestScore < 1.0)) {
      if (DEBUG) console.log(`    ⚠️  ${name}: no good match (best=${bestScore.toFixed(2)} "${bestCard?.name}")`);
      return { tier: 'unknown', dinner_slots: 0, sample_times: [], platform: 'yelp', checked_date: new Date().toISOString(), match_score: bestScore };
    }

    // Navigate to the restaurant's reservation page
    const resUrl = `https://www.yelp.com${bestCard.href}#reserve`;
    await page.goto(resUrl, { waitUntil: 'networkidle2', timeout: 25000 });
    await sleep(1500);

    // Try to set date and party size, then scrape time slots
    const availData = await page.evaluate((checkDate, partySize) => {
      const result = { hasReservation: false, slots: [], noAvail: false, matchedName: '' };

      // Get restaurant name from page
      const h1 = document.querySelector('h1');
      result.matchedName = h1 ? h1.textContent.trim() : '';

      // Check if reservation widget exists
      const reserveSection = document.querySelector('[class*="reservation"], [data-testid*="reservation"], #reserve, [aria-label*="reservation"], [class*="Reserve"]');
      if (!reserveSection) {
        // Try broader search for any booking-related content
        const pageText = document.body.innerText;
        if (pageText.includes('Make a Reservation') || pageText.includes('Find a Table') || pageText.includes('Reserve a Table')) {
          result.hasReservation = true;
        }
        // Look for time slot buttons anywhere
        const timeButtons = document.querySelectorAll('button, a');
        for (const btn of timeButtons) {
          const text = btn.textContent.trim();
          const timeMatch = text.match(/^(\d{1,2}:\d{2}\s*[AP]M)$/i);
          if (timeMatch) result.slots.push(timeMatch[1]);
        }
      } else {
        result.hasReservation = true;
        // Look for time slots within reservation widget
        const slotEls = reserveSection.querySelectorAll('button, a, [role="option"]');
        for (const el of slotEls) {
          const text = el.textContent.trim();
          const timeMatch = text.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
          if (timeMatch && !el.disabled) result.slots.push(timeMatch[1]);
        }
      }

      // Also check for "no availability" messages
      const pageText = document.body.innerText;
      if (pageText.includes('No availability') || pageText.includes('no tables available') || pageText.includes('fully booked')) {
        result.noAvail = true;
      }

      return result;
    }, CHECK_DATE, PARTY_SIZE);

    if (!availData.hasReservation && availData.slots.length === 0) {
      return {
        tier: 'no_yelp_reservations',
        dinner_slots: 0,
        early: 'booked', prime: 'booked', late: 'booked',
        sample_times: [],
        platform: 'yelp',
        checked_date: new Date().toISOString(),
        yelp_slug: bestCard.slug,
        matched_name: bestCard.name,
        match_score: bestScore,
      };
    }

    // Parse time slots into categories
    let early = 0, prime = 0, late = 0;
    const parsedTimes = [];

    for (const timeStr of availData.slots) {
      const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!m) continue;
      let h = parseInt(m[1]);
      const min = parseInt(m[2]);
      const ampm = m[3].toUpperCase();
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      const hour = h + min / 60;

      parsedTimes.push(timeStr.trim());

      // Early = 5:00-6:30pm | Prime = 6:30-8:30pm | Late = 8:30pm+
      if (hour >= 17.0 && hour < 18.5) early++;
      else if (hour >= 18.5 && hour < 20.5) prime++;
      else if (hour >= 20.5 && hour < 24.0) late++;
    }

    const total = parsedTimes.length;
    let tier;
    if (availData.noAvail && total === 0) tier = 'booked';
    else if (total === 0) tier = 'booked';
    else if (total <= 3) tier = 'limited';
    else tier = 'open';

    let earlyStatus, primeStatus, lateStatus;
    if (tier === 'open') {
      earlyStatus = early > 0 ? 'available' : 'booked';
      primeStatus = prime > 0 ? 'available' : 'booked';
      lateStatus = late > 0 ? 'available' : 'booked';
    } else if (tier === 'limited') {
      earlyStatus = early > 0 ? 'limited' : 'booked';
      primeStatus = prime > 0 ? 'limited' : 'booked';
      lateStatus = late > 0 ? 'limited' : 'booked';
    } else {
      earlyStatus = 'booked'; primeStatus = 'booked'; lateStatus = 'booked';
    }

    return {
      tier,
      dinner_slots: total,
      early: earlyStatus,
      prime: primeStatus,
      late: lateStatus,
      has_early: earlyStatus !== 'booked',
      has_prime: primeStatus !== 'booked',
      has_late: lateStatus !== 'booked',
      sample_times: parsedTimes.slice(0, 8),
      platform: 'yelp',
      checked_date: new Date().toISOString(),
      yelp_slug: bestCard.slug,
      matched_name: bestCard.name || availData.matchedName,
      match_score: bestScore,
    };
  } catch (e) {
    if (DEBUG) console.error(`  ⚠️  ${name}: ${e.message}`);
    return { tier: 'unknown', dinner_slots: 0, early: 'booked', prime: 'booked', late: 'booked', sample_times: [], platform: 'yelp', checked_date: new Date().toISOString(), error: e.message?.slice(0, 80) };
  }
}

// ── Save helper ──
function saveResults() {
  existing._meta = {
    last_updated: new Date().toISOString(),
    check_date: CHECK_DATE,
    party_size: PARTY_SIZE,
    total_checked: Object.keys(existing).filter(k => !k.startsWith('_')).length,
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));
}

// ── Main ──
async function main() {
  let toCheck = YELP_RESTAURANTS;

  // Skip recently checked unless --all
  if (!CHECK_ALL) {
    toCheck = toCheck.filter(r => {
      const prev = existing[r.name.toLowerCase()];
      if (!prev?.checked_date) return true;
      const checkedDate = prev.checked_date.split('T')[0];
      return checkedDate !== TODAY;
    });
    console.log(`⏭️  Skipping ${YELP_RESTAURANTS.length - toCheck.length} already checked today`);
  }

  if (QUICK_MODE) toCheck = toCheck.slice(0, 15);
  if (BATCH_LIMIT > 0) toCheck = toCheck.slice(0, BATCH_LIMIT);

  console.log(`\n🔍 Checking ${toCheck.length} restaurants on Yelp for ${CHECK_DATE} (party of ${PARTY_SIZE})\n`);

  let browser = await launchBrowser();
  let page = await setupPage(browser);
  let checked = 0, available = 0, limited = 0, booked = 0, noYelp = 0, errors = 0;

  for (let i = 0; i < toCheck.length; i++) {
    const r = toCheck[i];

    // Restart browser periodically for fresh session
    if (i > 0 && i % BROWSER_RESTART_EVERY === 0) {
      console.log(`\n  🔄 Restarting browser (${i}/${toCheck.length})...\n`);
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
      await sleep(2000);
      browser = await launchBrowser();
      page = await setupPage(browser);
    }

    const result = await checkRestaurant(page, r.name);
    const key = r.name.toLowerCase();
    existing[key] = result;
    checked++;

    // Status emoji
    let status;
    if (result.tier === 'open') { status = '🟢'; available++; }
    else if (result.tier === 'limited') { status = '🟡'; limited++; }
    else if (result.tier === 'booked') { status = '🔴'; booked++; }
    else if (result.tier === 'no_yelp_reservations') { status = '⚪'; noYelp++; }
    else { status = '❓'; errors++; }

    const slots = result.sample_times?.length ? ` [${result.sample_times.slice(0, 3).join(', ')}]` : '';
    const matchInfo = result.matched_name ? ` → "${result.matched_name}" (${(result.match_score * 100).toFixed(0)}%)` : '';
    console.log(`  ${status} ${i + 1}/${toCheck.length} ${r.name}${matchInfo}${slots}`);

    // Save every 25
    if (checked % 25 === 0) saveResults();

    // Random delay
    await sleep(randomDelay());
  }

  // Final save
  saveResults();

  await page.close().catch(() => {});
  await browser.close().catch(() => {});

  console.log(`\n✅ Done! Checked ${checked} restaurants`);
  console.log(`   🟢 Available: ${available}`);
  console.log(`   🟡 Limited: ${limited}`);
  console.log(`   🔴 Booked: ${booked}`);
  console.log(`   ⚪ No Yelp reservations: ${noYelp}`);
  console.log(`   ❓ Errors: ${errors}`);
  console.log(`   📁 Saved to ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
