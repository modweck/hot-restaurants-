/**
 * ot-kosher-check.js
 *
 * Checks OpenTable availability for KOSHER OT restaurants only.
 * Uses Puppeteer + NordVPN rotation (same pattern as ot-tonight-check.js).
 *
 * RUN:   node scripts/ot-kosher-check.js
 *        node scripts/ot-kosher-check.js --date 2026-04-20
 *        node scripts/ot-kosher-check.js --party 4
 *        node scripts/ot-kosher-check.js --debug
 *
 * OUTPUT: netlify/functions/ot-kosher-availability.json (separate file, never overwrites main data)
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { execSync } = require('child_process');

// ── NordVPN IP rotation ──────────────────────────────────────────────────────
const VPN_REGIONS = ['us', 'us', 'us', 'us', 'us', 'ca', 'uk'];
async function rotateVPN() {
  const region = VPN_REGIONS[Math.floor(Math.random() * VPN_REGIONS.length)];
  const slp = ms => new Promise(r => setTimeout(r, ms));
  try {
    execSync('open -g "nordvpn://disconnect"', { timeout: 5000 });
    await slp(3000);

    for (let attempt = 1; attempt <= 3; attempt++) {
      execSync(`open -g "nordvpn://connect/${region}"`, { timeout: 5000 });
      await slp(8000);
      try {
        const ip = execSync('curl -s --max-time 5 https://api.ipify.org', { timeout: 10000 }).toString().trim();
        if (ip && ip.length > 6) {
          console.log(`  🔄 VPN rotated → ${region} (${ip})`);
          return true;
        }
      } catch (e) {}
      console.log(`  ⚠️  VPN attempt ${attempt}/3 failed, retrying...`);
      execSync('open -g "nordvpn://disconnect"', { timeout: 5000 });
      await slp(3000);
    }

    execSync('open -g "nordvpn://connect"', { timeout: 5000 });
    await slp(10000);
    const ip = execSync('curl -s --max-time 5 https://api.ipify.org', { timeout: 10000 }).toString().trim();
    console.log(`  🔄 VPN fallback connect (${ip})`);
    return true;
  } catch (e) {
    console.log(`  ⚠️  VPN rotation failed: ${e.message?.slice(0, 40)}`);
    return false;
  }
}

// ── CLI args ──
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}
const DEBUG = args.includes('--debug');
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);

let CHECK_DATE = getArg('date', null);
if (!CHECK_DATE) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  CHECK_DATE = tomorrow.toISOString().split('T')[0];
}

const FUNCTIONS_DIR = path.join(__dirname, '..', 'netlify', 'functions');
const MASTER_FILE = path.join(FUNCTIONS_DIR, 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(FUNCTIONS_DIR, 'ot-kosher-availability.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function randomDelay() { return 3000 + Math.floor(Math.random() * 5000); }

// ── Load kosher OT restaurants ──
let BOOKING_MASTER = {};
try {
  BOOKING_MASTER = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
} catch (e) {
  console.error('❌ Cannot load BOOKING_MASTER.json');
  process.exit(1);
}

const KOSHER_OT = Object.entries(BOOKING_MASTER)
  .filter(([_, v]) => {
    const cuisine = (v.cuisine || '').toLowerCase();
    return v.platform === 'opentable' && v.url &&
           (cuisine.includes('kosher') || cuisine.includes('jewish'));
  })
  .map(([name, info]) => ({ name, booking_url: info.url }));

console.log(`\n🕎 Kosher OT Check — ${CHECK_DATE} — party of ${PARTY_SIZE}`);
console.log(`   Found ${KOSHER_OT.length} kosher OpenTable restaurants:\n`);
KOSHER_OT.forEach(r => console.log(`   • ${r.name}`));
console.log('');

// ── Puppeteer helpers ──
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
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
  const url = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName)}&dateTime=${CHECK_DATE}T19%3A30%3A00&covers=${PARTY_SIZE}&metroId=8`;

  if (DEBUG) console.log(`    URL: ${url}`);

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

    if (cards.length === 0) {
      return { tier: 'unknown', dinner_slots: 0, early: 'booked', prime: 'booked', late: 'booked', sample_times: [], platform: 'opentable', checked_date: new Date().toISOString(), check_date_target: CHECK_DATE, error: 'no_cards' };
    }

    let bestCard = null, bestScore = 0;
    for (const card of cards) {
      const score = matchScore(name, card.name);
      if (score > bestScore) { bestScore = score; bestCard = card; }
    }

    const nameTooShort = name.replace(/[^a-zA-Z]/g, '').length <= 3;
    if (!bestCard || bestScore < 0.7 || (nameTooShort && bestScore < 1.0)) {
      return { tier: 'unknown', dinner_slots: 0, early: 'booked', prime: 'booked', late: 'booked', sample_times: [], platform: 'opentable', checked_date: new Date().toISOString(), check_date_target: CHECK_DATE, match_score: bestScore, cards_found: cards.map(c => c.name) };
    }

    if (bestCard.notOnOT) {
      return { tier: 'not_on_ot', dinner_slots: 0, early: 'booked', prime: 'booked', late: 'booked', sample_times: [], platform: 'opentable', checked_date: new Date().toISOString(), check_date_target: CHECK_DATE, rid: bestCard.rid ? parseInt(bestCard.rid) : undefined, matched_name: bestCard.name, match_score: bestScore };
    }

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

      if (hour >= 17.0 && hour < 18.5) early++;
      else if (hour >= 18.5 && hour < 20.5) prime++;
      else if (hour >= 20.5 && hour < 24.0) late++;
    }

    const total = parsedTimes.length;
    const tier = total === 0 ? (bestCard.noAvail ? 'booked' : 'unknown') : total <= 3 ? 'limited' : 'open';

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
      check_date_target: CHECK_DATE,
      rid: bestCard.rid ? parseInt(bestCard.rid) : undefined,
      matched_name: bestCard.name,
      match_score: bestScore,
    };
  } catch (e) {
    if (DEBUG) console.error(`  ⚠️ ${name}: ${e.message}`);
    return { tier: 'unknown', dinner_slots: 0, early: 'booked', prime: 'booked', late: 'booked', sample_times: [], platform: 'opentable', checked_date: new Date().toISOString(), check_date_target: CHECK_DATE, error: e.message?.slice(0, 100) };
  }
}

// ── Main ──
async function main() {
  if (KOSHER_OT.length === 0) {
    console.log('No kosher OT restaurants found. Exiting.');
    return;
  }

  // Rotate VPN before starting
  console.log('🔄 Rotating VPN...');
  await rotateVPN();

  let browser = await launchBrowser();
  let page = await setupPage(browser);
  const results = {};
  let checked = 0;

  for (const restaurant of KOSHER_OT) {
    checked++;
    console.log(`\n[${checked}/${KOSHER_OT.length}] ${restaurant.name}`);

    const result = await checkRestaurant(page, restaurant.name);
    results[restaurant.name] = result;

    const icon = result.tier === 'open' ? '✅' : result.tier === 'limited' ? '🟡' : result.tier === 'booked' ? '🔴' : '❓';
    console.log(`  ${icon} ${result.tier} | ${result.dinner_slots} slots | ${(result.sample_times || []).join(', ')}`);
    if (result.matched_name) console.log(`  matched: "${result.matched_name}" (score: ${result.match_score})`);
    if (result.error) console.log(`  error: ${result.error}`);

    // Save after each restaurant (in case of crash)
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

    // Random delay between checks
    const delay = randomDelay();
    if (DEBUG) console.log(`  ⏳ waiting ${Math.round(delay/1000)}s...`);
    await sleep(delay);

    // Rotate VPN between restaurants (only 4 restaurants, be extra safe)
    if (checked < KOSHER_OT.length) {
      console.log('  🔄 Rotating VPN...');
      await browser.close();
      await rotateVPN();
      browser = await launchBrowser();
      page = await setupPage(browser);
    }
  }

  await browser.close();

  // Disconnect VPN
  try { execSync('open -g "nordvpn://disconnect"', { timeout: 5000 }); } catch {}

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🕎 Kosher OT Results — ${CHECK_DATE}`);
  console.log(`${'='.repeat(60)}`);
  for (const [name, r] of Object.entries(results)) {
    const icon = r.tier === 'open' ? '✅' : r.tier === 'limited' ? '🟡' : r.tier === 'booked' ? '🔴' : '❓';
    console.log(`  ${icon} ${name.padEnd(30)} | ${r.tier.padEnd(8)} | ${r.dinner_slots} slots | ${(r.sample_times || []).join(', ')}`);
  }
  console.log(`\n📁 Saved to: ${OUTPUT_FILE}`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
