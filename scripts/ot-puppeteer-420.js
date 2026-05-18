/**
 * ot-puppeteer-420.js
 *
 * Searches OpenTable for 420+ restaurants currently on website/google_reserve
 * that mention "opentable" on their site. Finds RIDs and checks availability.
 *
 * NO VPN rotation — just long pauses between batches.
 *
 * RUN:   node scripts/ot-puppeteer-420.js
 * OPTIONS:
 *   --quick       First 10 only
 *   --batch N     Check N then stop
 *   --resume      Skip already checked
 *   --start N     Start from index N
 *
 * OUTPUT: data/ot_puppeteer_420_results.json
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const PLACES_FILE = path.join(__dirname, 'ot-mention-420-placeids.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'ot_puppeteer_420_results.json');

const args = process.argv.slice(2);
function getArg(name, def) { const i = args.indexOf(`--${name}`); return i !== -1 && args[i+1] ? args[i+1] : def; }
const QUICK = args.includes('--quick');
const RESUME = args.includes('--resume');
const BATCH = parseInt(getArg('batch', '0'), 10);
const START = parseInt(getArg('start', '0'), 10);
const BROWSER_RESTART_EVERY = 15;
const PARTY_SIZE = 2;

const sleep = ms => new Promise(r => setTimeout(r, ms));
function randomDelay() { return 8000 + Math.floor(Math.random() * 7000); } // 8-15s

// Tomorrow's date
const d = new Date(); d.setDate(d.getDate() + 1);
const CHECK_DATE = d.toISOString().split('T')[0];

const places = JSON.parse(fs.readFileSync(PLACES_FILE, 'utf8'));
let existing = {};
try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
];

async function launchBrowser() {
  return puppeteer.launch({
    headless: false,
    userDataDir: '/tmp/ot-chrome-profile',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--window-size=1280,800']
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

async function searchOT(page, name) {
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
        for (const s of slotEls) {
          const text = s.textContent.trim();
          const match = text.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
          if (match) slots.push(match[1]);
        }
        const cardText = card.innerText;
        const notOnOT = cardText.includes('not on the OpenTable reservation network');
        results.push({ name: n, rid, slots, notOnOT });
      }
      return results;
    });

    if (cards.length === 0) return { found: false, error: 'no_cards' };

    let bestCard = null, bestScore = 0;
    for (const card of cards) {
      const score = matchScore(name, card.name);
      if (score > bestScore) { bestScore = score; bestCard = card; }
    }

    if (!bestCard || bestScore < 0.7) return { found: false, error: 'no_match', score: bestScore };
    if (bestCard.notOnOT) return { found: false, error: 'not_on_ot' };

    return {
      found: true,
      rid: bestCard.rid ? parseInt(bestCard.rid) : null,
      matched_name: bestCard.name,
      score: bestScore,
      slots: bestCard.slots.length,
      times: bestCard.slots.slice(0, 5),
      bookable: bestCard.slots.length > 0,
    };
  } catch (e) {
    return { found: false, error: e.message?.slice(0, 50) };
  }
}

async function main() {
  let list = places.map(p => p.name);
  if (START > 0) list = list.slice(START);
  if (RESUME) {
    const doneSet = new Set(Object.keys(existing).map(k => k.toLowerCase()));
    list = list.filter(n => !doneSet.has(n.toLowerCase()));
    console.log(`⏭️  Resuming: ${list.length} remaining (${Object.keys(existing).length} already done)`);
  }
  if (QUICK) list = list.slice(0, 10);
  if (BATCH > 0) list = list.slice(0, BATCH);

  console.log(`\n🔍 Searching OT for ${list.length} restaurants`);
  console.log(`📅 Date: ${CHECK_DATE} | Party: ${PARTY_SIZE}`);
  console.log(`🔄 Browser restart every ${BROWSER_RESTART_EVERY} | Delay 8-15s`);
  console.log(`⏸️  90s pause on browser restart (no VPN)\n`);

  let browser = await launchBrowser();
  let page = await setupPage(browser);
  let sessionCount = 0;
  let consecutiveErrors = 0;

  const results = { ...existing };
  let checked = 0, found = 0, notFound = 0, errors = 0;

  for (const name of list) {
    // Restart browser every N
    if (sessionCount >= BROWSER_RESTART_EVERY) {
      console.log(`\n  🔄 Restarting browser... pausing 90s\n`);
      await browser.close();
      await sleep(90000);
      browser = await launchBrowser();
      page = await setupPage(browser);
      sessionCount = 0;
    }

    const result = await searchOT(page, name);
    checked++;
    sessionCount++;

    if (result.found && result.rid) {
      results[name] = {
        rid: result.rid,
        matched_name: result.matched_name,
        score: result.score,
        slots: result.slots,
        times: result.times,
        bookable: result.bookable,
      };
      found++;
      consecutiveErrors = 0;
      const icon = result.bookable ? '🟢' : '🔴';
      console.log(`  ${icon} [${checked}/${list.length}] ${name} → ${result.matched_name} (rid:${result.rid}, ${result.slots} slots)`);
    } else if (result.error === 'no_cards') {
      errors++;
      consecutiveErrors++;
      console.log(`  ❓ [${checked}/${list.length}] ${name}: no cards (might be blocked)`);

      if (consecutiveErrors >= 8) {
        console.log(`\n  ⚠️  ${consecutiveErrors} consecutive errors — pausing 3 min\n`);
        await browser.close();
        await sleep(180000);
        browser = await launchBrowser();
        page = await setupPage(browser);
        sessionCount = 0;
        consecutiveErrors = 0;
      }
    } else {
      notFound++;
      consecutiveErrors = 0;
    }

    // Save every 10
    if (checked % 10 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
      console.log(`  💾 ${found} found / ${checked} checked`);
    }

    await sleep(randomDelay());
  }

  await browser.close();
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Done! Checked ${checked} restaurants`);
  console.log(`   🟢 Found on OT: ${found}`);
  console.log(`   ❌ Not found: ${notFound}`);
  console.log(`   ⚠️  Errors: ${errors}`);
  console.log(`   Output: ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
