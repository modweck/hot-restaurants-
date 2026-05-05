/**
 * resy-future-avail-booked186.js
 *
 * Checks future availability (+2 to +21 days) for Resy restaurants
 * that were fully booked on the last tonight check.
 *
 * RUN:   node scripts/resy-future-avail-booked186.js
 *
 * OPTIONS:
 *   --quick    Only check first 10
 *   --debug    Verbose output
 *
 * OUTPUT: data/resy_future_booked_186.json
 */

const fs = require('fs');
const path = require('path');

const FUNCS = path.join(__dirname, '..', 'netlify', 'functions');
const BOOKING_FILE = path.join(FUNCS, 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'resy_future_booked_186.json');

const PARTY_SIZE = 2;
const TODAY = new Date().toISOString().split('T')[0];

function futureDate(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const args = process.argv.slice(2);
const QUICK_MODE = args.includes('--quick');
const DEBUG = args.includes('--debug');

// ── Resy API ──
const RESY_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const RESY_TOKENS = [
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

function extractResySlug(url) {
  if (!url) return null;
  const m1 = url.match(/resy\.com\/cities\/[a-z-]+\/([a-z0-9_-]+)\/?$/i);
  if (m1) return m1[1].toLowerCase();
  const m2 = url.match(/venues\/([a-z0-9_-]+)\/?$/i);
  if (m2) return m2[1].toLowerCase();
  return null;
}

async function resolveVenueId(slug, lookupEntry) {
  if (lookupEntry?.venue_id) return lookupEntry.venue_id;
  if (lookupEntry?.resy_venue_id) return lookupEntry.resy_venue_id;
  const slugsToTry = new Set([slug]);
  const short = slug.replace(/-new-york$/, '');
  if (short !== slug) slugsToTry.add(short);
  for (const s of slugsToTry) {
    for (const loc of ['new-york-ny', 'ny']) {
      try {
        const resp = await fetch(`https://api.resy.com/3/venue?url_slug=${s}&location=${loc}`, { headers: getHeaders(), signal: AbortSignal.timeout(10000) });
        if (!resp.ok) continue;
        const data = await resp.json();
        const id = data?.id?.resy;
        if (id) return id;
      } catch {}
    }
  }
  return null;
}

// ── Load data ──
let BOOKING_MASTER = {};
try {
  BOOKING_MASTER = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));
  console.log(`✅ Loaded BOOKING_MASTER: ${Object.keys(BOOKING_MASTER).length} restaurants`);
} catch (e) {
  console.error('❌ Cannot load BOOKING_MASTER.json');
  process.exit(1);
}

// Load booked list from Desktop tonight_availability
let tonightData = {};
try {
  tonightData = JSON.parse(fs.readFileSync('/Users/mauricedweck/Desktop/tonight_availability.json', 'utf8'));
} catch (e) {
  console.error('❌ Cannot load tonight_availability.json from Desktop');
  process.exit(1);
}

// Get booked Resy restaurants
const bookedResy = Object.entries(tonightData)
  .filter(([name, info]) => {
    if (info.tier !== 'booked') return false;
    const m = BOOKING_MASTER[name] || BOOKING_MASTER[Object.keys(BOOKING_MASTER).find(k => k.toLowerCase() === name.toLowerCase())] || {};
    return m.platform === 'resy';
  })
  .map(([name]) => name);

console.log(`🔴 Found ${bookedResy.length} booked Resy restaurants`);
console.log(`📅 Checking: ${futureDate(2)} to ${futureDate(21)}\n`);

// Load existing results
let existing = {};
try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}

// ── Main ──
async function main() {
  let toCheck = [...bookedResy];
  if (QUICK_MODE) toCheck = toCheck.slice(0, 10);

  // Skip already checked
  const already = toCheck.filter(n => existing[n]);
  toCheck = toCheck.filter(n => !existing[n]);
  if (already.length > 0) console.log(`⏭️  Skipping ${already.length} already checked`);

  console.log(`🔍 Checking ${toCheck.length} restaurants\n`);

  const results = { ...existing };
  let checked = 0, opensUp = 0, locked = 0, failed = 0;
  let consecutiveFails = 0;

  for (const name of toCheck) {
    const key = name.toLowerCase();
    const lookupEntry = BOOKING_MASTER[name] || BOOKING_MASTER[Object.keys(BOOKING_MASTER).find(k => k.toLowerCase() === key)] || {};
    const slug = extractResySlug(lookupEntry?.url);

    if (!slug) {
      console.log(`  ❌ [${checked+1}/${toCheck.length}] ${name}: no slug`);
      results[name] = { error: 'no_slug', checked_date: TODAY };
      failed++;
      checked++;
      continue;
    }

    const venueId = await resolveVenueId(slug, lookupEntry);
    if (!venueId) {
      console.log(`  ❌ [${checked+1}/${toCheck.length}] ${name}: no venue ID`);
      results[name] = { error: 'no_venue_id', slug, checked_date: TODAY };
      failed++;
      checked++;
      consecutiveFails++;
      if (consecutiveFails >= 5) {
        console.log(`     ⏸️ backing off 30s`);
        await sleep(30000);
        consecutiveFails = 0;
      }
      await sleep(3000);
      continue;
    }

    consecutiveFails = 0;

    try {
      // One API call covers the whole range +2 to +21
      const resp = await fetch(
        `https://api.resy.com/4/venue/calendar?venue_id=${venueId}&num_seats=${PARTY_SIZE}&start_date=${futureDate(2)}&end_date=${futureDate(21)}`,
        { headers: getHeaders(), signal: AbortSignal.timeout(10000) }
      );

      if (resp.ok) {
        const data = await resp.json();
        const scheduled = data?.scheduled || [];

        // Find all available dates
        const availDates = {};
        let firstAvail = null;
        for (const day of scheduled) {
          if (day.inventory?.reservation === 'available') {
            const diffMs = new Date(day.date) - new Date(TODAY);
            const offset = Math.round(diffMs / 86400000);
            availDates[`+${offset}d`] = day.date;
            if (!firstAvail) firstAvail = { date: day.date, offset };
          }
        }

        if (firstAvail) {
          results[name] = {
            venue_id: venueId,
            slug,
            opens_in: firstAvail.offset,
            opens_date: firstAvail.date,
            available_dates: availDates,
            total_available_days: Object.keys(availDates).length,
            checked_date: TODAY,
          };
          opensUp++;
          console.log(`  🟢 [${checked+1}/${toCheck.length}] ${name}: opens +${firstAvail.offset}d (${Object.keys(availDates).length} days avail)`);
        } else {
          results[name] = {
            venue_id: venueId,
            slug,
            fully_locked: true,
            available_dates: {},
            total_available_days: 0,
            checked_date: TODAY,
          };
          locked++;
          console.log(`  🔒 [${checked+1}/${toCheck.length}] ${name}: locked through +21d`);
        }
      } else {
        const status = resp.status;
        results[name] = { error: `http_${status}`, slug, venue_id: venueId, checked_date: TODAY };
        failed++;
        console.log(`  ⚠️  [${checked+1}/${toCheck.length}] ${name}: HTTP ${status}`);
        if (status === 429) {
          console.log(`     ⏸️ rate limited, backing off 60s`);
          await sleep(60000);
        }
      }
    } catch (e) {
      results[name] = { error: e.message?.slice(0, 50), slug, venue_id: venueId, checked_date: TODAY };
      failed++;
      console.log(`  ⚠️  [${checked+1}/${toCheck.length}] ${name}: ${e.message?.slice(0, 40)}`);
    }

    checked++;

    // Save every 20
    if (checked % 20 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
      console.log(`    💾 Progress saved (${checked}/${toCheck.length})`);
    }

    await sleep(3000);
  }

  // Final save
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Done! Checked ${checked} Resy restaurants`);
  console.log(`   🟢 Opens up: ${opensUp}  🔒 Locked: ${locked}  ❌ Failed: ${failed}`);
  console.log(`   Output: ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
