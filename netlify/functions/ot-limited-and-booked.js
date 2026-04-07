/**
 * ot-limited-and-booked.js — Recheck ONLY the OT restaurants that have
 * Access Denied / bad data (showing "limited" or "booked" with no real match).
 *
 * This is a targeted fix script — much faster than rechecking all 1,812.
 *
 * RUN:   node netlify/functions/ot-limited-and-booked.js
 *
 * OPTIONS:
 *   --date 2026-04-06   Check a specific date (default: today)
 *   --party 2           Party size (default: 2)
 *   --quick             Only check first 15 (for testing)
 *   --batch 200         Stop after N restaurants
 *   --debug             Verbose output
 *
 * OUTPUT: Updates tonight_availability_ot.json in place
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { execSync } = require('child_process');

// ── NordVPN IP rotation ──
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
        if (ip && ip.length > 6) { console.log(`    🔄 VPN rotated → ${region} (${ip})`); return true; }
      } catch {}
      console.log(`    ⚠️  VPN attempt ${attempt}/3 failed...`);
      execSync('open -g "nordvpn://disconnect"', { timeout: 5000 });
      await slp(3000);
    }
    execSync('open -g "nordvpn://connect"', { timeout: 5000 });
    await slp(10000);
    return true;
  } catch (e) {
    console.log(`    ⚠️  VPN rotation failed: ${e.message?.slice(0, 40)}`);
    return false;
  }
}

// ── CLI args ──
const args = process.argv.slice(2);
function getArg(name, def) { const i = args.indexOf(`--${name}`); return i !== -1 && args[i+1] ? args[i+1] : def; }
const QUICK = args.includes('--quick');
const DEBUG = args.includes('--debug');
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);
const BATCH_LIMIT = parseInt(getArg('batch', '0'), 10);
const BROWSER_RESTART_EVERY = 75;

let CHECK_DATE = getArg('date', null);
if (!CHECK_DATE) { CHECK_DATE = new Date().toISOString().split('T')[0]; }

const MASTER_FILE = path.join(__dirname, 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, 'tonight_availability_ot.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function randomDelay() { return 3000 + Math.floor(Math.random() * 5000); }

// ── Load data ──
const BOOKING_MASTER = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
let existing = {};
try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}

// ── Find bad entries: Access Denied or no matched_name showing as limited/booked ──
const toRecheck = [];
for (const [name, info] of Object.entries(BOOKING_MASTER)) {
  if (info.platform !== 'opentable' || !info.url) continue;
  const key = name.toLowerCase();
  const prev = existing[key];
  if (!prev) { toRecheck.push({ name, url: info.url }); continue; } // missing entirely
  const isBad = prev.matched_name === 'Access Denied' || !prev.matched_name ||
                prev.tier === 'error' || prev.error === 'access_denied' || prev.error === 'access_denied_unresolved';
  const isLimitedOrBooked = prev.tier === 'limited' || prev.tier === 'booked';
  if (isBad || (isLimitedOrBooked && !prev.matched_name)) {
    toRecheck.push({ name, url: info.url });
  }
}

// Extract slugs
for (const r of toRecheck) {
  const rMatch = r.url.match(/opentable\.com\/r\/([^?/]+)/);
  const plainMatch = r.url.match(/opentable\.com\/([^?/]+)$/);
  r.slug = rMatch ? rMatch[1] : (plainMatch ? plainMatch[1] : null);
}

console.log(`✅ Loaded ${Object.keys(BOOKING_MASTER).length} restaurants`);
console.log(`🔍 Found ${toRecheck.length} limited/booked with bad data to recheck`);
console.log(`   Checking for date: ${CHECK_DATE}, party of ${PARTY_SIZE}\n`);

// ── Puppeteer ──
const VIEWPORTS = [
  { width: 1280, height: 800 }, { width: 1366, height: 768 },
  { width: 1440, height: 900 }, { width: 1536, height: 864 },
];

async function launchBrowser() {
  return puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
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

// ── Check restaurant: search page + direct page fallback ──
async function checkRestaurant(page, name, slug) {
  const cleanName = name.replace(/\(.*\)/g, '').replace(/[^\w\s'-]/g, '').replace(/\s+/g, ' ').trim();
  const url = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName)}&dateTime=${CHECK_DATE}T19%3A30%3A00&covers=${PARTY_SIZE}&metroId=8`;

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });

    // Detect Access Denied
    const blocked = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return text.includes('Access Denied') || text.includes("don't have permission") || text.includes('403 Forbidden');
    });
    if (blocked) return { tier: 'error', error: 'access_denied' };

    const cards = await page.evaluate(() => {
      const results = [];
      for (const card of Array.from(document.querySelectorAll('[data-test="pinned-restaurant-card"],[data-test="restaurant-card"]')).slice(0, 5)) {
        const n = card.querySelector('a[data-test="res-card-name"]')?.textContent?.trim() || '';
        const rid = card.getAttribute('data-rid') || '';
        const slots = Array.from(card.querySelectorAll('li[data-test^="time-slot"]')).map(s => {
          const m = s.textContent.trim().match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
          return m ? m[1] : null;
        }).filter(Boolean);
        const cardText = card.innerText;
        const noAvail = cardText.includes('no online availability') || cardText.includes('No tables') || cardText.includes('fully booked');
        const notOnOT = cardText.includes('not on the OpenTable reservation network');
        results.push({ name: n, rid, slots, noAvail, notOnOT });
      }
      return results;
    });

    if (cards.length === 0) return { tier: 'error', error: 'no_cards' };

    let bestCard = null, bestScore = 0;
    for (const card of cards) { const s = matchScore(name, card.name); if (s > bestScore) { bestScore = s; bestCard = card; } }

    const nameTooShort = name.replace(/[^a-zA-Z]/g, '').length <= 3;
    if (!bestCard || bestScore < 0.7 || (nameTooShort && bestScore < 1.0)) return { tier: 'error', error: 'no_match', match_score: bestScore };
    if (bestCard.notOnOT) return { tier: 'not_on_ot', dinner_slots: 0, platform: 'opentable', checked_date: new Date().toISOString(), rid: bestCard.rid ? parseInt(bestCard.rid) : undefined, matched_name: bestCard.name };

    let early = 0, prime = 0, late = 0;
    const parsedTimes = [];
    for (const timeStr of bestCard.slots) {
      const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!m) continue;
      let h = parseInt(m[1]); const min = parseInt(m[2]);
      if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
      if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
      const hour = h + min / 60;
      parsedTimes.push(timeStr.trim());
      if (hour >= 17.0 && hour < 18.5) early++;
      else if (hour >= 18.5 && hour < 20.5) prime++;
      else if (hour >= 20.5 && hour < 24.0) late++;
    }

    let total = parsedTimes.length;

    // FALLBACK: search card shows 0 slots — try direct /r/ page
    if (total === 0 && slug && !bestCard.noAvail) {
      try {
        const directUrl = `https://www.opentable.com/r/${slug}?dateTime=${CHECK_DATE}T19%3A30%3A00&covers=${PARTY_SIZE}&lang=en-US`;
        await page.goto(directUrl, { waitUntil: 'networkidle2', timeout: 25000 });
        await sleep(2000);
        const directResult = await page.evaluate(() => {
          const text = document.body?.innerText || '';
          if (text.includes('Access Denied') || text.length < 300) return { blocked: true };
          const allTimes = text.match(/\d{1,2}:\d{2}\s*[AP]M/gi) || [];
          const dinnerTimes = [...new Set(allTimes)].filter(t => {
            const m = t.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
            if (!m) return false;
            let h = parseInt(m[1]);
            if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
            if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
            return h >= 17 && h < 24;
          });
          return { blocked: false, dinnerTimes };
        });
        if (!directResult.blocked && directResult.dinnerTimes.length > 0) {
          parsedTimes.length = 0; early = 0; prime = 0; late = 0;
          for (const timeStr of directResult.dinnerTimes) {
            const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
            if (!m) continue;
            let h = parseInt(m[1]); const min = parseInt(m[2]);
            if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
            if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
            const hour = h + min / 60;
            parsedTimes.push(timeStr.trim());
            if (hour >= 17.0 && hour < 18.5) early++;
            else if (hour >= 18.5 && hour < 20.5) prime++;
            else if (hour >= 20.5 && hour < 24.0) late++;
          }
          total = parsedTimes.length;
          process.stdout.write('(direct-fallback) ');
        }
      } catch {}
    }

    const tier = total === 0 ? 'booked' : total <= 3 ? 'limited' : 'open';
    let eS, pS, lS;
    if (tier === 'open') { eS = 'available'; pS = 'available'; lS = 'available'; }
    else if (tier === 'limited') { eS = early > 0 ? 'limited' : 'booked'; pS = prime > 0 ? 'limited' : 'booked'; lS = late > 0 ? 'limited' : 'booked'; }
    else { eS = 'booked'; pS = 'booked'; lS = 'booked'; }

    return {
      tier, dinner_slots: total, early: eS, prime: pS, late: lS,
      has_early: eS !== 'booked', has_prime: pS !== 'booked', has_late: lS !== 'booked',
      sample_times: parsedTimes.slice(0, 5), platform: 'opentable',
      checked_date: new Date().toISOString(),
      rid: bestCard.rid ? parseInt(bestCard.rid) : undefined,
      matched_name: bestCard.name, match_score: bestScore,
    };
  } catch (e) {
    return { tier: 'error', error: e.message?.slice(0, 80) };
  }
}

// ── Main ──
async function main() {
  let list = toRecheck;
  if (QUICK) list = list.slice(0, 15);
  if (BATCH_LIMIT > 0) list = list.slice(0, BATCH_LIMIT);

  console.log(`🚀 Rechecking ${list.length} restaurants...\n`);

  let browser = await launchBrowser();
  let page = await setupPage(browser);
  let sessionCount = 0;
  const results = { ...existing };
  let checked = 0, open = 0, limited = 0, booked = 0, blocked = 0, flipped = 0;
  let consecutiveBlocks = 0;

  for (const restaurant of list) {
    // Browser restart
    if (sessionCount >= BROWSER_RESTART_EVERY) {
      await browser.close(); await sleep(5000);
      browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
    }

    // Preemptive VPN rotation every 150
    if (checked > 0 && checked % 150 === 0) {
      console.log(`\n  🔄 Preemptive VPN rotation at ${checked}...\n`);
      await browser.close(); await rotateVPN(); await sleep(5000);
      browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
    }

    // Batch pause every 500
    if (checked > 0 && checked % 500 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
      console.log(`\n  ⏸️  Batch pause — saving & waiting 5 min...\n`);
      await browser.close(); await rotateVPN(); await sleep(5 * 60 * 1000);
      browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
    }

    const key = restaurant.name.toLowerCase();
    const prevTier = existing[key]?.tier || 'none';
    let result = await checkRestaurant(page, restaurant.name, restaurant.slug);

    // Retry on block
    if (result.tier === 'error' && result.error === 'access_denied') {
      console.log(`  🚫 Blocked — rotating VPN...`);
      await browser.close(); await rotateVPN(); await sleep(5000);
      browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
      result = await checkRestaurant(page, restaurant.name, restaurant.slug);
      // One more try
      if (result.tier === 'error' && result.error === 'access_denied') {
        await browser.close(); await rotateVPN(); await sleep(8000);
        browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
        result = await checkRestaurant(page, restaurant.name, restaurant.slug);
      }
    }

    // Validate — reject Access Denied
    if (result.matched_name === 'Access Denied' || result.error === 'access_denied') {
      result = { tier: 'error', error: 'access_denied_unresolved' };
    }

    checked++; sessionCount++;

    if (result.tier === 'error') {
      blocked++;
      consecutiveBlocks++;
      console.log(`  🚫 [${checked}/${list.length}] ${restaurant.name}: BLOCKED (was ${prevTier})`);
      if (consecutiveBlocks >= 5) {
        console.log(`\n  ⚠️  5 consecutive blocks — rotating VPN...\n`);
        await browser.close(); await rotateVPN(); await sleep(5000);
        browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
        consecutiveBlocks = 0;
      }
    } else {
      consecutiveBlocks = 0;
      results[key] = result;
      if (result.tier === 'open') open++;
      else if (result.tier === 'limited') limited++;
      else if (result.tier === 'booked') booked++;
      if (prevTier !== result.tier) flipped++;

      const icon = result.tier === 'open' ? '🟢' : result.tier === 'limited' ? '🟡' : result.tier === 'booked' ? '🔴' : '❓';
      const change = prevTier !== result.tier ? ` (was ${prevTier})` : '';
      const times = result.sample_times?.length > 0 ? ` → ${result.sample_times.join(', ')}` : '';
      console.log(`  ${icon} [${checked}/${list.length}] ${restaurant.name}: ${result.tier} (${result.dinner_slots} slots)${times}${change}`);
    }

    if (checked % 10 === 0) fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    await sleep(randomDelay());
  }

  // ── Future availability for booked restaurants (+3, +7, +14 days) ──
  const stillBooked = Object.entries(results)
    .filter(([k, v]) => !k.startsWith('_') && v.tier === 'booked' && !v.opens_in && !v.fully_locked)
    .map(([k]) => k);

  if (stillBooked.length > 0) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`🔮 Checking future availability for ${stillBooked.length} booked restaurants\n`);

    const OFFSETS = [3, 7, 14];
    function futureDate(offset) {
      const d = new Date(); d.setDate(d.getDate() + offset);
      return d.toISOString().split('T')[0];
    }

    let hasFuture = 0, locked = 0;
    for (let i = 0; i < stillBooked.length; i++) {
      if (sessionCount >= BROWSER_RESTART_EVERY) {
        await browser.close(); await sleep(5000);
        browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
      }

      const name = stillBooked[i];
      const cleanName = name.replace(/\(.*\)/g, '').replace(/[^\w\s'-]/g, '').replace(/\s+/g, ' ').trim();
      let opensIn = null;

      for (const offset of OFFSETS) {
        if (opensIn) break;
        const date = futureDate(offset);
        try {
          const url = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName)}&dateTime=${date}T19%3A30%3A00&covers=${PARTY_SIZE}&metroId=8`;
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });

          // Detect Access Denied
          const blocked = await page.evaluate(() => {
            const text = document.body?.innerText || '';
            return text.includes('Access Denied') || text.includes("don't have permission");
          });
          if (blocked) {
            console.log(`  🚫 Blocked on future check — rotating VPN...`);
            await browser.close(); await rotateVPN(); await sleep(5000);
            browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
          }

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

  await browser.close();
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Done! Rechecked ${checked} restaurants`);
  console.log(`   🟢 Open: ${open}  🟡 Limited: ${limited}  🔴 Booked: ${booked}  🚫 Blocked: ${blocked}`);
  console.log(`   🔄 Flipped: ${flipped} restaurants changed tier`);
  console.log(`   Output: ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
