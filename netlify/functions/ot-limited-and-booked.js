/**
 * ot-limited-and-booked.js — Recheck OT restaurants that are limited or booked.
 *
 * RUN:   node netlify/functions/ot-limited-and-booked.js
 *
 * OPTIONS:
 *   --date 2026-04-07   Check a specific date (default: tomorrow)
 *   --party 2           Party size (default: 2)
 *   --quick             Only check first 15 (for testing)
 *   --batch 200         Stop after N restaurants
 *   --no-future         Skip future availability check for booked restaurants
 *   --retry-blocked     Only recheck restaurants that were blocked/errored last run
 *
 * OUTPUT: Saves to tomorrow_availability_ot.json
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { execSync } = require('child_process');

// ── VPN rotation with connectivity check ──
const VPN_REGIONS = ['us', 'us', 'us', 'us', 'us', 'ca', 'uk'];
async function rotateVPN() {
  const region = VPN_REGIONS[Math.floor(Math.random() * VPN_REGIONS.length)];
  try {
    execSync('open -g "nordvpn://disconnect"', { timeout: 5000 });
    await sleep(2000);

    for (let attempt = 1; attempt <= 3; attempt++) {
      execSync(`open -g "nordvpn://connect/${region}"`, { timeout: 5000 });

      // Wait for internet to actually come back — poll up to 30s
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

    // Last resort — just connect to anything
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
function getArg(name, def) { const i = args.indexOf(`--${name}`); return i !== -1 && args[i+1] ? args[i+1] : def; }
const QUICK = args.includes('--quick');
const NO_FUTURE = args.includes('--no-future');
const RETRY_BLOCKED = args.includes('--retry-blocked');
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);
const BATCH_LIMIT = parseInt(getArg('batch', '0'), 10);
const BROWSER_RESTART_EVERY = 75;

// Use local date (not UTC) for today
const now = new Date();
const localToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const pad = n => String(n).padStart(2, '0');
const TODAY_STR = `${localToday.getFullYear()}-${pad(localToday.getMonth()+1)}-${pad(localToday.getDate())}`;
let CHECK_DATE = getArg('date', null);
if (!CHECK_DATE) { CHECK_DATE = TODAY_STR; }

const MASTER_FILE = path.join(__dirname, 'BOOKING_MASTER.json');
const INPUT_FILE = path.join(__dirname, 'tonight_availability_ot.json');
const OUTPUT_FILE = path.join(__dirname, 'tonight_availability_ot_recheck.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function randomDelay() { return 2000 + Math.floor(Math.random() * 3000); }

// ── Load data ──
const BOOKING_MASTER = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
let existing = {};
try { existing = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8')); } catch {}

// Load previous output too (for --retry-blocked)
let prevOutput = {};
try { prevOutput = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}

// ── Build recheck list ──
const toRecheck = [];

if (RETRY_BLOCKED) {
  // Only recheck restaurants that were blocked, errored, or marked locked-due-to-block
  for (const [key, info] of Object.entries(prevOutput)) {
    if (key.startsWith('_')) continue;
    const isBlocked = info.tier === 'error' || info.error === 'access_denied_unresolved';
    const isBlockedLocked = info.fully_locked && info.lock_reason === 'blocked';
    if (isBlocked || isBlockedLocked) {
      const bmEntry = BOOKING_MASTER[key] || BOOKING_MASTER[Object.keys(BOOKING_MASTER).find(k => k.toLowerCase() === key)];
      if (bmEntry?.url) toRecheck.push({ name: key, url: bmEntry.url });
    }
  }
} else {
  for (const [name, info] of Object.entries(BOOKING_MASTER)) {
    if (info.platform !== 'opentable' || !info.url) continue;
    const key = name.toLowerCase();
    const prev = existing[key] || existing[Object.keys(existing).find(k => k.toLowerCase() === key)];
    if (!prev) continue;
    if (prev.tier === 'limited' || prev.tier === 'booked') {
      toRecheck.push({ name, url: info.url });
    }
  }
}

// Extract slugs
for (const r of toRecheck) {
  const rMatch = r.url.match(/opentable\.com\/r\/([^?/]+)/);
  const plainMatch = r.url.match(/opentable\.com\/([^?/]+)$/);
  r.slug = rMatch ? rMatch[1] : (plainMatch ? plainMatch[1] : null);
}

console.log(`✅ Loaded ${Object.keys(BOOKING_MASTER).length} restaurants`);
console.log(`🔍 Found ${toRecheck.length} ${RETRY_BLOCKED ? 'blocked/errored' : 'limited/booked'} to recheck`);
console.log(`   Checking for date: ${CHECK_DATE}, party of ${PARTY_SIZE}`);
console.log(`   Mode: ${RETRY_BLOCKED ? 'RETRY BLOCKED' : 'standard'}  |  Future: ${NO_FUTURE ? 'SKIP' : 'ON'}\n`);

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

// ── Shared helpers ──

function cleanSearchName(name) {
  return name
    .replace(/\(.*?\)/g, '')
    .replace(/\s*-\s*(?:(?:upper |lower )?(?:east |west )?(?:side|village|midtown|downtown|chelsea|soho|lic|uws|ues|tribeca|harlem|brooklyn|queens|bronx|flatiron|nolita|williamsburg|astoria|meatpacking|hudson yards|murray hill|union square|times square|hell's kitchen|east village|west village|park avenue|long island city|flushing|hunters point|jersey city|rockefeller center|broadway|bowery|sullivan st|spring st|46th street|35th street|36th street|44th street|91st street|50th st|57th|37th st|nyc|ny|nj)).*$/i, '')
    .replace(/\s*[-–|·].*(?:nyc|new york|manhattan|brooklyn|queens|bronx|staten island)\s*$/i, '')
    .replace(/\s*[-–]\s+(?:no |regular ).*$/i, '')
    .replace(/[｜].*/g, '')
    .replace(/[^\w\s'&-]/g, '')
    .replace(/\s+/g, ' ').trim();
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

function parseDinnerTimes(timeStrings) {
  let early = 0, prime = 0, late = 0;
  const parsed = [];
  for (const timeStr of timeStrings) {
    const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) continue;
    let h = parseInt(m[1]); const min = parseInt(m[2]);
    if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
    const hour = h + min / 60;
    if (hour < 17 || hour >= 24) continue;
    parsed.push(timeStr.trim());
    if (hour < 18.5) early++;
    else if (hour < 20.5) prime++;
    else late++;
  }
  return { parsed, early, prime, late, total: parsed.length };
}

function buildResult(times, { tier: overrideTier, rid, matchedName, matchScore: ms, source } = {}) {
  const { parsed, early, prime, late, total } = times;
  const tier = overrideTier || (total === 0 ? 'booked' : total <= 3 ? 'limited' : 'open');
  let eS, pS, lS;
  if (tier === 'open') { eS = 'available'; pS = 'available'; lS = 'available'; }
  else if (tier === 'limited') { eS = early > 0 ? 'limited' : 'booked'; pS = prime > 0 ? 'limited' : 'booked'; lS = late > 0 ? 'limited' : 'booked'; }
  else { eS = 'booked'; pS = 'booked'; lS = 'booked'; }

  const result = {
    tier, dinner_slots: total, early: eS, prime: pS, late: lS,
    has_early: eS !== 'booked', has_prime: pS !== 'booked', has_late: lS !== 'booked',
    sample_times: parsed.slice(0, 5), platform: 'opentable',
    checked_date: new Date().toISOString(),
  };
  if (rid) result.rid = parseInt(rid);
  if (matchedName) result.matched_name = matchedName;
  if (ms !== undefined) result.match_score = ms;
  if (source) result.source = source;
  return result;
}

// ── Check via direct /r/ slug page ──
async function checkDirectPage(page, slug, date) {
  const directUrl = `https://www.opentable.com/r/${slug}?dateTime=${date}T19%3A30%3A00&covers=${PARTY_SIZE}&lang=en-US`;
  await page.goto(directUrl, { waitUntil: 'networkidle2', timeout: 25000 });
  await sleep(1500);

  const directResult = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    if (text.includes('Access Denied') || text.length < 300) return { blocked: true };

    const noAvail = text.includes('no online availability') || text.includes('No tables') || text.includes('fully booked');
    const notifyMe = text.includes('Notify me') || text.includes('notify me') || text.includes('Get notified');
    const waitlist = text.includes('Join waitlist') || text.includes('join the waitlist');

    // Use proper OT selectors first — same as search page
    let slots = Array.from(document.querySelectorAll('li[data-test^="time-slot"], button[data-test^="time-slot"], [data-test="timeslot"]')).map(s => {
      const m = s.textContent.trim().match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
      return m ? m[1] : null;
    }).filter(Boolean);

    // Fallback: OT direct page sometimes uses different selectors
    if (slots.length === 0) {
      slots = Array.from(document.querySelectorAll('.timeslot, .time-slot, [class*="TimeSlot"], [class*="timeslot"]')).map(s => {
        const m = s.textContent.trim().match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
        return m ? m[1] : null;
      }).filter(Boolean);
    }

    // Last resort: look for time buttons in the reservation widget area only (not whole page)
    if (slots.length === 0) {
      const widget = document.querySelector('#availability, [data-test="availability"], [class*="Availability"], [class*="reservation"]');
      if (widget) {
        const widgetTimes = widget.innerText.match(/\d{1,2}:\d{2}\s*[AP]M/gi) || [];
        slots = [...new Set(widgetTimes)];
      }
    }

    return { blocked: false, noAvail, notifyMe, waitlist, slots: [...new Set(slots)] };
  });

  if (directResult.blocked) return { tier: 'error', error: 'access_denied' };

  const times = parseDinnerTimes(directResult.slots);
  if (times.total === 0 && (directResult.noAvail || directResult.notifyMe || directResult.waitlist)) {
    return buildResult(times, { tier: 'booked', source: 'direct_slug' });
  }
  return buildResult(times, { source: 'direct_slug' });
}

// ── Check via search page ──
async function checkSearchPage(page, name) {
  const cleanName = cleanSearchName(name);
  const url = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName)}&dateTime=${CHECK_DATE}T19%3A30%3A00&covers=${PARTY_SIZE}&metroId=8`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });

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

  const times = parseDinnerTimes(bestCard.slots);
  return buildResult(times, { rid: bestCard.rid, matchedName: bestCard.name, matchScore: bestScore });
}

// ── Check restaurant: slug-first, then search fallback ──
async function checkRestaurant(page, name, slug) {
  try {
    // STRATEGY: If we have a slug, go direct first (guaranteed match, faster)
    if (slug) {
      const directResult = await checkDirectPage(page, slug, CHECK_DATE);
      if (directResult.tier !== 'error') return directResult;
      if (directResult.error === 'access_denied') return directResult;
    }

    // Search fallback
    const searchResult = await checkSearchPage(page, name);

    // If search found a card with 0 slots, try direct page as last resort
    if (searchResult.tier === 'booked' && slug && searchResult.dinner_slots === 0) {
      try {
        const directRetry = await checkDirectPage(page, slug, CHECK_DATE);
        if (directRetry.tier !== 'error' && directRetry.dinner_slots > 0) {
          process.stdout.write('(direct-fallback) ');
          return directRetry;
        }
      } catch {}
    }

    return searchResult;
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
  const results = RETRY_BLOCKED ? { ...prevOutput } : { ...existing };
  let checked = 0, open = 0, limited = 0, booked = 0, blocked = 0, flipped = 0;
  let consecutiveBlocks = 0;

  for (const restaurant of list) {
    // Browser restart
    if (sessionCount >= BROWSER_RESTART_EVERY) {
      await browser.close(); await sleep(3000);
      browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
    }

    // Batch save every 500
    if (checked > 0 && checked % 500 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
      console.log(`\n  ⏸️  Batch save at ${checked}...\n`);
      await browser.close(); await rotateVPN(); await sleep(60000);
      browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
    }

    const key = restaurant.name.toLowerCase();
    const prevTier = existing[key]?.tier || prevOutput[key]?.tier || 'none';
    let result = await checkRestaurant(page, restaurant.name, restaurant.slug);

    // Retry on block — rotate VPN
    if (result.tier === 'error' && result.error === 'access_denied') {
      console.log(`  🚫 Blocked — rotating VPN...`);
      await browser.close(); await rotateVPN();
      browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
      result = await checkRestaurant(page, restaurant.name, restaurant.slug);
      if (result.tier === 'error' && result.error === 'access_denied') {
        console.log(`  🚫 Still blocked — rotating VPN again...`);
        await browser.close(); await rotateVPN();
        browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
        result = await checkRestaurant(page, restaurant.name, restaurant.slug);
      }
    }

    // Validate
    if (result.matched_name === 'Access Denied' || result.error === 'access_denied') {
      result = { tier: 'error', error: 'access_denied_unresolved' };
    }

    checked++; sessionCount++;

    if (result.tier === 'error') {
      blocked++;
      consecutiveBlocks++;
      console.log(`  🚫 [${checked}/${list.length}] ${restaurant.name}: ${result.error} (was ${prevTier})`);
      if (consecutiveBlocks >= 5) {
        console.log(`\n  ⚠️  5 consecutive blocks — rotating VPN + 30s pause...\n`);
        await browser.close(); await rotateVPN(); await sleep(30000);
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
      const src = result.source === 'direct_slug' ? ' [slug]' : '';
      console.log(`  ${icon} [${checked}/${list.length}] ${restaurant.name}: ${result.tier} (${result.dinner_slots} slots)${times}${change}${src}`);
    }

    if (checked % 10 === 0) fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    await sleep(randomDelay());
  }

  // ── Future availability for booked restaurants (+3, +7, +14 days) ──
  if (!NO_FUTURE) {
    const stillBooked = Object.entries(results)
      .filter(([k, v]) => !k.startsWith('_') && v.tier === 'booked' && !v.opens_in && !v.fully_locked)
      .map(([k]) => k);

    if (stillBooked.length > 0) {
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`🔮 Checking future availability for ${stillBooked.length} booked restaurants\n`);

      const OFFSETS = [3, 7, 14];
      function futureDate(offset) {
        const d = new Date(localToday); d.setDate(d.getDate() + offset);
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      }

      let hasFuture = 0, locked = 0, skippedBlocked = 0;
      for (let i = 0; i < stillBooked.length; i++) {
        if (sessionCount >= BROWSER_RESTART_EVERY) {
          await browser.close(); await sleep(3000);
          browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
        }


        const name = stillBooked[i];
        const bmEntry = BOOKING_MASTER[name] || BOOKING_MASTER[Object.keys(BOOKING_MASTER).find(k => k.toLowerCase() === name)];
        const slugMatch = bmEntry?.url?.match(/opentable\.com\/r\/([^?/]+)/);
        const slug = slugMatch ? slugMatch[1] : null;
        let opensIn = null;
        let wasBlocked = false;

        for (const offset of OFFSETS) {
          if (opensIn) break;
          const date = futureDate(offset);
          try {
            if (slug) {
              const directResult = await checkDirectPage(page, slug, date);
              sessionCount++;
              if (directResult.tier !== 'error' && directResult.dinner_slots >= 2) { opensIn = offset; break; }
              if (directResult.error === 'access_denied') {
                wasBlocked = true;
                console.log(`  🚫 Blocked on future check — rotating VPN...`);
                await browser.close(); await rotateVPN();
                browser = await launchBrowser(); page = await setupPage(browser); sessionCount = 0;
                // Retry this offset once
                const retry = await checkDirectPage(page, slug, date);
                sessionCount++;
                if (retry.tier !== 'error' && retry.dinner_slots >= 2) { opensIn = offset; wasBlocked = false; break; }
                if (retry.error === 'access_denied') break; // stop trying more offsets
              }
            } else {
              const cleanName = cleanSearchName(name);
              const url = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName)}&dateTime=${date}T19%3A30%3A00&covers=${PARTY_SIZE}&metroId=8`;
              await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });

              const isBlocked = await page.evaluate(() => {
                const text = document.body?.innerText || '';
                return text.includes('Access Denied') || text.includes("don't have permission");
              });
              if (isBlocked) {
                wasBlocked = true;
                console.log(`  🚫 Blocked on future check — rotating VPN...`);
                await browser.close(); await rotateVPN();
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
            }
          } catch {}
          await sleep(randomDelay());
        }

        if (opensIn) {
          results[name].opens_in = opensIn;
          hasFuture++;
          console.log(`  🟢 [${i+1}/${stillBooked.length}] ${name}: opens in +${opensIn}d`);
        } else if (wasBlocked) {
          // Don't mark as locked if we couldn't actually check — leave for retry
          results[name].fully_locked = true;
          results[name].lock_reason = 'blocked';
          skippedBlocked++;
          console.log(`  ⏭️  [${i+1}/${stillBooked.length}] ${name}: blocked (will retry)`);
        } else {
          results[name].fully_locked = true;
          results[name].lock_reason = 'confirmed';
          locked++;
          console.log(`  🔒 [${i+1}/${stillBooked.length}] ${name}: locked`);
        }

        if ((i+1) % 10 === 0) fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
        await sleep(randomDelay());
      }

      console.log(`\n   🟢 Has future: ${hasFuture}  🔒 Locked: ${locked}  ⏭️ Blocked (retry later): ${skippedBlocked}`);
    }
  } else {
    console.log(`\n⏭️  Skipping future availability check (--no-future)`);
  }

  await browser.close();
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Done! Rechecked ${checked} restaurants`);
  console.log(`   🟢 Open: ${open}  🟡 Limited: ${limited}  🔴 Booked: ${booked}  🚫 Blocked: ${blocked}`);
  console.log(`   🔄 Flipped: ${flipped} restaurants changed tier`);
  if (blocked > 0) console.log(`   💡 Run with --retry-blocked to recheck the ${blocked} blocked ones`);
  console.log(`   Output: ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
