/**
 * Re-checks only the "booked" OT restaurants to separate:
 * - genuinely booked (no availability)
 * - not on OT reservation network (has profile but can't book)
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const RECHECK_FILE = path.join(__dirname, '..', 'data', 'ot_booked_recheck.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'tonight_availability_ot.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function randomDelay() { return 3000 + Math.floor(Math.random() * 5000); }

const CHECK_DATE = '2026-03-26';
const PARTY_SIZE = 2;
const BROWSER_RESTART_EVERY = 75;

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
];

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

async function main() {
  const toCheck = JSON.parse(fs.readFileSync(RECHECK_FILE, 'utf8'));
  const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));

  console.log(`🔍 Re-checking ${toCheck.length} "booked" restaurants\n`);

  let browser = await launchBrowser();
  let page = await setupPage(browser);
  let sessionCount = 0;
  let checked = 0, realBooked = 0, notOnOT = 0, actuallyOpen = 0, limited = 0, unknown = 0;
  let consecutiveUnknowns = 0;

  for (const restaurant of toCheck) {
    if (sessionCount >= BROWSER_RESTART_EVERY) {
      await browser.close();
      await sleep(5000);
      browser = await launchBrowser();
      page = await setupPage(browser);
      sessionCount = 0;
      console.log(`\n  🔄 Browser restarted\n`);
    }

    const cleanName = restaurant.name.replace(/\(.*\)/g, '').replace(/[^\w\s'-]/g, '').replace(/\s+/g, ' ').trim();
    const url = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName)}&dateTime=${CHECK_DATE}T19%3A00%3A00&covers=${PARTY_SIZE}&metroId=8`;

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });

      const cardData = await page.evaluate(() => {
        const cards = document.querySelectorAll('[data-test="pinned-restaurant-card"],[data-test="restaurant-card"]');
        return Array.from(cards).slice(0, 5).map(card => {
          const n = card.querySelector('a[data-test="res-card-name"]')?.textContent?.trim() || '';
          const rid = card.getAttribute('data-rid') || '';
          const cardText = card.innerText;
          const slots = Array.from(card.querySelectorAll('li[data-test^="time-slot"]'))
            .map(s => { const m = s.textContent.match(/(\d{1,2}:\d{2}\s*[AP]M)/i); return m ? m[1] : null; })
            .filter(Boolean);
          const isNotOnOT = cardText.includes('not on the OpenTable reservation network');
          const isNoAvail = cardText.includes('no online availability') || cardText.includes('Find next available');
          return { name: n, rid, slots, isNotOnOT, isNoAvail };
        });
      });

      let bestCard = null, bestScore = 0;
      for (const card of cardData) {
        const score = matchScore(restaurant.name, card.name);
        if (score > bestScore) { bestScore = score; bestCard = card; }
      }

      const key = restaurant.name.toLowerCase();
      if (!bestCard || bestScore < 0.5) {
        existing[key].tier = 'unknown';
        unknown++;
        consecutiveUnknowns++;
      } else if (bestCard.isNotOnOT) {
        existing[key] = { ...existing[key], tier: 'not_on_ot', matched_name: bestCard.name, match_score: bestScore };
        notOnOT++;
        consecutiveUnknowns = 0;
      } else if (bestCard.slots.length > 0) {
        existing[key] = { ...existing[key], tier: bestCard.slots.length <= 3 ? 'limited' : 'open', dinner_slots: bestCard.slots.length, sample_times: bestCard.slots.slice(0, 5), matched_name: bestCard.name, match_score: bestScore };
        if (bestCard.slots.length <= 3) limited++; else actuallyOpen++;
        consecutiveUnknowns = 0;
      } else {
        existing[key] = { ...existing[key], tier: 'booked', matched_name: bestCard.name, match_score: bestScore };
        realBooked++;
        consecutiveUnknowns = 0;
      }

      checked++;
      sessionCount++;
      const tier = existing[key].tier;
      const icon = tier === 'open' ? '🟢' : tier === 'limited' ? '🟡' : tier === 'booked' ? '🔴' : tier === 'not_on_ot' ? '🚫' : '❓';
      console.log(`  ${icon} [${checked}/${toCheck.length}] ${restaurant.name}: ${tier}`);

      if (consecutiveUnknowns >= 15) {
        console.log(`\n  ⚠️  15 unknowns in a row — restarting browser\n`);
        await browser.close();
        await sleep(15000);
        browser = await launchBrowser();
        page = await setupPage(browser);
        sessionCount = 0;
        consecutiveUnknowns = 0;
      }

      if (checked % 25 === 0) fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));
    } catch (e) {
      unknown++;
      checked++;
      sessionCount++;
      console.log(`  ⚠️ [${checked}/${toCheck.length}] ${restaurant.name}: error`);
    }

    await sleep(randomDelay());
  }

  await browser.close();
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Re-check complete! ${checked} restaurants`);
  console.log(`   🟢 Actually open: ${actuallyOpen}`);
  console.log(`   🟡 Limited: ${limited}`);
  console.log(`   🔴 Confirmed booked: ${realBooked}`);
  console.log(`   🚫 Not on OT network: ${notOnOT}`);
  console.log(`   ❓ Unknown: ${unknown}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
