/**
 * ot-tonight-check.js
 *
 * Checks OpenTable availability for ALL OT restaurants in BOOKING_MASTER.json
 * using Puppeteer search page scraping.
 *
 * RUN:   node ot-tonight-check.js
 *
 * OPTIONS:
 *   --party 2      Party size (default: 2)
 *   --quick        Only check first 15 (for testing)
 *   --batch 200    Only check N restaurants then stop
 *   --all          Re-check even ones already checked for this date
 *   --date 2026-03-26   Check a specific date (default: tomorrow)
 *   --debug        Verbose output
 *
 * OUTPUT: tonight_availability_ot.json
 *
 * ANTI-DETECTION:
 *   - Restarts browser every 75 restaurants (fresh session/cookies)
 *   - Random 3-8s delay between requests (human-like)
 *   - Varies viewport size slightly per session
 *   - Skips already-checked restaurants (incremental)
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const { execSync } = require('child_process');

// ── NordVPN IP rotation (polling method from ot-limited-and-booked.js) ──
const VPN_REGIONS = ['us', 'us', 'us', 'us', 'us', 'ca', 'uk'];
async function rotateVPN() {
  const region = VPN_REGIONS[Math.floor(Math.random() * VPN_REGIONS.length)];
  try {
    execSync('open -g "nordvpn://disconnect"', { timeout: 5000 });
    await sleep(2000);

    for (let attempt = 1; attempt <= 3; attempt++) {
      execSync(`open -g "nordvpn://connect/${region}"`, { timeout: 5000 });

      // Poll up to 30s for internet to come back
      let connected = false;
      for (let poll = 0; poll < 10; poll++) {
        await sleep(3000);
        try {
          const ip = execSync('curl -s --max-time 4 https://api.ipify.org', { timeout: 8000 }).toString().trim();
          if (ip && ip.length > 6) {
            console.log(`    🔄 VPN → ${region} (${ip}) [attempt ${attempt}, ${(poll+1)*3}s]`);
            connected = true;
            break;
          }
        } catch {}
      }
      if (connected) return true;

      console.log(`    ⚠️  VPN attempt ${attempt}/3 — no internet after 30s`);
      execSync('open -g "nordvpn://disconnect"', { timeout: 5000 });
      await sleep(3000);
    }

    // Last resort
    execSync('open -g "nordvpn://connect"', { timeout: 5000 });
    for (let poll = 0; poll < 10; poll++) {
      await sleep(3000);
      try {
        const ip = execSync('curl -s --max-time 4 https://api.ipify.org', { timeout: 8000 }).toString().trim();
        if (ip && ip.length > 6) { console.log(`    🔄 VPN fallback connected (${ip})`); return true; }
      } catch {}
    }
    console.log(`    ⚠️  VPN rotation failed — continuing without`);
    return false;
  } catch (e) {
    console.log(`    ⚠️  VPN error: ${e.message?.slice(0, 40)}`);
    return false;
  }
}

// ── CLI args ──
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}
const QUICK_MODE = args.includes('--quick');
const CHECK_ALL  = args.includes('--all');
const DEBUG      = args.includes('--debug');
const PHASE2_ONLY = args.includes('--phase2');
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);
const BATCH_LIMIT = parseInt(getArg('batch', '0'), 10);
const BROWSER_RESTART_EVERY = 5;

// Split mode: --split 2 --half 1 (or --half 2) to run two instances in parallel
const SPLIT_TOTAL = parseInt(getArg('split', '1'), 10);
const SPLIT_HALF  = parseInt(getArg('half', '1'), 10);

// Date: default to tomorrow
let CHECK_DATE = getArg('date', null);
if (!CHECK_DATE) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  CHECK_DATE = tomorrow.toISOString().split('T')[0];
}

const TODAY = new Date().toISOString().split('T')[0];

const MASTER_FILE = path.join(__dirname, 'BOOKING_MASTER.json');
const OUTPUT_FILE = SPLIT_TOTAL > 1
  ? path.join(__dirname, `ot_availability_${CHECK_DATE}_half${SPLIT_HALF}.json`)
  : path.join(__dirname, `ot_availability_${CHECK_DATE}.json`);
const VERIFIED_OPEN_FILE = path.join(__dirname, 'ot_verified_open_2026-04-09.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function randomDelay() { return 15000 + Math.floor(Math.random() * 5000); } // 15-20s

// ── Load files ──
let BOOKING_MASTER = {};
try {
  BOOKING_MASTER = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
  console.log(`✅ Loaded BOOKING_MASTER: ${Object.keys(BOOKING_MASTER).length} restaurants`);
} catch (e) {
  console.error('❌ Cannot load BOOKING_MASTER.json');
  process.exit(1);
}

// Get OT restaurants
const OT_RESTAURANTS = Object.entries(BOOKING_MASTER)
  .filter(([_, v]) => v.platform === 'opentable' && v.url)
  .map(([name, info]) => ({ name, booking_url: info.url }));

// Load verified open (skip these)
let verifiedOpen = {};
try { verifiedOpen = JSON.parse(fs.readFileSync(VERIFIED_OPEN_FILE, 'utf8')); } catch {}
const skipSet = new Set(Object.keys(verifiedOpen).map(k => k.toLowerCase()));

console.log(`🍽️  Found ${OT_RESTAURANTS.length} OpenTable restaurants (skipping ${skipSet.size} verified open)`);

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
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--window-size=1280,800',
    ]
  });
}

async function setupPage(browser) {
  const page = await browser.newPage();
  // Stealth plugin handles all anti-detection automatically
  const vp = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
  await page.setViewport({ ...vp, deviceScaleFactor: 2 });
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
  // Search at 7:30pm — OT shows slots within 2.5hrs (5:00pm-10:00pm)
  const url = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName)}&dateTime=${CHECK_DATE}T19%3A30%3A00&covers=${PARTY_SIZE}&metroId=8`;

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });

    const cards = await page.evaluate(() => {
      const results = [];
      const cardEls = document.querySelectorAll('[data-test="pinned-restaurant-card"],[data-test="restaurant-card"]');
      for (const card of Array.from(cardEls).slice(0, 5)) {
        const nameEl = card.querySelector('a[data-test="res-card-name"]');
        const n = nameEl ? nameEl.textContent.trim() : '';
        const rid = card.getAttribute('data-rid') || '';

        const slotEls = card.querySelectorAll('li[data-test^="time-slot"]');
        const slots = [];
        for (const s of slotEls) {
          const text = s.textContent.trim();
          const match = text.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
          if (match) slots.push(match[1]);
        }

        const cardText = card.innerText;
        const noAvail = cardText.includes('no online availability') ||
                        cardText.includes('No tables') ||
                        cardText.includes('fully booked');
        const notOnOT = cardText.includes('not on the OpenTable reservation network');
        const bookedTimesMatch = cardText.match(/Booked (\d+) times/);
        const bookedTimes = bookedTimesMatch ? parseInt(bookedTimesMatch[1]) : 0;

        results.push({ name: n, rid, slots, noAvail, notOnOT, bookedTimes });
      }
      return results;
    });

    // Empty page = likely blocked or stale browser, not "booked"
    if (cards.length === 0) {
      return { tier: 'unknown', dinner_slots: 0, early: 'booked', prime: 'booked', late: 'booked', sample_times: [], platform: 'opentable', checked_date: new Date().toISOString(), error: 'no_cards' };
    }

    // Find best matching card
    let bestCard = null, bestScore = 0;
    for (const card of cards) {
      const score = matchScore(name, card.name);
      if (score > bestScore) { bestScore = score; bestCard = card; }
    }

    // Reject bad matches: score too low or name too short (causes false matches)
    const nameTooShort = name.replace(/[^a-zA-Z]/g, '').length <= 3;
    if (!bestCard || bestScore < 0.7 || (nameTooShort && bestScore < 1.0)) {
      return { tier: 'unknown', dinner_slots: 0, early: 'booked', prime: 'booked', late: 'booked', sample_times: [], platform: 'opentable', checked_date: new Date().toISOString(), match_score: bestScore };
    }

    // Restaurant exists on OT but doesn't take reservations through OT
    if (bestCard.notOnOT) {
      return { tier: 'not_on_ot', dinner_slots: 0, early: 'booked', prime: 'booked', late: 'booked', sample_times: [], platform: 'opentable', checked_date: new Date().toISOString(), rid: bestCard.rid ? parseInt(bestCard.rid) : undefined, matched_name: bestCard.name, match_score: bestScore };
    }

    // Parse time slots into categories
    let early = 0, prime = 0, late = 0;
    const parsedTimes = [];

    for (const timeStr of bestCard.slots) {
      const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!m) continue;
      let h = parseInt(m[1]);
      const min = parseInt(m[2]);
      const ampm = m[3].toUpperCase();
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      const hour = h + min / 60;

      parsedTimes.push(timeStr.trim());

      // Early = 5:00-6:30pm | Prime = 6:30-8:30pm | Late = 8:30pm+ (aligned with Resy)
      if (hour >= 17.0 && hour < 18.5) early++;
      else if (hour >= 18.5 && hour < 20.5) prime++;
      else if (hour >= 20.5 && hour < 24.0) late++;
    }

    const total = parsedTimes.length;
    const tier = total === 0 ? 'booked' : total <= 3 ? 'limited' : 'open';

    let earlyStatus, primeStatus, lateStatus;
    if (tier === 'open') {
      earlyStatus = 'available'; primeStatus = 'available'; lateStatus = 'available';
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
      sample_times: parsedTimes.slice(0, 5),
      platform: 'opentable',
      checked_date: new Date().toISOString(),
      rid: bestCard.rid ? parseInt(bestCard.rid) : undefined,
      matched_name: bestCard.name,
      match_score: bestScore,
    };
  } catch (e) {
    if (DEBUG) console.error(`  ⚠️ ${name}: ${e.message}`);
    return { tier: 'unknown', dinner_slots: 0, early: 'booked', prime: 'booked', late: 'booked', sample_times: [], platform: 'opentable', checked_date: new Date().toISOString(), error: e.message };
  }
}

// ── Main ──
async function main() {
  let toCheck = OT_RESTAURANTS;

  // --phase2: skip Phase 1, jump straight to Phase 2 recheck using existing data
  if (PHASE2_ONLY) {
    console.log(`⏭️  --phase2 flag: skipping Phase 1, using existing data for Phase 2 recheck`);
    toCheck = [];
  }

  // Skip verified open restaurants
  toCheck = toCheck.filter(r => !skipSet.has(r.name.toLowerCase()));
  console.log(`⏭️  After skipping verified open: ${toCheck.length} to check`);

  // Skip recently checked unless --all
  if (!CHECK_ALL) {
    toCheck = toCheck.filter(r => {
      const prev = existing[r.name.toLowerCase()];
      if (!prev?.checked_date) return true;
      const checkedDate = prev.checked_date.split('T')[0];
      return checkedDate !== TODAY;
    });
    console.log(`⏭️  Skipping ${OT_RESTAURANTS.length - toCheck.length} already checked today`);
  }

  if (QUICK_MODE) toCheck = toCheck.slice(0, 15);
  if (BATCH_LIMIT > 0) toCheck = toCheck.slice(0, BATCH_LIMIT);

  // Split mode: divide list for parallel execution
  if (SPLIT_TOTAL > 1) {
    const chunkSize = Math.ceil(toCheck.length / SPLIT_TOTAL);
    const start = (SPLIT_HALF - 1) * chunkSize;
    toCheck = toCheck.slice(start, start + chunkSize);
    console.log(`🔀 Split mode: half ${SPLIT_HALF}/${SPLIT_TOTAL} (${toCheck.length} restaurants)`);
  }

  console.log(`\n🔍 Checking ${toCheck.length} restaurants for ${CHECK_DATE}, party of ${PARTY_SIZE}`);
  console.log(`   Browser restart every ${BROWSER_RESTART_EVERY} | Random delay 3-8s\n`);

  let browser = await launchBrowser();
  let page = await setupPage(browser);
  let sessionCount = 0; // requests since last browser restart

  const results = { ...existing };
  let checked = 0, open = 0, limited = 0, booked = 0, unknown = 0, notOnOT = 0;
  let consecutiveUnknowns = 0;

  for (const restaurant of toCheck) {
    // Restart browser every N requests
    if (sessionCount >= BROWSER_RESTART_EVERY) {
      console.log(`\n  🔄 Rotating VPN + restarting browser (session ${Math.floor(checked / BROWSER_RESTART_EVERY) + 1})...\n`);
      await browser.close();
      await rotateVPN();
      await sleep(20000); // 20s cooldown after VPN rotation
      browser = await launchBrowser();
      page = await setupPage(browser);
      sessionCount = 0;
    }

    const key = restaurant.name.toLowerCase();
    let result = await checkRestaurant(page, restaurant.name);
    // Retry once on unknown
    if (result.tier === 'unknown') {
      await sleep(5000);
      result = await checkRestaurant(page, restaurant.name);
      sessionCount++;
    }
    results[key] = result;

    checked++;
    sessionCount++;
    // Open restaurants: mark all windows available since they have 4+ slots across times
    if (result.tier === 'open') {
      result.has_early = true;
      result.has_prime = true;
      result.has_late = true;
      results[key] = result;
    }
    if (result.tier === 'open') { open++; consecutiveUnknowns = 0; }
    else if (result.tier === 'limited') { limited++; consecutiveUnknowns = 0; }
    else if (result.tier === 'booked') { booked++; consecutiveUnknowns = 0; }
    else if (result.tier === 'not_on_ot') { notOnOT++; consecutiveUnknowns = 0; }
    else { unknown++; consecutiveUnknowns++; }

    const icon = result.tier === 'open' ? '🟢' : result.tier === 'limited' ? '🟡' : result.tier === 'booked' ? '🔴' : result.tier === 'not_on_ot' ? '🚫' : '❓';
    const times = result.sample_times?.length > 0 ? ` → ${result.sample_times.join(', ')}` : '';
    console.log(`  ${icon} [${checked}/${toCheck.length}] ${restaurant.name}: ${result.tier} (${result.dinner_slots} slots)${times}`);

    // If we get 10+ unknowns in a row, rotate VPN + restart browser
    if (consecutiveUnknowns >= 10) {
      console.log(`\n  ⚠️  ${consecutiveUnknowns} consecutive unknowns — rotating VPN + restarting browser...\n`);
      await browser.close();
      await rotateVPN();
      await sleep(20000); // 20s cooldown after emergency rotation
      browser = await launchBrowser();
      page = await setupPage(browser);
      sessionCount = 0;
      consecutiveUnknowns = 0;
    }

    // Save incrementally every 10
    if (checked % 10 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    }

    await sleep(randomDelay());
  }

  // ── Phase 2 & 3 disabled — Phase 1 only ────────
  if (false) { // DISABLED
  const recheckKeys = Object.entries(results)
    .filter(([_, v]) => v.tier === 'booked' || v.tier === 'limited')
    .map(([k, v]) => ({ name: k, matched_name: v.matched_name, tier: v.tier }));

  if (recheckKeys.length > 0) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`🔍 Phase 2: Checking ${recheckKeys.length} limited+booked restaurants at 5:30pm, 7:30pm, 9:30pm\n`);

    const TIME_CHECKS = [
      { time: '17:30:00', label: 'early' },
      { time: '19:30:00', label: 'prime' },
      { time: '21:30:00', label: 'late' },
    ];

    let flipped = 0;
    for (let i = 0; i < recheckKeys.length; i++) {
      if (sessionCount >= BROWSER_RESTART_EVERY) {
        await browser.close();
        await sleep(5000);
        browser = await launchBrowser();
        page = await setupPage(browser);
        sessionCount = 0;
      }

      const r = recheckKeys[i];
      const cleanName = r.name.replace(/\(.*\)/g, '').replace(/[^\w\s'-]/g, '').replace(/\s+/g, ' ').trim();
      let hasEarly = false, hasPrime = false, hasLate = false;

      // Skip prime recheck for booked — Phase 1 already searched at 7:30pm and found nothing
      const checks = r.tier === 'booked' ? TIME_CHECKS.filter(tc => tc.label !== 'prime') : TIME_CHECKS;

      for (const tc of checks) {
        try {
          const url = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName)}&dateTime=${CHECK_DATE}T${encodeURIComponent(tc.time)}&covers=${PARTY_SIZE}&metroId=8`;
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
          const slotCount = await page.evaluate((searchName) => {
            const cards = document.querySelectorAll('[data-test="pinned-restaurant-card"],[data-test="restaurant-card"]');
            for (const card of cards) {
              const cardName = card.querySelector('a[data-test="res-card-name"]')?.textContent?.trim() || '';
              const notOnOT = card.innerText.includes('not on the OpenTable reservation network');
              if (notOnOT) continue;
              const cw = searchName.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(w => w.length > 2);
              const cn = cardName.toLowerCase().replace(/[^a-z0-9 ]/g, '');
              const matched = cw.filter(w => cn.includes(w)).length;
              if (matched < Math.max(1, cw.length * 0.5)) continue;
              const slots = card.querySelectorAll('li[data-test^="time-slot"]');
              if (slots.length > 0) return slots.length;
            }
            return 0;
          }, cleanName);
          if (slotCount > 0) {
            if (tc.label === 'early') hasEarly = true;
            else if (tc.label === 'prime') hasPrime = true;
            else if (tc.label === 'late') hasLate = true;
          }
          sessionCount++;
        } catch {}
        await sleep(randomDelay());
      }

      // For booked restaurants, keep Phase 1 prime result (already false)
      if (r.tier !== 'booked') hasPrime = hasPrime;
      else hasPrime = results[r.name].has_prime || false;

      const anyAvail = hasEarly || hasPrime || hasLate;
      results[r.name].has_early = hasEarly;
      results[r.name].has_prime = hasPrime;
      results[r.name].has_late = hasLate;
      results[r.name].early = hasEarly ? 'limited' : 'booked';
      results[r.name].prime = hasPrime ? 'limited' : 'booked';
      results[r.name].late = hasLate ? 'limited' : 'booked';

      if (anyAvail && r.tier === 'booked') {
        results[r.name].tier = 'limited';
        flipped++;
      }

      const icon = anyAvail ? '🟡' : '🔴';
      const detail = `early=${hasEarly ? '✅' : '❌'} prime=${hasPrime ? '✅' : '❌'} late=${hasLate ? '✅' : '❌'}`;
      console.log(`  ${icon} [${i+1}/${recheckKeys.length}] ${r.name}: ${detail}`);

      if ((i+1) % 10 === 0) fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    }

    console.log(`\n   🔄 Flipped ${flipped} from booked → limited (had early/prime/late slots)`);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  }

  // ── Future availability for remaining booked (+3, +5, +7, +14 days) ────
  const stillBooked = Object.entries(results)
    .filter(([_, v]) => v.tier === 'booked')
    .map(([k]) => k);

  if (stillBooked.length > 0) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`🔮 Checking future availability for ${stillBooked.length} booked restaurants\n`);

    const OFFSETS = [3, 7, 14];
    function futureDate(offset) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return d.toISOString().split('T')[0];
    }

    let hasFuture = 0, locked = 0;
    for (let i = 0; i < stillBooked.length; i++) {
      if (sessionCount >= BROWSER_RESTART_EVERY) {
        await browser.close();
        await sleep(5000);
        browser = await launchBrowser();
        page = await setupPage(browser);
        sessionCount = 0;
      }

      const name = stillBooked[i];
      const cleanName = name.replace(/\(.*\)/g, '').replace(/[^\w\s'-]/g, '').replace(/\s+/g, ' ').trim();
      let opensIn = null;

      for (const offset of OFFSETS) {
        try {
          const date = futureDate(offset);
          const url = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName)}&dateTime=${date}T19%3A30%3A00&covers=${PARTY_SIZE}&metroId=8`;
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });

          const slotCount = await page.evaluate(() => {
            const card = document.querySelector('[data-test="pinned-restaurant-card"],[data-test="restaurant-card"]');
            if (!card || card.innerText.includes('not on the OpenTable reservation network')) return 0;
            return card.querySelectorAll('li[data-test^="time-slot"]').length;
          });

          sessionCount++;
          if (slotCount >= 2) { opensIn = offset; break; }
        } catch {}
        await sleep(randomDelay());
      }

      if (opensIn) {
        results[name].opens_in = opensIn;
        hasFuture++;
        console.log(`  🟢 [${i+1}/${stillBooked.length}] ${name}: opens in +${opensIn}d`);
      } else {
        results[name].fully_locked = true;
        locked++;
        console.log(`  🔒 [${i+1}/${stillBooked.length}] ${name}: locked`);
      }

      if ((i+1) % 10 === 0) fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
      await sleep(randomDelay());
    }

    console.log(`\n   🟢 Has future: ${hasFuture}  🔒 Locked: ${locked}`);
  }
  } // END disabled Phase 2 & 3

  await browser.close();

  // Save final results
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

  // Results saved to date-stamped file only — review before merging into live data

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Done! Checked ${checked} OpenTable restaurants`);
  console.log(`   🟢 Open: ${open}  🟡 Limited: ${limited}  🔴 Booked: ${booked}  🚫 Not on OT: ${notOnOT}  ❓ Unknown: ${unknown}`);
  console.log(`   Output: ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
