/**
 * ot-check-final.js — OT availability using direct restaurant URLs
 *
 * Uses /r/{slug} pages instead of name search. Much more accurate.
 * Writes to tonight_availability_ot.json, regenerates slim file.
 *
 * RUN: node netlify/functions/ot-check-final.js [--all] [--date 2026-04-02] [--quick]
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
const CHECK_ALL = args.includes('--all');
const QUICK = args.includes('--quick');
const DEBUG = args.includes('--debug');
function getArg(name, def) { const i = args.indexOf(`--${name}`); return i !== -1 && args[i+1] ? args[i+1] : def; }

let CHECK_DATE = getArg('date', null);
if (!CHECK_DATE) { CHECK_DATE = new Date().toISOString().split('T')[0]; }
const TODAY = new Date().toISOString().split('T')[0];
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);
const BROWSER_RESTART_EVERY = 75;

const MASTER_FILE = path.join(__dirname, 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, 'tonight_availability_ot_TEMP.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function randomDelay() { return 3000 + Math.floor(Math.random() * 5000); }

// ── Load data ──
const BOOKING_MASTER = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
console.log(`✅ Loaded BOOKING_MASTER: ${Object.keys(BOOKING_MASTER).length} restaurants`);

// Get OT restaurants with slugs
const OT_RESTAURANTS = [];
for (const [name, info] of Object.entries(BOOKING_MASTER)) {
  if (info.platform !== 'opentable' || !info.url) continue;
  const slugMatch = info.url.match(/opentable\.com\/r\/([^?]+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  OT_RESTAURANTS.push({ name, url: info.url, slug });
}
console.log(`🍽️  Found ${OT_RESTAURANTS.length} OpenTable restaurants`);
console.log(`   With /r/ slug: ${OT_RESTAURANTS.filter(r => r.slug).length}`);
console.log(`   Without slug: ${OT_RESTAURANTS.filter(r => !r.slug).length}`);

let existing = {};
try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}

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

// ── Check via direct /r/ URL ──
async function checkDirect(page, slug) {
  const url = `https://www.opentable.com/r/${slug}?dateTime=${CHECK_DATE}T19%3A30%3A00&covers=${PARTY_SIZE}&lang=en-US`;
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
    await sleep(2000);

    const result = await page.evaluate(() => {
      const body = document.body?.innerText || '';
      if (body.length < 200) return { error: 'blocked' };
      if (body.includes('page not found') || body.includes("we couldn't find")) return { error: '404' };
      if (body.includes('not on the OpenTable reservation network') || body.includes('not currently taking reservations')) return { notOnOT: true };

      // Get restaurant name from h1
      const h1 = document.querySelector('h1');
      const pageName = h1 ? h1.textContent.trim() : '';

      // Find time slots — scan for AM/PM patterns
      const times = (body.match(/\d{1,2}:\d{2}\s*[AP]M/gi) || []);
      // Filter to dinner times only
      const dinnerTimes = [...new Set(times)].filter(t => {
        const m = t.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
        if (!m) return false;
        let h = parseInt(m[1]);
        if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
        if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
        return h >= 17 && h < 24;
      });

      // Check for no availability signals
      const noAvail = body.includes('no online availability') || body.includes('No tables') ||
                      body.includes('fully booked') || body.includes('No availability') ||
                      body.includes('Notify me');

      // Get rid from page
      const ridEl = document.querySelector('[data-rid]');
      const rid = ridEl ? ridEl.getAttribute('data-rid') : null;

      return { pageName, slots: dinnerTimes, noAvail, rid, bodyLen: body.length };
    });

    if (result.error === 'blocked') return { tier: 'unknown', platform: 'opentable', checked_date: new Date().toISOString(), error: 'blocked' };
    if (result.error === '404') return { tier: 'unknown', platform: 'opentable', checked_date: new Date().toISOString(), error: '404' };
    if (result.notOnOT) return { tier: 'not_on_ot', dinner_slots: 0, platform: 'opentable', checked_date: new Date().toISOString() };

    const slots = result.slots || [];
    let early = 0, prime = 0, late = 0;
    const parsedTimes = [];

    for (const timeStr of slots) {
      const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!m) continue;
      let h = parseInt(m[1]);
      if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
      if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
      const hour = h + parseInt(m[2]) / 60;
      parsedTimes.push(timeStr.trim());
      if (hour >= 17.0 && hour < 18.5) early++;
      else if (hour >= 18.5 && hour < 20.5) prime++;
      else if (hour >= 20.5 && hour < 24.0) late++;
    }

    const total = parsedTimes.length;
    const tier = (total === 0 && result.noAvail) ? 'booked' : total === 0 ? 'booked' : total <= 3 ? 'limited' : 'open';

    let earlyS, primeS, lateS;
    if (tier === 'open') { earlyS = 'available'; primeS = 'available'; lateS = 'available'; }
    else if (tier === 'limited') { earlyS = early > 0 ? 'limited' : 'booked'; primeS = prime > 0 ? 'limited' : 'booked'; lateS = late > 0 ? 'limited' : 'booked'; }
    else { earlyS = 'booked'; primeS = 'booked'; lateS = 'booked'; }

    return {
      tier, dinner_slots: total, early: earlyS, prime: primeS, late: lateS,
      has_early: earlyS !== 'booked', has_prime: primeS !== 'booked', has_late: lateS !== 'booked',
      sample_times: parsedTimes.slice(0, 5), platform: 'opentable', checked_date: new Date().toISOString(),
      rid: result.rid ? parseInt(result.rid) : undefined, matched_name: result.pageName,
    };
  } catch (e) {
    return { tier: 'unknown', platform: 'opentable', checked_date: new Date().toISOString(), error: e.message?.slice(0, 80) };
  }
}

// ── Check via name search (fallback for restaurants without /r/ slug) ──
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

async function checkSearch(page, name) {
  const cleanName = name.replace(/\(.*\)/g, '').replace(/[^\w\s'-]/g, '').replace(/\s+/g, ' ').trim();
  const url = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName)}&dateTime=${CHECK_DATE}T19%3A30%3A00&covers=${PARTY_SIZE}&metroId=8`;
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
    const cards = await page.evaluate(() => {
      const results = [];
      for (const card of document.querySelectorAll('[data-test="pinned-restaurant-card"],[data-test="restaurant-card"]')) {
        const n = card.querySelector('a[data-test="res-card-name"]')?.textContent?.trim() || '';
        const rid = card.getAttribute('data-rid') || '';
        const slots = Array.from(card.querySelectorAll('li[data-test^="time-slot"]')).map(s => s.textContent.trim().match(/(\d{1,2}:\d{2}\s*[AP]M)/i)?.[1]).filter(Boolean);
        const noAvail = card.innerText.includes('no online availability') || card.innerText.includes('fully booked');
        const notOnOT = card.innerText.includes('not on the OpenTable reservation network');
        results.push({ name: n, rid, slots, noAvail, notOnOT });
      }
      return results;
    });
    if (cards.length === 0) return { tier: 'unknown', platform: 'opentable', checked_date: new Date().toISOString(), error: 'no_cards' };
    let best = null, bestScore = 0;
    for (const c of cards) { const s = matchScore(name, c.name); if (s > bestScore) { bestScore = s; best = c; } }
    if (!best || bestScore < 0.7) return { tier: 'unknown', platform: 'opentable', checked_date: new Date().toISOString(), error: 'no_match', match_score: bestScore };
    if (best.notOnOT) return { tier: 'not_on_ot', platform: 'opentable', checked_date: new Date().toISOString(), rid: best.rid ? parseInt(best.rid) : undefined };

    let early = 0, prime = 0, late = 0;
    const parsedTimes = [];
    for (const t of best.slots) {
      const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i); if (!m) continue;
      let h = parseInt(m[1]); if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12; if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
      const hour = h + parseInt(m[2]) / 60; parsedTimes.push(t.trim());
      if (hour >= 17.0 && hour < 18.5) early++; else if (hour >= 18.5 && hour < 20.5) prime++; else if (hour >= 20.5) late++;
    }
    const total = parsedTimes.length;
    const tier = total === 0 ? 'booked' : total <= 3 ? 'limited' : 'open';
    let eS, pS, lS;
    if (tier === 'open') { eS = 'available'; pS = 'available'; lS = 'available'; }
    else if (tier === 'limited') { eS = early > 0 ? 'limited' : 'booked'; pS = prime > 0 ? 'limited' : 'booked'; lS = late > 0 ? 'limited' : 'booked'; }
    else { eS = 'booked'; pS = 'booked'; lS = 'booked'; }
    return { tier, dinner_slots: total, early: eS, prime: pS, late: lS, has_early: eS !== 'booked', has_prime: pS !== 'booked', has_late: lS !== 'booked', sample_times: parsedTimes.slice(0, 5), platform: 'opentable', checked_date: new Date().toISOString(), rid: best.rid ? parseInt(best.rid) : undefined, matched_name: best.name, match_score: bestScore };
  } catch (e) {
    return { tier: 'unknown', platform: 'opentable', checked_date: new Date().toISOString(), error: e.message?.slice(0, 80) };
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

  if (QUICK) toCheck = toCheck.slice(0, 15);

  const withSlug = toCheck.filter(r => r.slug).length;
  const withoutSlug = toCheck.filter(r => !r.slug).length;
  console.log(`\n🔍 Checking ${toCheck.length} restaurants for ${CHECK_DATE}`);
  console.log(`   📌 Direct URL: ${withSlug}  |  🔎 Name search: ${withoutSlug}`);
  console.log(`   Browser restart every ${BROWSER_RESTART_EVERY} | Random delay 3-8s\n`);

  let browser = await launchBrowser();
  let page = await setupPage(browser);
  let sessionCount = 0;
  const results = { ...existing };
  let checked = 0, open = 0, limited = 0, booked = 0, unknown = 0, notOnOT = 0;

  const BATCH_SIZE = 500;
  const BATCH_PAUSE_MS = 5 * 60 * 1000; // 5 min pause between batches

  for (const restaurant of toCheck) {
    // Batch cooldown: pause 15 min every 500 restaurants
    if (checked > 0 && checked % BATCH_SIZE === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
      console.log(`\n  ⏸️  Batch ${checked / BATCH_SIZE} complete — saving & pausing 5 min to avoid throttling...`);
      console.log(`     Progress: 🟢 ${open}  🟡 ${limited}  🔴 ${booked}  ❓ ${unknown}\n`);
      await browser.close();
      await sleep(BATCH_PAUSE_MS);
      browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
      console.log(`  ▶️  Resuming...\n`);
    }

    if (sessionCount >= BROWSER_RESTART_EVERY) {
      console.log(`\n  🔄 Restarting browser...\n`);
      await browser.close(); await sleep(5000);
      browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
    }

    const key = restaurant.name.toLowerCase();
    let result;

    if (restaurant.slug) {
      result = await checkDirect(page, restaurant.slug);
      // If direct URL is blocked, fall back to search
      if (result.error === 'blocked') {
        await sleep(3000);
        result = await checkSearch(page, restaurant.name);
        if (result.tier !== 'unknown') process.stdout.write('(search-fallback) ');
      }
    } else {
      result = await checkSearch(page, restaurant.name);
    }

    // Retry once on unknown
    if (result.tier === 'unknown') {
      await sleep(5000);
      result = restaurant.slug ? await checkDirect(page, restaurant.slug) : await checkSearch(page, restaurant.name);
      sessionCount++;
    }

    results[key] = result;
    checked++; sessionCount++;

    if (result.tier === 'open') { open++; result.has_early = true; result.has_prime = true; result.has_late = true; results[key] = result; }
    else if (result.tier === 'limited') limited++;
    else if (result.tier === 'booked') booked++;
    else if (result.tier === 'not_on_ot') notOnOT++;
    else unknown++;

    const icon = result.tier === 'open' ? '🟢' : result.tier === 'limited' ? '🟡' : result.tier === 'booked' ? '🔴' : result.tier === 'not_on_ot' ? '🚫' : '❓';
    const method = restaurant.slug ? '📌' : '🔎';
    const times = result.sample_times?.length > 0 ? ` → ${result.sample_times.join(', ')}` : '';
    console.log(`  ${icon} ${method} [${checked}/${toCheck.length}] ${restaurant.name}: ${result.tier} (${result.dinner_slots || 0} slots)${times}`);

    if (checked % 25 === 0) fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    await sleep(randomDelay());
  }

  // ── Phase 2: Recheck booked + limited at early/prime/late times ──
  const recheckList = Object.entries(results)
    .filter(([_, v]) => v.tier === 'booked' || v.tier === 'limited')
    .map(([k, v]) => {
      const r = OT_RESTAURANTS.find(r => r.name.toLowerCase() === k);
      return { name: k, slug: r?.slug, tier: v.tier };
    });

  if (recheckList.length > 0) {
    const TIME_CHECKS = [
      { time: '17:30:00', label: 'early' },
      { time: '19:30:00', label: 'prime' },
      { time: '21:30:00', label: 'late' },
    ];

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`🔍 Phase 2: Rechecking ${recheckList.length} booked+limited at early/prime/late times\n`);

    // Pause before Phase 2
    console.log(`  ⏸️  Pausing 5 min before Phase 2...\n`);
    await browser.close();
    await sleep(5 * 60 * 1000);
    browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
    console.log(`  ▶️  Resuming Phase 2...\n`);

    let flipped = 0;
    for (let i = 0; i < recheckList.length; i++) {
      if (sessionCount >= BROWSER_RESTART_EVERY) {
        await browser.close(); await sleep(5000);
        browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
      }

      // Batch cooldown in Phase 2
      if (i > 0 && i % BATCH_SIZE === 0) {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
        console.log(`\n  ⏸️  Phase 2 batch ${i / BATCH_SIZE} — pausing 5 min...\n`);
        await browser.close();
        await sleep(BATCH_PAUSE_MS);
        browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
      }

      const r = recheckList[i];
      let hasEarly = false, hasPrime = false, hasLate = false;

      // Skip prime recheck — Phase 1 already searched at 7:30pm
      const checks = TIME_CHECKS.filter(tc => tc.label !== 'prime');

      for (const tc of checks) {
        try {
          let slotCount = 0;
          if (r.slug) {
            const url = `https://www.opentable.com/r/${r.slug}?dateTime=${CHECK_DATE}T${tc.time}&covers=${PARTY_SIZE}&lang=en-US`;
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
            await sleep(2000);
            slotCount = await page.evaluate((timeLabel) => {
              const body = document.body?.innerText || '';
              const times = (body.match(/\d{1,2}:\d{2}\s*[AP]M/gi) || []);
              return times.filter(t => {
                const m = t.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
                if (!m) return false;
                let h = parseInt(m[1]);
                if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
                if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
                return h >= 17 && h < 24;
              }).length;
            });
          } else {
            const cleanName = r.name.replace(/\(.*\)/g, '').replace(/[^\w\s'-]/g, '').replace(/\s+/g, ' ').trim();
            const url = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName)}&dateTime=${CHECK_DATE}T${encodeURIComponent(tc.time)}&covers=${PARTY_SIZE}&metroId=8`;
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
            slotCount = await page.evaluate(() => {
              const card = document.querySelector('[data-test="pinned-restaurant-card"],[data-test="restaurant-card"]');
              if (!card || card.innerText.includes('not on the OpenTable reservation network')) return 0;
              return card.querySelectorAll('li[data-test^="time-slot"]').length;
            });
          }
          if (slotCount > 0) {
            if (tc.label === 'early') hasEarly = true;
            else if (tc.label === 'prime') hasPrime = true;
            else if (tc.label === 'late') hasLate = true;
          }
          sessionCount++;
        } catch {}
        await sleep(randomDelay());
      }

      hasPrime = results[r.name]?.has_prime || false;
      const anyAvail = hasEarly || hasPrime || hasLate;
      results[r.name].has_early = hasEarly;
      results[r.name].has_prime = hasPrime;
      results[r.name].has_late = hasLate;
      results[r.name].early = hasEarly ? 'limited' : 'booked';
      results[r.name].prime = hasPrime ? 'limited' : 'booked';
      results[r.name].late = hasLate ? 'limited' : 'booked';

      if (anyAvail && r.tier === 'booked') { results[r.name].tier = 'limited'; flipped++; }

      const icon = anyAvail ? '🟡' : '🔴';
      console.log(`  ${icon} [${i+1}/${recheckList.length}] ${r.name}: early=${hasEarly?'✅':'❌'} prime=${hasPrime?'✅':'❌'} late=${hasLate?'✅':'❌'}`);
      if ((i+1) % 10 === 0) fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
      await sleep(randomDelay());
    }
    console.log(`\n   🔄 Flipped ${flipped} from booked → limited`);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  }

  // ── Phase 3: Future availability for still-booked ──
  const stillBooked = Object.entries(results).filter(([_, v]) => v.tier === 'booked').map(([k]) => k);
  if (stillBooked.length > 0) {
    const OFFSETS = [3, 7, 14];
    function futureDate(offset) { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().split('T')[0]; }
    console.log(`\n🔮 Phase 3: Future availability for ${stillBooked.length} booked\n`);
    let hasFuture = 0, locked = 0;

    for (let i = 0; i < stillBooked.length; i++) {
      if (sessionCount >= BROWSER_RESTART_EVERY) { await browser.close(); await sleep(5000); browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0; }
      const name = stillBooked[i];
      const restaurant = OT_RESTAURANTS.find(r => r.name.toLowerCase() === name);
      let opensIn = null;

      for (const offset of OFFSETS) {
        const date = futureDate(offset);
        try {
          if (restaurant?.slug) {
            const url = `https://www.opentable.com/r/${restaurant.slug}?dateTime=${date}T19%3A30%3A00&covers=${PARTY_SIZE}&lang=en-US`;
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
            await sleep(2000);
            const slotCount = await page.evaluate(() => {
              const body = document.body?.innerText || '';
              const times = (body.match(/\d{1,2}:\d{2}\s*[AP]M/gi) || []);
              return times.filter(t => { const m = t.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i); if (!m) return false; let h = parseInt(m[1]); if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12; return h >= 17; }).length;
            });
            if (slotCount >= 2) { opensIn = offset; break; }
          } else {
            const cleanName = name.replace(/\(.*\)/g, '').replace(/[^\w\s'-]/g, '').replace(/\s+/g, ' ').trim();
            const url = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName)}&dateTime=${date}T19%3A30%3A00&covers=${PARTY_SIZE}&metroId=8`;
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
            const slotCount = await page.evaluate(() => {
              const card = document.querySelector('[data-test="pinned-restaurant-card"],[data-test="restaurant-card"]');
              if (!card || card.innerText.includes('not on the OpenTable reservation network')) return 0;
              return card.querySelectorAll('li[data-test^="time-slot"]').length;
            });
            if (slotCount >= 2) { opensIn = offset; break; }
          }
          sessionCount++;
        } catch {}
        await sleep(randomDelay());
      }

      if (opensIn) { results[name].opens_in = opensIn; hasFuture++; console.log(`  🟢 [${i+1}/${stillBooked.length}] ${name}: opens in +${opensIn}d`); }
      else { results[name].fully_locked = true; locked++; console.log(`  🔒 [${i+1}/${stillBooked.length}] ${name}: locked`); }
      if ((i+1) % 10 === 0) fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
      await sleep(randomDelay());
    }
    console.log(`\n   🟢 Has future: ${hasFuture}  🔒 Locked: ${locked}`);
  }

  await browser.close();

  // ── Save ──
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

  // ── Regenerate slim file (OT pushes independently) ──
  try {
    const { execSync } = require('child_process');
    execSync('node ' + path.join(__dirname, 'slim-availability.js'), { stdio: 'inherit' });
  } catch (e) { console.log('⚠️ Slim regeneration failed:', e.message); }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Done! Checked ${checked} OpenTable restaurants`);
  console.log(`   🟢 Open: ${open}  🟡 Limited: ${limited}  🔴 Booked: ${booked}  🚫 Not on OT: ${notOnOT}  ❓ Unknown: ${unknown}`);
  console.log(`   📌 Direct URL: ${withSlug}  🔎 Name search: ${withoutSlug}`);
  console.log(`   Output: ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
