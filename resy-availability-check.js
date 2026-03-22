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

const fetch = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args);
  try { return require('node-fetch')(...args); }
  catch (e) { throw new Error('fetch not available. Use Node 18+ or add node-fetch.'); }
};

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
const BOOKING_FILE  = path.join(__dirname, 'booking_lookup.json');
const OUTPUT_FILE   = path.join(__dirname, 'tonight_availability.json');

let BOOKING_LOOKUP = {};
try { BOOKING_LOOKUP = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8')); }
catch (e) { console.error('❌ Cannot load booking_lookup.json'); process.exit(1); }

// Load existing tonight_availability.json so we can merge/skip
let EXISTING = {};
try { EXISTING = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch (e) {}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Resy URL → slug ───────────────────────────────────────────────────────────
function extractResySlug(url) {
  if (!url) return null;
  const m1 = url.match(/resy\.com\/cities\/[a-z-]+\/([a-z0-9-]+)\/?$/i);
  if (m1) return m1[1];
  const m2 = url.match(/venues\/([a-z0-9-]+)\/?$/i);
  if (m2) return m2[1];
  return null;
}

// ── Shared Resy headers ───────────────────────────────────────────────────────
const RESY_HEADERS = {
  'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
  'X-Resy-Auth-Token': 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3NzU5MTI5MDQsInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.AbLsC4mROj3TN9otRtBL7UikUVDg4zBJInRJ_gHWiQ6hzuW7eY0zvPLeUhJyW2bokab4DO0jZXxeobiW2ANUCzI0AT8jENhBeyTE1HSUVcmH3ICRj3NIpbfNTGtFuhHgB_jjOe09EYoAc1sao3BDBgCiR1fNTXjlTmd4HYTkazZRH288',
  'X-Resy-Universal-Auth': 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3NzU5MTI5MDQsInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.AbLsC4mROj3TN9otRtBL7UikUVDg4zBJInRJ_gHWiQ6hzuW7eY0zvPLeUhJyW2bokab4DO0jZXxeobiW2ANUCzI0AT8jENhBeyTE1HSUVcmH3ICRj3NIpbfNTGtFuhHgB_jjOe09EYoAc1sao3BDBgCiR1fNTXjlTmd4HYTkazZRH288',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  'Origin': 'https://resy.com',
  'Referer': 'https://resy.com/',
  'Accept': 'application/json, text/plain, */*'
};

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
// Early = 6:00pm–7:30pm  (18.0–19.5)
// Prime = 7:30pm–9:00pm  (19.5–21.0)
// Late  = 9:00pm+        (21.0–23.99)
function buildTimeFlags(slots) {
  let has_early = false;
  let has_prime = false;
  let has_late  = false;

  for (const slot of (slots || [])) {
    const hour = slotToHour(slot.time);
    if (hour === null) continue;
    if (hour >= 17.0 && hour < 18.5) has_early = true;
    if (hour >= 18.5 && hour < 20.5) has_prime = true;
    if (hour >= 20.5 && hour < 24.0) has_late  = true;
  }

  return { has_early, has_prime, has_late };
}

// ── Convert internal tier → tonight_availability tier ────────────────────────
function toAvailTier(internalTier, totalSlots) {
  if (totalSlots === 0 || internalTier === 'sold_out') return 'booked';
  if (internalTier === 'nearly_full' || internalTier === 'limited')  return 'limited';
  return 'open';
}

// ── Resy API: fetch by venue ID ───────────────────────────────────────────────
async function fetchByVenueId(venueId, date, partySize) {
  const url = `https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${date}&party_size=${partySize}&venue_id=${venueId}`;
  const resp = await fetch(url, { headers: RESY_HEADERS });
  if (!resp.ok) return null;
  const data = await resp.json();
  return (data?.results?.venues?.[0]?.slots || []).map(s => ({
    time: s.date?.start || s.date?.end || '',
    type: s.config?.type || 'dining_room'
  }));
}

// ── Resy API: fetch by slug ───────────────────────────────────────────────────
async function fetchBySlug(slug, date, partySize) {
  const url = `https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${date}&party_size=${partySize}&slug=${slug}&location=ny`;
  const resp = await fetch(url, { headers: RESY_HEADERS });
  if (!resp.ok) return null;
  const data = await resp.json();
  const venues = data?.results?.venues || [];
  return (venues[0]?.slots || []).map(s => ({
    time: s.date?.start || s.date?.end || '',
    type: s.config?.type || 'dining_room'
  }));
}

// ── Main check for one restaurant ────────────────────────────────────────────
async function checkOne(name, url, date, partySize) {
  const slug = extractResySlug(url);
  if (!slug) return null;

  let slots = null;

  try {
    // Step 1: resolve venue ID
    const venueResp = await fetch(
      `https://api.resy.com/3/venue?url_slug=${slug}&location=ny`,
      { headers: RESY_HEADERS }
    );
    if (venueResp.ok) {
      const venueData = await venueResp.json();
      const venueId = venueData?.id?.resy;
      if (venueId) {
        slots = await fetchByVenueId(venueId, date, partySize);
      }
    }

    // Step 2: fallback to slug-based search
    if (slots === null) {
      slots = await fetchBySlug(slug, date, partySize);
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
    const { has_early, has_prime, has_late } = tier === 'booked'
      ? { has_early: false, has_prime: false, has_late: false }
      : buildTimeFlags(slots);

    return { tier, dinner_slots: dinnerSlots, has_early, has_prime, has_late };

  } catch (e) {
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
  let success = 0, fail = 0;

  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    process.stdout.write(`  [${i + 1}/${list.length}] ${r.name.substring(0, 38).padEnd(38)} `);

    const result = await checkOne(r.name, r.url, CHECK_DATE, PARTY_SIZE);
    const key = r.name.toLowerCase().trim();

    if (result) {
      output[key] = {
        tier:         result.tier,
        dinner_slots: result.dinner_slots,
        has_early:    result.has_early,
        has_prime:    result.has_prime,
        has_late:     result.has_late,
        _checked_date: TODAY
      };

      const EMOJI = { booked: '⚫', limited: '🟠', open: '🟢' };
      const timeStr = [
        result.has_early && 'Early',
        result.has_prime && 'Prime',
        result.has_late  && 'Late'
      ].filter(Boolean).join('/') || (result.tier === 'booked' ? 'none' : '—');

      console.log(`${EMOJI[result.tier] || '⚪'} ${result.tier.padEnd(7)} [${timeStr}] (${result.dinner_slots} dinner slots)`);
      success++;
    } else {
      // Don't overwrite existing good data on a failed check
      if (!output[key]) {
        output[key] = { tier: null, dinner_slots: 0, has_early: false, has_prime: false, has_late: false, _checked_date: TODAY };
      }
      console.log(`❌ failed`);
      fail++;
    }

    // Save every 25
    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
      console.log(`    💾 Progress saved (${i + 1}/${list.length})`);
    }

    await sleep(1500);
  }

  // Final save
  output._meta = {
    last_run: TODAY, checked_date: CHECK_DATE,
    party_size: PARTY_SIZE, checked: success, failed: fail
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  // Summary
  const counts = { booked: 0, limited: 0, open: 0, null: 0 };
  for (const [k, v] of Object.entries(output)) {
    if (k.startsWith('_')) continue;
    counts[v.tier ?? 'null']++;
  }

  console.log(`\n${'═'.repeat(45)}`);
  console.log('📊 RESULTS');
  console.log(`   ✅ Success: ${success}  ❌ Failed: ${fail}`);
  console.log(`   ⚫ Booked:  ${counts.booked}`);
  console.log(`   🟠 Limited: ${counts.limited}`);
  console.log(`   🟢 Open:    ${counts.open}`);
  console.log(`\n💾 Saved → ${OUTPUT_FILE}`);
  console.log('✅ Done!\n');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
