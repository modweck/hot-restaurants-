/**
 * ot-half1-final.js — OT availability check (half 1 of 2)
 * Writes to temp file, merges into tonight_availability_ot.json, regenerates slim.
 * Independent of Resy/Tock — pushes OT data immediately.
 *
 * RUN: node netlify/functions/ot-half1-final.js [--all] [--date 2026-04-01]
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
const CHECK_ALL = args.includes('--all');
const DEBUG = args.includes('--debug');
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

let CHECK_DATE = getArg('date', null);
if (!CHECK_DATE) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  CHECK_DATE = tomorrow.toISOString().split('T')[0];
}
const TODAY = new Date().toISOString().split('T')[0];
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);
const BROWSER_RESTART_EVERY = 75;

const MASTER_FILE = path.join(__dirname, 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, 'tonight_availability_ot.json');
const TEMP_FILE = path.join(__dirname, 'tonight_availability_ot_half1.json');
const SLIM_FILE = path.join(__dirname, 'tonight_availability_slim.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function randomDelay() { return 3000 + Math.floor(Math.random() * 5000); }

// ── Load data ──
const BOOKING_MASTER = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
console.log(`✅ Loaded BOOKING_MASTER: ${Object.keys(BOOKING_MASTER).length} restaurants`);

const ALL_OT = Object.entries(BOOKING_MASTER)
  .filter(([_, v]) => v.platform === 'opentable' && v.url)
  .map(([name, info]) => ({ name, booking_url: info.url }));

// Half 1: first half
const OT_RESTAURANTS = ALL_OT.slice(0, Math.ceil(ALL_OT.length / 2));
console.log(`🍽️  Half 1: ${OT_RESTAURANTS.length} / ${ALL_OT.length} OpenTable restaurants`);

let existing = {};
try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}

// ── Puppeteer ──
const VIEWPORTS = [
  { width: 1280, height: 800 }, { width: 1366, height: 768 },
  { width: 1440, height: 900 }, { width: 1536, height: 864 }, { width: 1920, height: 1080 },
];

async function launchBrowser() {
  return puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1280,800'] });
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
  await page.setViewport(VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)]);
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
        for (const s of slotEls) { const m = s.textContent.trim().match(/(\d{1,2}:\d{2}\s*[AP]M)/i); if (m) slots.push(m[1]); }
        const cardText = card.innerText;
        const noAvail = cardText.includes('no online availability') || cardText.includes('No tables') || cardText.includes('fully booked');
        const notOnOT = cardText.includes('not on the OpenTable reservation network');
        results.push({ name: n, rid, slots, noAvail, notOnOT });
      }
      return results;
    });
    if (cards.length === 0) return { tier: 'unknown', dinner_slots: 0, early: 'booked', prime: 'booked', late: 'booked', sample_times: [], platform: 'opentable', checked_date: new Date().toISOString(), error: 'no_cards' };
    let bestCard = null, bestScore = 0;
    for (const card of cards) { const score = matchScore(name, card.name); if (score > bestScore) { bestScore = score; bestCard = card; } }
    const nameTooShort = name.replace(/[^a-zA-Z]/g, '').length <= 3;
    if (!bestCard || bestScore < 0.7 || (nameTooShort && bestScore < 1.0)) return { tier: 'unknown', dinner_slots: 0, early: 'booked', prime: 'booked', late: 'booked', sample_times: [], platform: 'opentable', checked_date: new Date().toISOString(), match_score: bestScore };
    if (bestCard.notOnOT) return { tier: 'not_on_ot', dinner_slots: 0, early: 'booked', prime: 'booked', late: 'booked', sample_times: [], platform: 'opentable', checked_date: new Date().toISOString(), rid: bestCard.rid ? parseInt(bestCard.rid) : undefined, matched_name: bestCard.name, match_score: bestScore };
    let early = 0, prime = 0, late = 0;
    const parsedTimes = [];
    for (const timeStr of bestCard.slots) {
      const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!m) continue;
      let h = parseInt(m[1]); const min = parseInt(m[2]); const ampm = m[3].toUpperCase();
      if (ampm === 'PM' && h !== 12) h += 12; if (ampm === 'AM' && h === 12) h = 0;
      const hour = h + min / 60;
      parsedTimes.push(timeStr.trim());
      if (hour >= 17.0 && hour < 18.5) early++;
      else if (hour >= 18.5 && hour < 20.5) prime++;
      else if (hour >= 20.5 && hour < 24.0) late++;
    }
    const total = parsedTimes.length;
    const tier = total === 0 ? 'booked' : total <= 3 ? 'limited' : 'open';
    let earlyStatus, primeStatus, lateStatus;
    if (tier === 'open') { earlyStatus = 'available'; primeStatus = 'available'; lateStatus = 'available'; }
    else if (tier === 'limited') { earlyStatus = early > 0 ? 'limited' : 'booked'; primeStatus = prime > 0 ? 'limited' : 'booked'; lateStatus = late > 0 ? 'limited' : 'booked'; }
    else { earlyStatus = 'booked'; primeStatus = 'booked'; lateStatus = 'booked'; }
    return { tier, dinner_slots: total, early: earlyStatus, prime: primeStatus, late: lateStatus, has_early: earlyStatus !== 'booked', has_prime: primeStatus !== 'booked', has_late: lateStatus !== 'booked', sample_times: parsedTimes.slice(0, 5), platform: 'opentable', checked_date: new Date().toISOString(), rid: bestCard.rid ? parseInt(bestCard.rid) : undefined, matched_name: bestCard.name, match_score: bestScore };
  } catch (e) {
    if (DEBUG) console.error(`  ⚠️ ${name}: ${e.message}`);
    return { tier: 'unknown', dinner_slots: 0, early: 'booked', prime: 'booked', late: 'booked', sample_times: [], platform: 'opentable', checked_date: new Date().toISOString(), error: e.message };
  }
}

// ── Main ──
async function main() {
  let toCheck = OT_RESTAURANTS;
  if (!CHECK_ALL) {
    toCheck = toCheck.filter(r => {
      const prev = existing[r.name.toLowerCase()];
      if (!prev?.checked_date) return true;
      return prev.checked_date.split('T')[0] !== TODAY;
    });
    console.log(`⏭️  Skipping ${OT_RESTAURANTS.length - toCheck.length} already checked today`);
  }

  console.log(`\n🔍 Half 1: Checking ${toCheck.length} restaurants for ${CHECK_DATE}, party of ${PARTY_SIZE}`);
  console.log(`   Browser restart every ${BROWSER_RESTART_EVERY} | Random delay 3-8s\n`);

  let browser = await launchBrowser();
  let page = await setupPage(browser);
  let sessionCount = 0;
  const results = { ...existing };
  let checked = 0, open = 0, limited = 0, booked = 0, unknown = 0;

  for (const restaurant of toCheck) {
    if (sessionCount >= BROWSER_RESTART_EVERY) {
      console.log(`\n  🔄 Restarting browser...\n`);
      await browser.close(); await sleep(5000);
      browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
    }
    const key = restaurant.name.toLowerCase();
    let result = await checkRestaurant(page, restaurant.name);
    if (result.tier === 'unknown') { await sleep(5000); result = await checkRestaurant(page, restaurant.name); sessionCount++; }
    results[key] = result;
    checked++; sessionCount++;
    if (result.tier === 'open') { open++; result.has_early = true; result.has_prime = true; result.has_late = true; results[key] = result; }
    else if (result.tier === 'limited') limited++;
    else if (result.tier === 'booked') booked++;
    else unknown++;
    const icon = result.tier === 'open' ? '🟢' : result.tier === 'limited' ? '🟡' : result.tier === 'booked' ? '🔴' : result.tier === 'not_on_ot' ? '🚫' : '❓';
    const times = result.sample_times?.length > 0 ? ` → ${result.sample_times.join(', ')}` : '';
    console.log(`  ${icon} [${checked}/${toCheck.length}] ${restaurant.name}: ${result.tier} (${result.dinner_slots} slots)${times}`);
    if (checked % 25 === 0) fs.writeFileSync(TEMP_FILE, JSON.stringify(results, null, 2));
    await sleep(randomDelay());
  }

  // ── Phase 2: Future availability for booked ──
  const stillBooked = Object.entries(results).filter(([_, v]) => v.tier === 'booked').map(([k]) => k);
  if (stillBooked.length > 0) {
    const OFFSETS = [3, 7, 14];
    function futureDate(offset) { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().split('T')[0]; }
    console.log(`\n🔮 Phase 2: Future availability for ${stillBooked.length} booked\n`);
    let hasFuture = 0, locked = 0;
    for (let i = 0; i < stillBooked.length; i++) {
      if (sessionCount >= BROWSER_RESTART_EVERY) { await browser.close(); await sleep(5000); browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0; }
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
      if (opensIn) { results[name].opens_in = opensIn; hasFuture++; console.log(`  🟢 [${i+1}/${stillBooked.length}] ${name}: opens in +${opensIn}d`); }
      else { results[name].fully_locked = true; locked++; console.log(`  🔒 [${i+1}/${stillBooked.length}] ${name}: locked`); }
      if ((i+1) % 10 === 0) fs.writeFileSync(TEMP_FILE, JSON.stringify(results, null, 2));
      await sleep(randomDelay());
    }
    console.log(`\n   🟢 Has future: ${hasFuture}  🔒 Locked: ${locked}`);
  }

  await browser.close();

  // ── Save temp file ──
  fs.writeFileSync(TEMP_FILE, JSON.stringify(results, null, 2));

  // ── Merge into main OT file ──
  let mainOT = {};
  try { mainOT = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}
  for (const [k, v] of Object.entries(results)) { mainOT[k] = v; }
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(mainOT, null, 2));
  console.log(`\n📦 Merged into ${OUTPUT_FILE}`);

  // ── Regenerate slim file (OT data goes live immediately) ──
  try {
    require('./slim-availability.js');
  } catch {
    // If slim-availability doesn't work as require, run it inline
    const { execSync } = require('child_process');
    execSync('node ' + path.join(__dirname, 'slim-availability.js'), { stdio: 'inherit' });
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Half 1 Done! Checked ${checked} OpenTable restaurants`);
  console.log(`   🟢 Open: ${open}  🟡 Limited: ${limited}  🔴 Booked: ${booked}  ❓ Unknown: ${unknown}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
