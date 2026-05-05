/**
 * ot-future-check-booked.js
 *
 * Checks future availability (+3, +7, +14, +21 days) for OT restaurants
 * that were fully booked on the last check.
 *
 * RUN:   node ot-future-check-booked.js
 *
 * OPTIONS:
 *   --party 2      Party size (default: 2)
 *   --quick        Only check first 5 (for testing)
 *   --debug        Verbose output
 *
 * INPUT:  ot_avail_3window.json (from Desktop — the booked list)
 * OUTPUT: ot_future_booked_results.json
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const { execSync } = require('child_process');

// ── NordVPN IP rotation ──
const VPN_REGIONS = ['us', 'us', 'us', 'us', 'us', 'ca', 'uk'];
async function rotateVPN() {
  const region = VPN_REGIONS[Math.floor(Math.random() * VPN_REGIONS.length)];
  try {
    execSync('open -g "nordvpn://disconnect"', { timeout: 5000 });
    await sleep(2000);
    for (let attempt = 1; attempt <= 3; attempt++) {
      execSync(`open -g "nordvpn://connect/${region}"`, { timeout: 5000 });
      let connected = false;
      for (let poll = 0; poll < 10; poll++) {
        await sleep(3000);
        try {
          const ip = execSync('curl -s --max-time 4 https://api.ipify.org', { timeout: 8000 }).toString().trim();
          if (ip && ip.length > 6) {
            console.log(`    🔄 VPN → ${region} (${ip}) [attempt ${attempt}]`);
            connected = true;
            break;
          }
        } catch {}
      }
      if (connected) return true;
      execSync('open -g "nordvpn://disconnect"', { timeout: 5000 });
      await sleep(3000);
    }
    execSync('open -g "nordvpn://connect"', { timeout: 5000 });
    for (let poll = 0; poll < 10; poll++) {
      await sleep(3000);
      try {
        const ip = execSync('curl -s --max-time 4 https://api.ipify.org', { timeout: 8000 }).toString().trim();
        if (ip && ip.length > 6) { console.log(`    🔄 VPN fallback (${ip})`); return true; }
      } catch {}
    }
    console.log(`    ⚠️  VPN rotation failed`);
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
const DEBUG = args.includes('--debug');
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);
const BROWSER_RESTART_EVERY = 5;

const sleep = ms => new Promise(r => setTimeout(r, ms));
function randomDelay() { return 15000 + Math.floor(Math.random() * 5000); }

// ── Future dates ──
const OFFSETS = [2, 3, 7, 14, 21];
function futureDate(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

// ── Load the 105 booked restaurants from the Desktop OT file ──
const OT_FILE = path.join('/Users/mauricedweck/Desktop', 'ot_avail_3window.json');
const OUTPUT_FILE = path.join(__dirname, 'ot_future_booked_results.json');

let otData = {};
try {
  otData = JSON.parse(fs.readFileSync(OT_FILE, 'utf8'));
  console.log(`✅ Loaded OT data: ${Object.keys(otData).length} restaurants`);
} catch (e) {
  console.error('❌ Cannot load ot_avail_3window.json from Desktop');
  process.exit(1);
}

// Get only the fully booked ones
const bookedList = Object.entries(otData)
  .filter(([_, v]) => v.tier === 'booked')
  .map(([name]) => name);

console.log(`🔴 Found ${bookedList.length} fully booked restaurants to check future dates`);
console.log(`📅 Will check: ${OFFSETS.map(o => `+${o}d (${futureDate(o)})`).join(', ')}\n`);

// Load existing results (for incremental)
let existing = {};
try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}

// ── Puppeteer ──
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
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

async function checkDate(page, name, date, partySize) {
  const cleanName = name.replace(/\(.*\)/g, '').replace(/[^\w\s'-]/g, '').replace(/\s+/g, ' ').trim();
  const url = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName)}&dateTime=${date}T19%3A30%3A00&covers=${partySize}&metroId=8`;

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });

    const cards = await page.evaluate(() => {
      const results = [];
      const cardEls = document.querySelectorAll('[data-test="pinned-restaurant-card"],[data-test="restaurant-card"]');
      for (const card of Array.from(cardEls).slice(0, 5)) {
        const nameEl = card.querySelector('a[data-test="res-card-name"]');
        const n = nameEl ? nameEl.textContent.trim() : '';
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
        results.push({ name: n, slots, noAvail, notOnOT });
      }
      return results;
    });

    if (cards.length === 0) return { slots: 0, error: 'no_cards' };

    // Find best match
    let bestCard = null, bestScore = 0;
    for (const card of cards) {
      const score = matchScore(name, card.name);
      if (score > bestScore) { bestScore = score; bestCard = card; }
    }

    if (!bestCard || bestScore < 0.7) return { slots: 0, error: 'no_match', score: bestScore };
    if (bestCard.notOnOT) return { slots: 0, not_on_ot: true };

    return {
      slots: bestCard.slots.length,
      times: bestCard.slots.slice(0, 5),
      matched: bestCard.name,
    };
  } catch (e) {
    return { slots: 0, error: e.message?.slice(0, 50) };
  }
}

// ── Main ──
async function main() {
  let toCheck = [...bookedList];
  if (QUICK_MODE) toCheck = toCheck.slice(0, 5);

  // Skip already checked
  const alreadyChecked = new Set(Object.keys(existing));
  const skipped = toCheck.filter(n => alreadyChecked.has(n));
  toCheck = toCheck.filter(n => !alreadyChecked.has(n));
  if (skipped.length > 0) console.log(`⏭️  Skipping ${skipped.length} already checked`);

  console.log(`🔍 Checking ${toCheck.length} restaurants across ${OFFSETS.length} future dates\n`);

  let browser = await launchBrowser();
  let page = await setupPage(browser);
  let sessionCount = 0;
  let consecutiveErrors = 0;

  const results = { ...existing };
  let totalChecked = 0;
  let opensUp = 0, fullyLocked = 0;

  for (const name of toCheck) {
    // Restart browser periodically
    if (sessionCount >= BROWSER_RESTART_EVERY) {
      console.log(`\n  🔄 Rotating VPN + restarting browser...\n`);
      await browser.close();
      await rotateVPN();
      await sleep(20000);
      browser = await launchBrowser();
      page = await setupPage(browser);
      sessionCount = 0;
    }

    const entry = {
      name,
      checked_date: new Date().toISOString(),
      future: {},
      opens_in: null,
      fully_locked: true,
    };

    for (const offset of OFFSETS) {
      const date = futureDate(offset);
      const result = await checkDate(page, name, date, PARTY_SIZE);
      sessionCount++;

      entry.future[`+${offset}d`] = {
        date,
        slots: result.slots,
        times: result.times || [],
        error: result.error || null,
      };

      if (result.slots > 0 && !entry.opens_in) {
        entry.opens_in = offset;
        entry.fully_locked = false;
      }

      await sleep(randomDelay());

      // If already found availability, still check remaining dates for full picture
    }

    results[name] = entry;
    totalChecked++;

    if (entry.fully_locked) {
      fullyLocked++;
      consecutiveErrors = 0;
      console.log(`  🔒 [${totalChecked}/${toCheck.length}] ${name}: locked through +${OFFSETS[OFFSETS.length-1]}d`);
    } else {
      opensUp++;
      consecutiveErrors = 0;
      const futureDetail = OFFSETS.map(o => {
        const f = entry.future[`+${o}d`];
        return `+${o}d: ${f.slots > 0 ? `${f.slots} slots` : '❌'}`;
      }).join(' | ');
      console.log(`  🟢 [${totalChecked}/${toCheck.length}] ${name}: opens +${entry.opens_in}d (${futureDetail})`);
    }

    // Check for consecutive no_cards errors (might be blocked)
    const lastFuture = Object.values(entry.future);
    if (lastFuture.every(f => f.error === 'no_cards')) {
      consecutiveErrors++;
      if (consecutiveErrors >= 5) {
        console.log(`\n  ⚠️  ${consecutiveErrors} consecutive no_cards — rotating VPN...\n`);
        await browser.close();
        await rotateVPN();
        await sleep(20000);
        browser = await launchBrowser();
        page = await setupPage(browser);
        sessionCount = 0;
        consecutiveErrors = 0;
      }
    } else {
      consecutiveErrors = 0;
    }

    // Save incrementally every 5
    if (totalChecked % 5 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    }
  }

  await browser.close();
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Done! Checked ${totalChecked} booked restaurants`);
  console.log(`   🟢 Opens up: ${opensUp}  🔒 Fully locked: ${fullyLocked}`);
  console.log(`   📅 Dates checked: ${OFFSETS.map(o => `+${o}d (${futureDate(o)})`).join(', ')}`);
  console.log(`   Output: ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
