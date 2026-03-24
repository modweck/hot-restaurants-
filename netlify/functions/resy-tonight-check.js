/**
 * resy-tonight-check.js
 *
 * Checks Resy availability for ALL restaurants in BOOKING_MASTER.json
 * for TONIGHT (dinner slots 6pm-10pm).
 *
 * RUN:   node resy-tonight-check.js
 *
 * OPTIONS:
 *   --party 2      Party size (default: 2)
 *   --quick        Only check first 50 (for testing)
 *   --all          Re-check even ones already checked tonight
 *
 * OUTPUT: tonight_availability.json
 */

const fs = require('fs');
const path = require('path');

const fetch = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args);
  try { return require('node-fetch')(...args); }
  catch (e) { throw new Error("fetch not available. Use Node 18+ or add node-fetch."); }
};

// ── CLI args ──
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}
const QUICK_MODE = args.includes('--quick');
const CHECK_ALL  = args.includes('--all');
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);

// Always tonight
const TODAY = new Date().toISOString().split('T')[0];
const CHECK_DATE = TODAY;

const MASTER_FILE = path.join(__dirname, 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, 'tonight_availability.json');

// ── Load files ──
let BOOKING_MASTER = {};
try {
  BOOKING_MASTER = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
  console.log(`✅ Loaded BOOKING_MASTER: ${Object.keys(BOOKING_MASTER).length} restaurants`);
} catch (e) {
  console.error('❌ Cannot load BOOKING_MASTER.json — make sure it is in the same folder');
  process.exit(1);
}

let EXISTING = {};
try {
  EXISTING = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  console.log(`✅ Loaded existing tonight_availability.json`);
} catch (e) {
  // Fine — first run
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractResySlug(url) {
  if (!url) return null;
  const m = url.match(/resy\.com\/cities\/[a-z-]+\/([a-z0-9-]+)\/?/i);
  return m ? m[1] : null;
}

// ── FIX: correct hour extraction from Resy time strings ──
// Resy returns times like "2026-03-20 18:30:00" — the old regex was
// matching "20" (the day) instead of "18" (the hour).
function getHour(timeStr) {
  if (!timeStr) return null;
  // Try full datetime format first: "2026-03-20 18:30:00"
  const full = timeStr.match(/\d{4}-\d{2}-\d{2} (\d{2}):(\d{2})/);
  if (full) return parseInt(full[1]);
  // Fallback: bare time "18:30:00" or "18:30"
  const bare = timeStr.match(/^(\d{2}):(\d{2})/);
  if (bare) return parseInt(bare[1]);
  return null;
}

function getMinute(timeStr) {
  if (!timeStr) return '00';
  const full = timeStr.match(/\d{4}-\d{2}-\d{2} \d{2}:(\d{2})/);
  if (full) return full[1];
  const bare = timeStr.match(/^\d{2}:(\d{2})/);
  if (bare) return bare[1];
  return '00';
}

function formatTime(timeStr) {
  const h24 = getHour(timeStr);
  if (h24 === null) return null;
  const min = getMinute(timeStr);
  const h12 = h24 > 12 ? h24 - 12 : (h24 === 0 ? 12 : h24);
  const ampm = h24 >= 12 ? 'pm' : 'am';
  return `${h12}:${min}${ampm}`;
}

// ── Resy API call ──
async function checkResy(name, url, date, partySize) {
  const slug = extractResySlug(url);
  if (!slug) return { error: 'no_slug', slots: [] };

  const headers = {
    'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
    'X-Resy-Auth-Token': 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzc5MDk0MTQsInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.AWCYkK7wyE0h-KnU7IMnRzUTPpPPh_B7t2ZsXPKg3Pj4uTvQvtGRLLUwG1TYB7yulCfq2U3iD6UdtQgyR4ashAnHAAcrbXK3jAr0BT6YPjHWHadcdlT8KUpeSv2Dixv-PlrW0gfm1eKtocNFz7qn-p14iVgI2YnLZU_KwoUsB3fW0Co1',
    'X-Resy-Universal-Auth': 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzc5MDk0MTQsInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.AWCYkK7wyE0h-KnU7IMnRzUTPpPPh_B7t2ZsXPKg3Pj4uTvQvtGRLLUwG1TYB7yulCfq2U3iD6UdtQgyR4ashAnHAAcrbXK3jAr0BT6YPjHWHadcdlT8KUpeSv2Dixv-PlrW0gfm1eKtocNFz7qn-p14iVgI2YnLZU_KwoUsB3fW0Co1',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'Origin': 'https://resy.com',
    'Referer': 'https://resy.com/',
    'Accept': 'application/json, text/plain, */*'
  };

  try {
    // Step 1: get venue ID from slug — must succeed or we skip
    const venueResp = await fetch(`https://api.resy.com/3/venue?url_slug=${slug}&location=ny`, { headers });
    if (!venueResp.ok) return { error: `venue_http_${venueResp.status}`, slots: [] };

    const venueData = await venueResp.json();
    const venueId = venueData?.id?.resy;
    if (!venueId) return { error: 'no_venue_id', slots: [] };

    // Step 2: check availability with venue ID — restaurant-specific, no fallback
    const availResp = await fetch(
      `https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${date}&party_size=${partySize}&venue_id=${venueId}`,
      { headers }
    );
    if (!availResp.ok) return { error: `avail_http_${availResp.status}`, slots: [] };

    const availData = await availResp.json();
    const slots = (availData?.results?.venues?.[0]?.slots || []).map(s => ({
      time: s.date?.start || '',
      type: s.config?.type || 'dining_room'
    }));
    return { venue_id: venueId, date, party_size: partySize, slots, error: null };

  } catch (e) {
    return { error: e.message, slots: [] };
  }
}

// ── Score slots into a simple tier ──
function scoreTonightSlots(result) {
  if (!result || result.error) {
    return { tier: 'unknown', error: result?.error || 'failed' };
  }

  const slots = result.slots || [];

  // FIX: use getHour() instead of raw regex on the full datetime string
  const dinnerSlots = slots.filter(s => {
    const h = getHour(s.time);
    return h !== null && h >= 18 && h < 22;
  });

  // Early: 5:00–6:30pm | Prime: 6:45–8:30pm | Late: 8:45pm+
  const earlySlots = slots.filter(s => {
    const h = getHour(s.time);
    const m = parseInt(getMinute(s.time) || '0');
    const totalMin = h * 60 + m;
    return totalMin >= 1020 && totalMin < 1110; // 17:00–18:30
  });

  const primeSlots = slots.filter(s => {
    const h = getHour(s.time);
    const m = parseInt(getMinute(s.time) || '0');
    const totalMin = h * 60 + m;
    return totalMin >= 1125 && totalMin < 1230; // 18:45–20:30
  });

  const lateSlots = slots.filter(s => {
    const h = getHour(s.time);
    const m = parseInt(getMinute(s.time) || '0');
    const totalMin = h * 60 + m;
    return totalMin >= 1245; // 20:45+
  });

  const totalSlots = slots.length;
  const allDinnerCount = dinnerSlots.length + earlySlots.length + lateSlots.length;

  let tier;
  if (totalSlots === 0)          tier = 'booked';
  else if (allDinnerCount === 0) tier = 'booked';
  else if (allDinnerCount >= 8)  tier = 'open';
  else if (allDinnerCount >= 3)  tier = 'limited';
  else                           tier = 'limited';

  // FIX: use formatTime() for correct display strings
  const dinnerTimes = [...earlySlots, ...dinnerSlots, ...lateSlots]
    .map(s => formatTime(s.time))
    .filter(Boolean)
    .slice(0, 5);

  // Time window breakdown for UI filters
  const timeWindows = {
    early: earlySlots.length,   // 5-6pm
    prime: primeSlots.length,   // 7-9pm
    late:  lateSlots.length     // 10pm+
  };

  // Has early/late/prime for badge display
  const hasEarly = earlySlots.length > 0 || dinnerSlots.some(s => {
    const h = getHour(s.time);
    return h !== null && h < 19.5;
  });
  const hasLate = lateSlots.length > 0 || dinnerSlots.some(s => {
    const h = getHour(s.time);
    return h !== null && h >= 21;
  });
  const hasPrime = primeSlots.length > 0;

  return {
    tier,
    total_slots: totalSlots,
    dinner_slots: allDinnerCount,
    prime_slots: primeSlots.length,
    sample_times: dinnerTimes,
    time_windows: timeWindows,
    has_early: hasEarly,
    has_prime: hasPrime,
    has_late: hasLate,
    checked_date: CHECK_DATE,
    party_size: PARTY_SIZE,
    platform: 'resy'
  };
}

// ── MAIN ──
async function main() {
  console.log('\n🍽️  RESY TONIGHT AVAILABILITY CHECKER');
  console.log(`📅 Checking: ${CHECK_DATE} (tonight)`);
  console.log(`👥 Party size: ${PARTY_SIZE}`);
  console.log('─────────────────────────────────────\n');

  // Build list from BOOKING_MASTER — Resy only, with valid URL
  const resyList = [];
  const seenSlugs = new Set();

  for (const [name, info] of Object.entries(BOOKING_MASTER)) {
    if (info.platform !== 'resy') continue;
    if (!info.url || !info.url.includes('resy.com')) continue;
    const slug = extractResySlug(info.url);
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    resyList.push({ name, url: info.url, slug });
  }

  console.log(`📊 Total Resy restaurants in BOOKING_MASTER: ${resyList.length}`);

  // Skip already checked tonight unless --all
  let toCheck = resyList;
  if (!CHECK_ALL) {
    const alreadyDone = new Set(
      Object.entries(EXISTING)
        .filter(([k, v]) => !k.startsWith('_') && v.checked_date === CHECK_DATE && v.tier && v.tier !== 'unknown')
        .map(([k]) => k)
    );
    const before = toCheck.length;
    toCheck = toCheck.filter(r => !alreadyDone.has(r.name));
    if (before !== toCheck.length) console.log(`⏭️  Skipping ${before - toCheck.length} already checked tonight`);
  }

  if (QUICK_MODE) {
    toCheck = toCheck.slice(0, 50);
    console.log(`⚡ Quick mode: checking first 50 only`);
  }

  const mins = Math.round(toCheck.length * 1.5 / 60);
  console.log(`🎯 Checking: ${toCheck.length} restaurants`);
  console.log(`⏱️  Estimated time: ~${mins} minutes`);
  console.log(`💾 Saving progress every 25 restaurants\n`);

  const output = { ...EXISTING };
  let success = 0, failed = 0;

  for (let i = 0; i < toCheck.length; i++) {
    const r = toCheck[i];
    process.stdout.write(`  [${String(i+1).padStart(4)}/${toCheck.length}] ${r.name.substring(0,38).padEnd(38)} `);

    const result = await checkResy(r.name, r.url, CHECK_DATE, PARTY_SIZE);
    const scored = scoreTonightSlots(result);

    // Only write to output if we got real data — skip unknown
    if (scored.tier !== 'unknown') {
      output[r.name] = {
        name: r.name,
        url: r.url,
        slug: r.slug,
        ...scored,
        last_checked: TODAY
      };
    }

    const emoji = { open: '🟢', limited: '🟡', booked: '🔴', unknown: '❌' }[scored.tier] || '⚪';
    const times = scored.sample_times?.length ? `  ${scored.sample_times.join(', ')}` : '';
    const windows = scored.tier !== 'unknown'
      ? ` [${scored.has_early ? 'Early' : ''}${scored.has_prime ? ' Prime' : ''}${scored.has_late ? ' Late' : ''}]`.replace(/\[ /, '[')
      : '';
    console.log(`${emoji} ${scored.tier} (${scored.dinner_slots} dinner slots)${windows}${times}`);

    if (scored.tier !== 'unknown') success++; else failed++;

    // Save every 25
    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
      process.stdout.write(`  💾 Saved progress (${i+1}/${toCheck.length})\n`);
    }

    await sleep(3000);
  }

  // Final save with metadata
  output._meta = {
    last_run: TODAY,
    checked_date: CHECK_DATE,
    party_size: PARTY_SIZE,
    total_checked: toCheck.length,
    success,
    failed
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  // Summary
  const tiers = { open: 0, limited: 0, booked: 0, unknown: 0 };
  for (const [k, v] of Object.entries(output)) {
    if (k.startsWith('_')) continue;
    tiers[v.tier] = (tiers[v.tier] || 0) + 1;
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log('📊 TONIGHT SUMMARY:');
  console.log(`   🟢 Open:     ${tiers.open}`);
  console.log(`   🟡 Limited:  ${tiers.limited}`);
  console.log(`   🔴 Booked:   ${tiers.booked}`);
  console.log(`   ❌ Unknown:  ${tiers.unknown}`);
  console.log(`\n   ✅ Success: ${success} | ❌ Failed: ${failed}`);
  console.log(`\n💾 Saved to: tonight_availability.json`);
  console.log('✅ Done!\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
