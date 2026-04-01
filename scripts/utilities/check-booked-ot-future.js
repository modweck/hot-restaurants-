#!/usr/bin/env node
/**
 * CHECK FULLY BOOKED OT RESTAURANTS — FUTURE AVAILABILITY
 * ========================================================
 * For OT restaurants showing as "booked" tonight,
 * checks +3, +5, +7, +14 days to see when they open up.
 *
 * Uses Puppeteer search (same approach as ot-tonight-check.js)
 *
 * Usage: node scripts/utilities/check-booked-ot-future.js
 *        node scripts/utilities/check-booked-ot-future.js --quick  (test 10)
 * Output: data/booked_ot_future_availability.json
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const MASTER_PATH = path.join(__dirname, '../../netlify/functions/BOOKING_MASTER.json');
const AVAIL_PATH = path.join(__dirname, '../../netlify/functions/tonight_availability.json');
const OT_AVAIL_PATH = path.join(__dirname, '../../netlify/functions/tonight_availability_ot.json');
const OUTPUT_PATH = path.join(__dirname, '../../data/booked_ot_future_availability.json');

const QUICK = process.argv.includes('--quick');
const PARTY_SIZE = 2;
const TODAY = new Date();
const OFFSETS = [3, 5, 7, 14];
const BROWSER_RESTART_EVERY = 75;

const sleep = ms => new Promise(r => setTimeout(r, ms));
function randomDelay() { return 3000 + Math.floor(Math.random() * 5000); }

function futureDate(offset) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
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

async function checkDateAvailability(page, name, date) {
  const cleanName = name.replace(/\(.*\)/g, '').replace(/[^\w\s'-]/g, '').replace(/\s+/g, ' ').trim();
  const url = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName)}&dateTime=${date}T20%3A00%3A00&covers=${PARTY_SIZE}&metroId=8`;

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });

    const cards = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-test="pinned-restaurant-card"],[data-test="restaurant-card"]'))
        .slice(0, 5)
        .map(card => {
          const n = card.querySelector('a[data-test="res-card-name"]')?.textContent?.trim() || '';
          const slots = Array.from(card.querySelectorAll('li[data-test^="time-slot"]'))
            .map(s => { const m = s.textContent.match(/(\d{1,2}:\d{2}\s*[AP]M)/i); return m ? m[1] : null; })
            .filter(Boolean);
          const cardText = card.innerText;
          const notOnOT = cardText.includes('not on the OpenTable reservation network');
          return { name: n, slots, notOnOT };
        });
    });

    let bestCard = null, bestScore = 0;
    for (const card of cards) {
      const score = matchScore(name, card.name);
      if (score > bestScore) { bestScore = score; bestCard = card; }
    }

    if (!bestCard || bestScore < 0.5 || bestCard.notOnOT) {
      return { date, available: false, slots: 0 };
    }

    // Parse slots into time windows
    let early = 0, prime = 0, late = 0;
    for (const timeStr of bestCard.slots) {
      const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!m) continue;
      let h = parseInt(m[1]);
      const min = parseInt(m[2]);
      if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
      if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
      const hour = h + min / 60;
      if (hour >= 17.0 && hour < 18.5) early++;
      else if (hour >= 18.5 && hour < 20.5) prime++;
      else if (hour >= 20.5 && hour < 24.0) late++;
    }

    return {
      date,
      available: bestCard.slots.length >= 2,
      slots: bestCard.slots.length,
      early, prime, late,
      earliest: bestCard.slots[0],
      latest: bestCard.slots[bestCard.slots.length - 1],
    };
  } catch (e) {
    return { date, available: false, slots: 0, error: e.message };
  }
}

async function main() {
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'));
  const masterLower = {};
  for (const [k, v] of Object.entries(master)) masterLower[k.toLowerCase()] = v;

  // Get booked OT restaurants from both availability files
  let avail = {};
  try { avail = JSON.parse(fs.readFileSync(AVAIL_PATH, 'utf8')); } catch {}
  let otAvail = {};
  try { otAvail = JSON.parse(fs.readFileSync(OT_AVAIL_PATH, 'utf8')); } catch {}

  const allAvail = { ...avail, ...otAvail };

  const booked = [];
  for (const [name, data] of Object.entries(allAvail)) {
    if (data.tier !== 'booked') continue;
    const entry = masterLower[name.toLowerCase()];
    if (!entry || entry.platform !== 'opentable') continue;
    booked.push({ name });
  }

  if (QUICK) booked.splice(10);

  console.log(`\n🔍 OT FUTURE AVAILABILITY SCANNER`);
  console.log(`${'='.repeat(60)}`);
  console.log(`📊 Booked OT restaurants: ${booked.length}`);
  console.log(`📊 Checking dates: ${OFFSETS.map(o => '+' + o + 'd (' + futureDate(o) + ')').join(', ')}`);
  console.log(`📊 Party size: ${PARTY_SIZE}\n`);

  let browser = await launchBrowser();
  let page = await setupPage(browser);
  let sessionCount = 0;

  const results = {};
  let checked = 0, hasAvail = 0, fullyLocked = 0;

  for (const restaurant of booked) {
    if (sessionCount >= BROWSER_RESTART_EVERY) {
      await browser.close();
      await sleep(5000);
      browser = await launchBrowser();
      page = await setupPage(browser);
      sessionCount = 0;
    }

    try {
      const dates = {};
      let anyAvailable = false;

      for (const offset of OFFSETS) {
        const date = futureDate(offset);
        const result = await checkDateAvailability(page, restaurant.name, date);
        dates[`+${offset}`] = result;
        if (result.available) anyAvailable = true;
        sessionCount++;
        await sleep(randomDelay());
      }

      results[restaurant.name] = { dates, hasAnyAvailability: anyAvailable };
      checked++;

      if (anyAvailable) {
        hasAvail++;
        const firstOpen = OFFSETS.find(o => dates[`+${o}`].available);
        console.log(`  🟢 [${checked}/${booked.length}] ${restaurant.name} — opens in +${firstOpen}d (${dates[`+${firstOpen}`].slots} slots)`);
      } else {
        fullyLocked++;
        console.log(`  🔒 [${checked}/${booked.length}] ${restaurant.name} — locked all dates`);
      }
    } catch (e) {
      checked++;
      fullyLocked++;
      console.log(`  ⚠️ [${checked}/${booked.length}] ${restaurant.name} — error: ${e.message.substring(0, 50)}`);
    }

    if (checked % 10 === 0) {
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ results, stats: { checked, hasAvail, fullyLocked } }, null, 2));
    }
  }

  await browser.close();
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ results, stats: { checked, hasAvail, fullyLocked } }, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Done! Checked ${checked} booked OT restaurants`);
  console.log(`   🟢 Has future availability: ${hasAvail}`);
  console.log(`   🔒 Fully locked: ${fullyLocked}`);
  console.log(`   Output: ${OUTPUT_PATH}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
