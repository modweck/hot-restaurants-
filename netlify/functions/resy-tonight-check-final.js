/**
 * resy-availability-check.js
 *
 * Checks Resy availability for restaurants in booking_lookup.json.
 * Writes tonight_availability.json directly (format Netlify expects).
 *
 * RUN:   node resy-availability-check.js
 *
 * OPTIONS:
 *   --date 2026-03-01    Check a specific date (default: today)
 *   --party 2            Party size (default: 2)
 *   --quick              Only check first 50
 *   --all                Re-check ALL resy, even ones already checked today
 */

const fs = require('fs');
const path = require('path');
let puppeteer;
try { puppeteer = require('puppeteer'); } catch (e) {}

const fetch = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args);
  try { return require('node-fetch')(...args); }
  catch (e) { throw new Error('fetch not available. Use Node 18+ or add node-fetch.'); }
};

let _browser = null;
let _apiFailing = false; // tracks if API is returning 500s
let _apiPauseUsed = false; // only pause once per run

// ── NordVPN IP rotation ──────────────────────────────────────────────────────
const { execSync } = require('child_process');
const VPN_REGIONS = ['us', 'us', 'us', 'us', 'us', 'ca', 'uk'];

async function rotateVPN() {
  const region = VPN_REGIONS[Math.floor(Math.random() * VPN_REGIONS.length)];
  try {
    // Disconnect
    execSync('open -g "nordvpn://disconnect"', { timeout: 5000 });
    await sleep(3000);

    // Try connecting up to 3 times
    for (let attempt = 1; attempt <= 3; attempt++) {
      execSync(`open -g "nordvpn://connect/${region}"`, { timeout: 5000 });
      await sleep(8000); // wait for connection to establish

      // Verify we have a new IP (not our bare IP)
      try {
        const ip = execSync('curl -s --max-time 5 https://api.ipify.org', { timeout: 10000 }).toString().trim();
        if (ip && ip.length > 6) {
          console.log(`    🔄 VPN rotated → ${region} (${ip})`);
          return true;
        }
      } catch (e) {}

      console.log(`    ⚠️  VPN connect attempt ${attempt}/3 failed, retrying...`);
      execSync('open -g "nordvpn://disconnect"', { timeout: 5000 });
      await sleep(3000);
    }

    // All attempts failed — force reconnect to any server
    execSync('open -g "nordvpn://connect"', { timeout: 5000 });
    await sleep(10000);
    const ip = execSync('curl -s --max-time 5 https://api.ipify.org', { timeout: 10000 }).toString().trim();
    console.log(`    🔄 VPN fallback connect (${ip})`);
    return true;
  } catch (e) {
    console.log(`    ⚠️  VPN rotation failed: ${e.message?.slice(0, 40)}`);
    return false;
  }
}

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}
const QUICK_MODE = args.includes('--quick');
const CHECK_ALL  = args.includes('--all');
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);
const TODAY      = new Date().toISOString().split('T')[0];
const CHECK_DATE = getArg('date', TODAY);

// ── Files ─────────────────────────────────────────────────────────────────────
const MASTER_FILE   = path.join(__dirname, 'BOOKING_MASTER.json');
const BOOKING_FILE  = path.join(__dirname, 'booking_lookup.json');
const OUTPUT_FILE   = path.join(__dirname, 'tonight_availability.json');

// ── Auto-sync booking_lookup from BOOKING_MASTER ─────────────────────────────
try {
  const master = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
  const old = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));
  const synced = {};
  for (const [name, v] of Object.entries(master)) {
    if (!v.platform || !v.url) continue;
    const k = name.toLowerCase();
    synced[k] = { platform: v.platform, url: v.url };
    if (v.lat) synced[k].lat = v.lat;
    if (v.lng) synced[k].lng = v.lng;
    if (v.website) synced[k].website = v.website;
    if (v.venue_id) synced[k].venue_id = v.venue_id;
    const o = old[name] || old[k];
    if (o) for (const [k2, v2] of Object.entries(o)) if (!(k2 in synced[k])) synced[k][k2] = v2;
  }
  fs.writeFileSync(BOOKING_FILE, JSON.stringify(synced, null, 2));
  console.log(`🔄 booking_lookup synced: ${Object.keys(synced).length} entries`);
} catch (e) { console.log('⚠️ booking_lookup sync skipped:', e.message); }

let BOOKING_LOOKUP = {};
try { BOOKING_LOOKUP = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8')); }
catch (e) { console.error('❌ Cannot load booking_lookup.json'); process.exit(1); }

// Load existing tonight_availability.json so we can merge/skip
let EXISTING = {};
try { EXISTING = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch (e) {}

// ── Exclusion list: restaurants that should NOT be overwritten by this script ──
// These are manually managed (closed, walk-in, bars, wrong platform, etc.)
const EXCLUDE_FROM_RECHECK = new Set([
  '30 love', 'bar primi bowery', 'gugu room', 'little prince',
  'ootoya - times square', "winona's", 'futago soho', 'yakiniku futago soho',
  'peacock alley at waldorf astoria new york', 'baylander steel beach',
  'frying pan nyc', 'empress room', 'russ & daughters cafe', 'russ and daughters cafe',
  'lucali ny', 'jongro bbq', 'jongro bbq market',
]);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Resy URL → slug ───────────────────────────────────────────────────────────
function extractResySlug(url) {
  if (!url) return null;
  const m1 = url.match(/resy\.com\/cities\/[a-z-]+\/([a-z0-9_-]+)\/?$/i);
  if (m1) return m1[1].toLowerCase();
  const m2 = url.match(/venues\/([a-z0-9_-]+)\/?$/i);
  if (m2) return m2[1].toLowerCase();
  return null;
}

// ── Resy tokens ──────────────────────────────────────────────────────────────
const RESY_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const RESY_TOKENS = [
  // uid 64734558 — updated May 5
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3ODE4NzcwMDEsInVpZCI6NjQ3MzQ1NTgsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTM1MTEzMDV9fQ.AOlKh4ANqfmn4d15NBxgPMa6jLS7lgXTJ_9e-3uRMkUUl_SZi_5nI6bA4qBvXO-FgM8HMJXEYokbe0cP9lAim5LSAbxkhpiKzC1JpPV4PCUTJ7TKc2BuAyFdLxOHh7BvGLjprkYkeyQYCqxmCK6m0DIEG5ueF4l6CyzVbjMvlmu584lY',
];
let tokenIdx = 0;
function getHeaders() {
  const token = RESY_TOKENS[tokenIdx % RESY_TOKENS.length];
  tokenIdx++;
  return {
    'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
    'X-Resy-Auth-Token': token,
    'X-Resy-Universal-Auth': token,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'Origin': 'https://resy.com',
    'Referer': 'https://resy.com/',
    'Accept': 'application/json, text/plain, */*'
  };
}

// ── Parse slot time → decimal hour ───────────────────────────────────────────
// Resy returns times like "2026-03-22 18:30:00" or "6:30 PM"
function slotToHour(timeStr) {
  if (!timeStr) return null;
  // "2026-03-22 18:30:00" format
  const iso = timeStr.match(/\d{4}-\d{2}-\d{2}\s+(\d{1,2}):(\d{2})/);
  if (iso) return parseInt(iso[1]) + parseInt(iso[2]) / 60;
  // "HH:MM" 24h
  const hm = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) return parseInt(hm[1]) + parseInt(hm[2]) / 60;
  // "H:MM AM/PM"
  const ampm = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const min = parseInt(ampm[2]);
    const pm = /pm/i.test(ampm[3]);
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    return h + min / 60;
  }
  return null;
}

// ── Time window bucketing ─────────────────────────────────────────────────────
// Early = 5:00pm–6:30pm  (17.0–18.5)
// Prime = 6:30pm–8:30pm  (18.5–20.5)
// Late  = 8:30pm+        (20.5–24.0)
// 0-1 slots = booked, 2-3 slots = limited, 4+ = available
function buildTimeFlags(slots) {
  let early_count = 0;
  let prime_count = 0;
  let late_count  = 0;

  for (const slot of (slots || [])) {
    const hour = slotToHour(slot.time);
    if (hour === null) continue;
    if (hour >= 17.0 && hour < 18.5) early_count++;
    if (hour >= 18.5 && hour < 20.5) prime_count++;
    if (hour >= 20.5 && hour < 24.0) late_count++;
  }

  function windowStatus(count) {
    if (count <= 1) return 'booked';
    if (count <= 3) return 'limited';
    return 'available';
  }

  return {
    early: windowStatus(early_count),
    prime: windowStatus(prime_count),
    late:  windowStatus(late_count),
  };
}

// ── Convert internal tier → tonight_availability tier ────────────────────────
function toAvailTier(internalTier, totalSlots) {
  if (totalSlots === 0 || internalTier === 'sold_out') return 'booked';
  if (internalTier === 'nearly_full' || internalTier === 'limited')  return 'limited';
  return 'open';
}

// ── Resy API: fetch availability (tries POST then GET) ───────────────────────
async function fetchSlots(venueId, slug, date, partySize) {
  const headers = getHeaders();

  // Try POST first (Resy's newer API format)
  try {
    const body = { lat: 0, long: 0, day: date, party_size: partySize };
    if (venueId) body.venue_id = venueId;
    else if (slug) { body.slug = slug; body.location = 'ny'; }

    const resp = await fetch('https://api.resy.com/4/find', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'X-Origin': 'https://resy.com' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
    if (resp.ok) {
      const data = await resp.json();
      const slots = data?.results?.venues?.[0]?.slots || [];
      if (slots.length > 0 || resp.status === 200) {
        _apiFailing = false;
        return slots.map(s => ({ time: s.date?.start || s.date?.end || '', type: s.config?.type || 'dining_room' }));
      }
    }
  } catch (e) {}

  // Try GET fallback (older API format)
  try {
    const qs = venueId ? `venue_id=${venueId}` : `slug=${slug}&location=ny`;
    const url = `https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${date}&party_size=${partySize}&${qs}`;
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (resp.ok) {
      const data = await resp.json();
      const slots = data?.results?.venues?.[0]?.slots || [];
      _apiFailing = false;
      return slots.map(s => ({ time: s.date?.start || s.date?.end || '', type: s.config?.type || 'dining_room' }));
    }
  } catch (e) {}

  return null;
}

// ── Puppeteer fallback: scrape resy.com directly ─────────────────────────────
async function getBrowser() {
  if (!puppeteer) return null;
  if (!_browser || !_browser.isConnected()) {
    _browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  }
  return _browser;
}

async function fetchSlotsPuppeteer(slug, date, partySize) {
  const browser = await getBrowser();
  if (!browser) return null;

  let page;
  try {
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

    // Intercept the /4/find response from the page
    let apiSlots = null;
    page.on('response', async (resp) => {
      if (resp.url().includes('/4/find') && resp.request().method() === 'POST') {
        try {
          const data = await resp.json();
          const slots = data?.results?.venues?.[0]?.slots || [];
          apiSlots = slots.map(s => ({ time: s.date?.start || s.date?.end || '', type: s.config?.type || 'dining_room' }));
        } catch (e) {}
      }
    });

    await page.goto(`https://resy.com/cities/ny/${slug}?date=${date}&seats=${partySize}`, {
      waitUntil: 'networkidle2', timeout: 20000
    });
    await sleep(4000);

    // If we got slots from intercepted API, use those
    if (apiSlots && apiSlots.length > 0) return apiSlots;

    // Otherwise scrape the page for time slot buttons
    const scraped = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button, [role=button]')];
      return btns
        .map(b => b.textContent?.trim())
        .filter(t => t && /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(t));
    });

    if (scraped.length > 0) {
      return scraped.map(t => ({ time: t, type: 'dining_room' }));
    }

    // Check for "Notify Me" = fully booked
    const isBooked = await page.evaluate(() =>
      document.body?.innerText?.includes('Notify Me') || document.body?.innerText?.includes('no availability')
    );
    if (isBooked) return []; // empty = booked

    return null; // couldn't determine
  } catch (e) {
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ── Main check for one restaurant ────────────────────────────────────────────
async function checkOne(name, url, date, partySize) {
  const slug = extractResySlug(url);
  if (!slug) return null;

  let slots = null;

  try {
    // Step 1: resolve venue ID (try slug variants + location variants)
    let venueId = null;
    const slugsToTry = [slug];
    const shortSlug = slug.replace(/-new-york$/, '');
    if (shortSlug !== slug) slugsToTry.push(shortSlug);
    for (const s of slugsToTry) {
      for (const loc of ['ny', 'new-york-ny']) {
        try {
          const venueResp = await fetch(
            `https://api.resy.com/3/venue?url_slug=${s}&location=${loc}`,
            { headers: getHeaders(), signal: AbortSignal.timeout(10000) }
          );
          if (venueResp.ok) {
            const venueData = await venueResp.json();
            venueId = venueData?.id?.resy;
            if (venueId) break;
          }
        } catch {}
      }
      if (venueId) break;
    }

    // Step 2: try API (POST then GET)
    if (!_apiFailing) {
      slots = await fetchSlots(venueId, slug, date, partySize);
    }

    // Step 3: Puppeteer fallback if API fails
    if (slots === null) {
      if (_browser) { await _browser.close().catch(() => {}); _browser = null; }
      slots = await fetchSlotsPuppeteer(slug, date, partySize);
      if (slots !== null) process.stdout.write('(pup) ');
    }

    if (slots === null) return null;

    // ── Dinner slots = anything 5pm–11pm ──────────────────────────────────
    const dinnerSlots = slots.filter(s => {
      const h = slotToHour(s.time);
      return h !== null && h >= 17 && h < 23;
    }).length;

    // ── Internal tier ─────────────────────────────────────────────────────
    const primeSlots = slots.filter(s => {
      const h = slotToHour(s.time);
      return h !== null && h >= 18.5 && h < 20.5;
    }).length;

    let internalTier;
    if (slots.length === 0)              internalTier = 'sold_out';
    else if (primeSlots === 0 && dinnerSlots <= 1) internalTier = 'nearly_full';
    else if (primeSlots <= 1 && dinnerSlots <= 3)  internalTier = 'limited';
    else if (dinnerSlots <= 6)           internalTier = 'moderate';
    else                                 internalTier = 'available';

    const tier = toAvailTier(internalTier, slots.length);

    // ── Time flags — all false when booked ────────────────────────────────
    const windows = tier === 'booked'
      ? { early: 'booked', prime: 'booked', late: 'booked' }
      : buildTimeFlags(slots);

    return { tier, dinner_slots: dinnerSlots, early: windows.early, prime: windows.prime, late: windows.late };

  } catch (e) {
    const reason = e.name === 'TimeoutError' ? 'timeout' : e.name === 'AbortError' ? 'abort' : e.message?.slice(0, 60);
    process.stdout.write(`(${reason}) `);
    return null;
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🟣 RESY AVAILABILITY CHECKER');
  console.log(`📅 Date: ${CHECK_DATE}  👥 Party: ${PARTY_SIZE}`);
  console.log('─────────────────────────────────────\n');

  // Build deduplicated list of Resy restaurants
  const resyMap = new Map();
  for (const [name, info] of Object.entries(BOOKING_LOOKUP)) {
    if (info.platform !== 'resy' || !info.url) continue;
    const slug = extractResySlug(info.url);
    if (!slug || resyMap.has(slug)) continue;
    resyMap.set(slug, { name, url: info.url, slug });
  }

  let list = Array.from(resyMap.values());
  console.log(`📊 Total unique Resy restaurants: ${list.length}`);

  // Skip already-checked today unless --all
  if (!CHECK_ALL) {
    const alreadyDone = new Set(
      Object.entries(EXISTING)
        .filter(([k, v]) => !k.startsWith('_') && v._checked_date === TODAY)
        .map(([k]) => k)
    );
    const before = list.length;
    list = list.filter(r => !alreadyDone.has(r.name.toLowerCase().trim()));
    console.log(`⏭️  Skipping ${before - list.length} already checked today`);
  }

  if (QUICK_MODE) {
    list = list.slice(0, 50);
    console.log(`⚡ Quick mode: first 50 only`);
  }

  console.log(`🎯 Checking: ${list.length} restaurants\n`);

  // Start from existing data (preserve entries not being re-checked)
  const output = { ...EXISTING };
  let success = 0, fail = 0, skipped = 0, consecutiveFails = 0;
  const retryQueue = [];
  // Track recent API health: sliding window of last 20 results
  const recentResults = [];

  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const key = r.name.toLowerCase().trim();

    // Skip excluded restaurants (manually managed — closed, walk-in, bars, etc.)
    if (EXCLUDE_FROM_RECHECK.has(key)) { skipped++; continue; }

    process.stdout.write(`  [${i + 1}/${list.length}] ${r.name.substring(0, 38).padEnd(38)} `);

    const result = await checkOne(r.name, r.url, CHECK_DATE, PARTY_SIZE);

    if (result) {
      // Track API health: was this a real result or suspicious 0 slots?
      recentResults.push(result.tier === 'booked' ? 'booked' : 'ok');
      if (recentResults.length > 20) recentResults.shift();

      // If API is unstable (>40% booked in last 20) and this result is 0 slots,
      // don't overwrite existing data — the "booked" is probably a bad API response
      const recentBookedRate = recentResults.filter(r => r === 'booked').length / recentResults.length;
      const apiUnstable = recentResults.length >= 10 && recentBookedRate > 0.6;

      if (apiUnstable && result.tier === 'booked' && result.dinner_slots === 0 && output[key]) {
        console.log(`⏭️  skipped  (API unstable, keeping existing data)`);
        skipped++;
        retryQueue.push(r);
      } else {
        const prev = output[key] || {};
        output[key] = {
          tier:         result.tier,
          dinner_slots: result.dinner_slots,
          early:        result.early,
          prime:        result.prime,
          late:         result.late,
          _checked_date: TODAY,
          // Preserve future availability from previous run until Phase 2 re-checks
          ...(prev.opens_in ? { opens_in: prev.opens_in } : {}),
          ...(prev.fully_locked ? { fully_locked: prev.fully_locked } : {}),
        };

        const EMOJI = { booked: '⚫', limited: '🟠', open: '🟢' };
        const timeStr = [
          result.early, result.prime, result.late
        ].filter(Boolean).join('/') || (result.tier === 'booked' ? 'none' : '—');

        console.log(`${EMOJI[result.tier] || '⚪'} ${result.tier.padEnd(7)} [${timeStr}] (${result.dinner_slots} dinner slots)`);
        success++;
      }
      consecutiveFails = 0;
    } else {
      recentResults.push('fail');
      if (recentResults.length > 20) recentResults.shift();
      console.log(`❌ failed`);
      fail++;
      consecutiveFails++;
      retryQueue.push(r);

      // Back off on consecutive fails (aggressive — likely rate limited)
      if (consecutiveFails >= 5) {
        const backoff = Math.min(consecutiveFails * 5, 90);
        console.log(`    ⏸️  ${consecutiveFails} consecutive fails — backing off ${backoff}s`);
        await sleep(backoff * 1000);
      }
    }

    // Save every 25
    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
      console.log(`    💾 Progress saved (${i + 1}/${list.length})`);
    }

    await sleep(5000 + Math.floor(Math.random() * 3000)); // 5-8s random delay
  }

  // ── Retry pass for failed restaurants ──
  if (retryQueue.length > 0) {
    console.log(`\n🔄 Retrying ${retryQueue.length} failed restaurants after 30s cooldown...\n`);
    await sleep(30000);

    let retrySuccess = 0;
    for (let i = 0; i < retryQueue.length; i++) {
      const r = retryQueue[i];
      process.stdout.write(`  [retry ${i + 1}/${retryQueue.length}] ${r.name.substring(0, 34).padEnd(34)} `);

      const result = await checkOne(r.name, r.url, CHECK_DATE, PARTY_SIZE);
      const key = r.name.toLowerCase().trim();

      if (result) {
        output[key] = {
          tier: result.tier, dinner_slots: result.dinner_slots,
          early: result.early, prime: result.prime, late: result.late,
          _checked_date: TODAY
        };
        const EMOJI = { booked: '⚫', limited: '🟠', open: '🟢' };
        console.log(`${EMOJI[result.tier] || '⚪'} ${result.tier.padEnd(7)} (${result.dinner_slots} dinner slots)`);
        retrySuccess++;
        fail--;
        success++;
      } else {
        // Don't overwrite existing good data
        if (!output[key]) {
          output[key] = { tier: null, dinner_slots: 0, early: 'booked', prime: 'booked', late: 'booked', _checked_date: TODAY };
        }
        console.log(`❌ failed again`);
      }

      await sleep(3000); // slower pace on retry
    }
    console.log(`\n   🔄 Retry recovered: ${retrySuccess}/${retryQueue.length}`);
  }

  // Final save
  output._meta = {
    last_run: TODAY, checked_date: CHECK_DATE,
    party_size: PARTY_SIZE, checked: success, failed: fail
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  // Summary (only count today's run)
  const counts = { booked: 0, limited: 0, open: 0, null: 0 };
  for (const [k, v] of Object.entries(output)) {
    if (k.startsWith('_')) continue;
    if (v._checked_date !== TODAY) continue;
    counts[v.tier ?? 'null']++;
  }

  console.log(`\n${'═'.repeat(45)}`);
  console.log('📊 RESULTS');
  console.log(`   ✅ Success: ${success}  ❌ Failed: ${fail}  ⏭️  Skipped: ${skipped}`);
  console.log(`   ⚫ Booked:  ${counts.booked}`);
  console.log(`   🟠 Limited: ${counts.limited}`);
  console.log(`   🟢 Open:    ${counts.open}`);
  console.log(`\n💾 Saved → ${OUTPUT_FILE}`);

  // ── Phase 2: Future horizon for booked restaurants (calendar API) ──
  const bookedList = Object.entries(output)
    .filter(([k, v]) => !k.startsWith('_') && v._checked_date === TODAY && (v.tier === 'booked' || (v.early === 'booked' && v.prime === 'booked' && v.late === 'booked')))
    .map(([name]) => name)
    .filter(name => {
      const info = BOOKING_LOOKUP[name] || BOOKING_LOOKUP[Object.keys(BOOKING_LOOKUP).find(k => k.toLowerCase() === name)];
      return info && info.platform === 'resy' && info.url;
    });

  if (bookedList.length > 0) {
    const OFFSETS = [3, 7, 14, 21, 28];
    function futureDate(offset) {
      const d = new Date(); d.setDate(d.getDate() + offset);
      return d.toISOString().split('T')[0];
    }

    console.log(`\n${'─'.repeat(45)}`);
    console.log(`🔮 Phase 2: Checking future availability for ${bookedList.length} booked Resy restaurants`);
    console.log(`   📡 Using /4/venue/calendar API (one call per restaurant)\n`);

    // Venue ID cache for Phase 2
    const venueCache = {};

    async function resolveVenueId(slug, lookupEntry) {
      if (venueCache[slug]) return venueCache[slug];
      if (lookupEntry?.venue_id) { venueCache[slug] = lookupEntry.venue_id; return lookupEntry.venue_id; }
      const slugsToTry = new Set([slug]);
      const short = slug.replace(/-new-york$/, '');
      if (short !== slug) slugsToTry.add(short);
      for (const suffix of ['-chelsea','-soho','-nyc','-brooklyn','-les','-williamsburg','-west-village','-east-village','-flatiron','-midtown','-uws','-ues','-nolita','-tribeca']) {
        slugsToTry.add(short + suffix);
      }
      for (const s of slugsToTry) {
        for (const loc of ['new-york-ny', 'ny']) {
          try {
            const resp = await fetch(`https://api.resy.com/3/venue?url_slug=${s}&location=${loc}`, { headers: getHeaders(), signal: AbortSignal.timeout(10000) });
            if (!resp.ok) continue;
            const data = await resp.json();
            const id = data?.id?.resy;
            if (id) { venueCache[slug] = id; return id; }
          } catch {}
        }
      }
    }

    let hasFuture = 0, locked = 0, apiFailed = 0, noSlugCount = 0, notBookable = 0;
    let consecutiveFails = 0;
    let calendarWorking = null; // null = unknown

    for (let i = 0; i < bookedList.length; i++) {
      const name = bookedList[i];
      const key = name.toLowerCase();
      const lookupEntry = BOOKING_LOOKUP[name] || BOOKING_LOOKUP[key] || BOOKING_LOOKUP[Object.keys(BOOKING_LOOKUP).find(k => k.toLowerCase() === key)];
      const slug = extractResySlug(lookupEntry?.url);
      if (!slug) { noSlugCount++; console.log(`  🔒 [${i+1}/${bookedList.length}] ${name}: no slug`); continue; }

      // Skip if already checked in this session (resume support)
      if (output[key]?.opens_in || output[key]?.fully_locked) {
        const prev = output[key].opens_in ? `🟢 +${output[key].opens_in}d` : '🔒';
        console.log(`  ⏭️  [${i+1}/${bookedList.length}] ${name}: already checked (${prev})`);
        if (output[key].opens_in) hasFuture++;
        else locked++;
        continue;
      }

      // Resolve venue ID
      const venueId = await resolveVenueId(slug, lookupEntry);
      if (!venueId) {
        apiFailed++;
        consecutiveFails++;
        console.log(`  ❌ [${i+1}/${bookedList.length}] ${name}: no venue ID`);
        if (consecutiveFails >= 5) {
          console.log(`     ⏸️ ${consecutiveFails} consecutive fails — backing off 30s`);
          await sleep(30000);
          consecutiveFails = 0;
        }
        await sleep(3000);
        continue;
      }

      let opensIn = null;

      // Try /4/venue/calendar first — one call covers all dates
      if (calendarWorking !== false) {
        try {
          const resp = await fetch(
            `https://api.resy.com/4/venue/calendar?venue_id=${venueId}&num_seats=${PARTY_SIZE}&start_date=${TODAY}&end_date=${futureDate(28)}`,
            { headers: getHeaders(), signal: AbortSignal.timeout(10000) }
          );

          if (resp.status === 500) {
            if (calendarWorking === null) {
              calendarWorking = false;
              console.log(`  ⚠️  Calendar API returning 500s — falling back to /4/find\n`);
            }
          } else if (resp.ok) {
            calendarWorking = true;
            consecutiveFails = 0;
            const data = await resp.json();
            const scheduled = data?.scheduled || [];

            if (scheduled.length === 0) {
              // No scheduled days at all = not bookable (walk-in/events only)
              output[key].fully_locked = true;
              output[key].not_bookable = true;
              notBookable++;
              console.log(`  ⚪ [${i+1}/${bookedList.length}] ${name}: not bookable (0 scheduled days)`);
              await sleep(5000);
              continue;
            }

            // Check target dates for availability
            const targetDates = OFFSETS.map(o => futureDate(o));
            for (let d = 0; d < targetDates.length; d++) {
              const day = scheduled.find(s => s.date === targetDates[d]);
              if (day && day.inventory?.reservation === 'available') {
                opensIn = OFFSETS[d];
                break;
              }
            }

            // If target dates aren't available, check if ANY future date is
            if (!opensIn) {
              const anyAvailable = scheduled.find(s => s.inventory?.reservation === 'available');
              if (anyAvailable) {
                // Calculate offset from today
                const diffMs = new Date(anyAvailable.date) - new Date(TODAY);
                const diffDays = Math.round(diffMs / 86400000);
                opensIn = diffDays;
              }
            }
          } else {
            // Non-500 error
            calendarWorking = null;
          }
        } catch {
          calendarWorking = null;
        }
      }

      // Fallback: /4/find per date if calendar didn't work
      if (calendarWorking === false && !opensIn) {
        for (const offset of OFFSETS) {
          if (opensIn) break;
          const date = futureDate(offset);
          try {
            const resp = await fetch('https://api.resy.com/4/find', {
              method: 'POST',
              headers: { ...getHeaders(), 'Content-Type': 'application/json', 'X-Origin': 'https://resy.com' },
              body: JSON.stringify({ venue_id: venueId, day: date, party_size: PARTY_SIZE, lat: 0, long: 0 }),
              signal: AbortSignal.timeout(10000),
            });
            if (!resp.ok) { apiFailed++; continue; }
            consecutiveFails = 0;
            const data = await resp.json();
            const slots = data?.results?.venues?.[0]?.slots || [];
            const dinnerSlots = slots.filter(s => {
              const t = s.date?.start || '';
              const hm = t.match(/(\d{2}):(\d{2})/);
              return hm && parseInt(hm[1]) >= 17;
            }).length;
            if (dinnerSlots > 0) opensIn = offset;
          } catch {}
          await sleep(5000);
        }
      }

      if (opensIn) {
        output[key].opens_in = opensIn;
        hasFuture++;
        console.log(`  🟢 [${i+1}/${bookedList.length}] ${name}: opens in +${opensIn}d`);
      } else {
        output[key].fully_locked = true;
        locked++;
        console.log(`  🔒 [${i+1}/${bookedList.length}] ${name}: locked`);
      }

      if ((i + 1) % 25 === 0) {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
        console.log(`    💾 Progress saved`);
      }

      await sleep(5000);
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`\n   🟢 Has future: ${hasFuture}  🔒 Locked: ${locked}  ⚪ Not bookable: ${notBookable}  ❌ API failed: ${apiFailed}  🔒 No slug: ${noSlugCount}`);
  }

  // ── Cleanup: strip stale fully_locked flags ──
  // Any entry whose _checked_date isn't today is stale data — remove fully_locked
  // so the website doesn't show "Booked Solid" labels based on outdated info.
  let cleanedFlags = 0;
  for (const [key, v] of Object.entries(output)) {
    if (key.startsWith('_')) continue;
    if (v.fully_locked && v._checked_date !== TODAY) {
      delete output[key].fully_locked;
      cleanedFlags++;
    }
  }
  if (cleanedFlags > 0) {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`\n   🧹 Stripped ${cleanedFlags} stale fully_locked flag(s) (entries not checked today)`);
  }

  // Clean up Puppeteer browser if used
  if (typeof _browser !== 'undefined' && _browser) { try { _browser.close(); } catch {} }

  console.log('✅ Done!\n');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
