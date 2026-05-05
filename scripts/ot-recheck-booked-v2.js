/**
 * ot-recheck-booked-v2.js
 *
 * Rechecks restaurants that were marked "booked" — likely blocked by OT.
 * Uses search page method with aggressive VPN rotation.
 * Saves to separate file, does NOT touch any existing data.
 *
 * RUN:   node scripts/ot-recheck-booked-v2.js
 * OUTPUT: netlify/functions/ot_recheck_results.json
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { execSync } = require('child_process');

const FUNCTIONS_DIR = path.join(__dirname, '..', 'netlify', 'functions');
const RECHECK_LIST = '/tmp/ot_booked_recheck.json';
const OUTPUT_FILE = path.join(FUNCTIONS_DIR, 'ot_recheck_results.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function randomDelay() { return 8000 + Math.floor(Math.random() * 7000); } // 8-15s

// ── CLI args ──
const args = process.argv.slice(2);
const DEBUG = args.includes('--debug');
const BATCH_LIMIT = parseInt((args.indexOf('--batch') !== -1 ? args[args.indexOf('--batch') + 1] : '0'), 10);

// Tomorrow's date
let CHECK_DATE = null;
const dateIdx = args.indexOf('--date');
if (dateIdx !== -1 && args[dateIdx + 1]) CHECK_DATE = args[dateIdx + 1];
if (!CHECK_DATE) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  CHECK_DATE = tomorrow.toISOString().split('T')[0];
}
const PARTY_SIZE = 2;

// ── NordVPN rotation ──
const VPN_REGIONS = ['us', 'us', 'us', 'us', 'ca'];
async function rotateVPN() {
  const region = VPN_REGIONS[Math.floor(Math.random() * VPN_REGIONS.length)];
  try {
    execSync('open -g "nordvpn://disconnect"', { timeout: 5000 });
    await sleep(5000);
    execSync(`open -g "nordvpn://connect/${region}"`, { timeout: 5000 });
    await sleep(15000);
    const ip = execSync('curl -s --max-time 5 https://api.ipify.org', { timeout: 10000 }).toString().trim();
    if (ip && ip.length > 6) {
      console.log(`  🔄 VPN → ${region} (${ip})`);
      return true;
    }
    // Retry
    execSync('open -g "nordvpn://disconnect"', { timeout: 5000 });
    await sleep(5000);
    execSync('open -g "nordvpn://connect"', { timeout: 5000 });
    await sleep(15000);
    const ip2 = execSync('curl -s --max-time 5 https://api.ipify.org', { timeout: 10000 }).toString().trim();
    console.log(`  🔄 VPN fallback (${ip2})`);
    return true;
  } catch (e) {
    console.log(`  ⚠️ VPN failed: ${e.message?.slice(0, 40)}`);
    return false;
  }
}

// ── Browser setup ──
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
];
const VIEWPORTS = [
  { width: 1280, height: 800 }, { width: 1366, height: 768 },
  { width: 1440, height: 900 }, { width: 1536, height: 864 },
];

async function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage']
  });
}

async function setupPage(browser) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){}, app: {} };
    Object.defineProperty(navigator, 'plugins', {
      get: () => { const p = [{name:'Chrome PDF Plugin'},{name:'Chrome PDF Viewer'},{name:'Native Client'}]; p.length=3; return p; }
    });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    const oq = window.navigator.permissions.query;
    window.navigator.permissions.query = (p) => p.name === 'notifications' ? Promise.resolve({state:Notification.permission}) : oq(p);
  });
  await page.setUserAgent(USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]);
  const vp = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
  await page.setViewport({ ...vp, deviceScaleFactor: 2 });
  return page;
}

// ── Name matching ──
function matchScore(search, found) {
  const c = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const sc = c(search), fc = c(found);
  if (sc === fc) return 1.0;
  if (fc.includes(sc) || sc.includes(fc)) return 0.9;
  const stop = ['the','and','restaurant','bar','grill','cafe','kitchen','nyc','new','york'];
  const sw = sc.split(' ').filter(w => w.length > 2 && !stop.includes(w));
  const fw = fc.split(' ').filter(w => w.length > 2 && !stop.includes(w));
  if (sw.length === 0) return 0;
  return sw.filter(w => fw.some(f => f.includes(w) || w.includes(f))).length / sw.length;
}

// ── Check one restaurant via OT search page ──
async function checkRestaurant(page, name) {
  const cleanName = name.replace(/\(.*\)/g, '').replace(/[^\w\s'-]/g, '').replace(/\s+/g, ' ').trim();
  const url = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName)}&dateTime=${CHECK_DATE}T19%3A30%3A00&covers=${PARTY_SIZE}&metroId=8`;

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Check for Access Denied / blocked page
    const pageTitle = await page.title();
    const isBlocked = pageTitle.toLowerCase().includes('access denied') ||
                      pageTitle.toLowerCase().includes('blocked') ||
                      pageTitle.toLowerCase().includes('error');
    if (isBlocked) {
      return { tier: 'unknown', error: 'access_denied' };
    }

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
        const noAvail = cardText.includes('no online availability') || cardText.includes('No tables') || cardText.includes('fully booked');
        const notOnOT = cardText.includes('not on the OpenTable reservation network');
        results.push({ name: n, rid, slots, noAvail, notOnOT });
      }
      return results;
    });

    if (cards.length === 0) {
      // Could be blocked or genuinely no results — check page content
      const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '');
      if (bodyText.includes('Access Denied') || bodyText.includes('blocked') || bodyText.length < 100) {
        return { tier: 'unknown', error: 'blocked_empty' };
      }
      return { tier: 'unknown', error: 'no_cards' };
    }

    let bestCard = null, bestScore = 0;
    for (const card of cards) {
      const score = matchScore(name, card.name);
      if (score > bestScore) { bestScore = score; bestCard = card; }
    }

    if (!bestCard || bestScore < 0.6) {
      return { tier: 'unknown', error: 'no_match', match_score: bestScore };
    }

    if (bestCard.notOnOT) {
      return { tier: 'not_on_ot', matched_name: bestCard.name, rid: bestCard.rid ? parseInt(bestCard.rid) : undefined };
    }

    // Parse slots
    let early = 0, prime = 0, late = 0;
    const parsedTimes = [];
    for (const timeStr of bestCard.slots) {
      const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!m) continue;
      let h = parseInt(m[1]);
      const min = parseInt(m[2]);
      if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
      if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
      const hour = h + min / 60;
      parsedTimes.push(timeStr.trim());
      if (hour >= 17.0 && hour < 18.5) early++;
      else if (hour >= 18.5 && hour < 20.5) prime++;
      else if (hour >= 20.5 && hour < 24.0) late++;
    }

    const total = parsedTimes.length;
    const tier = total === 0 ? (bestCard.noAvail ? 'booked' : 'booked') : total <= 3 ? 'limited' : 'open';

    return {
      tier,
      dinner_slots: total,
      early: tier === 'open' ? 'available' : (early > 0 ? 'limited' : 'booked'),
      prime: tier === 'open' ? 'available' : (prime > 0 ? 'limited' : 'booked'),
      late: tier === 'open' ? 'available' : (late > 0 ? 'limited' : 'booked'),
      has_early: early > 0 || tier === 'open',
      has_prime: prime > 0 || tier === 'open',
      has_late: late > 0 || tier === 'open',
      sample_times: parsedTimes.slice(0, 5),
      platform: 'opentable',
      checked_date: new Date().toISOString(),
      check_date_target: CHECK_DATE,
      rid: bestCard.rid ? parseInt(bestCard.rid) : undefined,
      matched_name: bestCard.name,
    };
  } catch (e) {
    return { tier: 'unknown', error: e.message?.slice(0, 80) };
  }
}

// ── Main ──
async function main() {
  let names = JSON.parse(fs.readFileSync(RECHECK_LIST, 'utf8'));
  if (BATCH_LIMIT > 0) names = names.slice(0, BATCH_LIMIT);

  console.log(`\n🔄 Rechecking ${names.length} booked restaurants — ${CHECK_DATE}`);
  console.log(`   VPN rotate every 10 | Delay 8-15s\n`);

  // Load existing results (for incremental)
  let results = {};
  try { results = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}

  await rotateVPN();
  let browser = await launchBrowser();
  let page = await setupPage(browser);
  let sessionCount = 0;
  let consecutiveBlocks = 0;
  let checked = 0, open = 0, limited = 0, booked = 0, unknown = 0;

  for (const name of names) {
    // Skip if already rechecked successfully
    const prev = results[name];
    if (prev && prev.tier !== 'unknown') {
      checked++;
      continue;
    }

    // Rotate every 10
    if (sessionCount >= 10) {
      console.log(`\n  🔄 Rotating VPN + browser...\n`);
      await browser.close();
      await rotateVPN();
      await sleep(15000);
      browser = await launchBrowser();
      page = await setupPage(browser);
      sessionCount = 0;
    }

    const result = await checkRestaurant(page, name);

    // If blocked, retry after rotation
    if (result.tier === 'unknown' && (result.error === 'access_denied' || result.error === 'blocked_empty')) {
      consecutiveBlocks++;
      if (consecutiveBlocks >= 3) {
        console.log(`  ⚠️ ${consecutiveBlocks} blocks in a row — emergency rotate`);
        await browser.close();
        await rotateVPN();
        await sleep(20000);
        browser = await launchBrowser();
        page = await setupPage(browser);
        sessionCount = 0;
        consecutiveBlocks = 0;

        // Retry this one
        const retry = await checkRestaurant(page, name);
        if (retry.tier !== 'unknown') {
          results[name] = retry;
          consecutiveBlocks = 0;
        } else {
          results[name] = retry;
        }
      } else {
        results[name] = result;
      }
    } else {
      results[name] = result;
      consecutiveBlocks = 0;
    }

    checked++;
    sessionCount++;
    const r = results[name];
    if (r.tier === 'open') open++;
    else if (r.tier === 'limited') limited++;
    else if (r.tier === 'booked') booked++;
    else unknown++;

    const icon = r.tier === 'open' ? '🟢' : r.tier === 'limited' ? '🟡' : r.tier === 'booked' ? '🔴' : '❓';
    const times = r.sample_times?.length > 0 ? ` → ${r.sample_times.join(', ')}` : '';
    const err = r.error ? ` [${r.error}]` : '';
    console.log(`  ${icon} [${checked}/${names.length}] ${name}: ${r.tier} (${r.dinner_slots || 0} slots)${times}${err}`);

    // Save after every restaurant
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

    await sleep(randomDelay());
  }

  await browser.close();
  try { execSync('open -g "nordvpn://disconnect"', { timeout: 5000 }); } catch {}

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Done! Rechecked ${checked}`);
  console.log(`   🟢 Open: ${open}  🟡 Limited: ${limited}  🔴 Booked: ${booked}  ❓ Unknown: ${unknown}`);
  console.log(`   📁 ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
