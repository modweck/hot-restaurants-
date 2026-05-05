/**
 * resy-locked-future-check.js
 *
 * Checks +21 and +28 day availability for restaurants currently marked
 * as fully_locked in tonight_availability.json.
 *
 * RUN:   node scripts/resy-locked-future-check.js
 */

const fs = require('fs');
const path = require('path');

const FUNCS = path.join(__dirname, '..', 'netlify', 'functions');
const AVAIL_FILE = path.join(FUNCS, 'tonight_availability.json');
const BOOKING_FILE = path.join(FUNCS, 'booking_lookup.json');

const PARTY_SIZE = 2;
const TODAY = new Date().toISOString().split('T')[0];
const OFFSETS = [21, 28];

function futureDate(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Load data
let availability = {};
try { availability = JSON.parse(fs.readFileSync(AVAIL_FILE, 'utf8')); }
catch (e) { console.error('Cannot load tonight_availability.json'); process.exit(1); }

let BOOKING_LOOKUP = {};
try { BOOKING_LOOKUP = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8')); }
catch (e) { console.error('Cannot load booking_lookup.json'); process.exit(1); }

function extractResySlug(url) {
  if (!url) return null;
  const m1 = url.match(/resy\.com\/cities\/[a-z-]+\/([a-z0-9_-]+)\/?$/i);
  if (m1) return m1[1].toLowerCase();
  const m2 = url.match(/venues\/([a-z0-9_-]+)\/?$/i);
  if (m2) return m2[1].toLowerCase();
  return null;
}

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

// Build list of locked restaurants
const lockedList = Object.entries(availability)
  .filter(([k, v]) => !k.startsWith('_') && v.fully_locked && !v.not_bookable)
  .map(([name]) => name)
  .filter(name => {
    const info = BOOKING_LOOKUP[name] || BOOKING_LOOKUP[Object.keys(BOOKING_LOOKUP).find(k => k.toLowerCase() === name)];
    return info && info.platform === 'resy' && info.url;
  });

async function resolveVenueId(slug, lookupEntry) {
  if (lookupEntry?.venue_id) return lookupEntry.venue_id;
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
        if (id) return id;
      } catch {}
    }
  }
  return null;
}

async function main() {
  console.log('\n🔮 RESY LOCKED FUTURE CHECK (+21/+28 days)');
  console.log(`📅 Today: ${TODAY}  👥 Party: ${PARTY_SIZE}`);
  console.log(`🎯 Checking: ${lockedList.length} locked restaurants`);
  console.log('─────────────────────────────────────\n');

  let found = 0, stillLocked = 0, failed = 0;
  let consecutiveFails = 0;

  for (let i = 0; i < lockedList.length; i++) {
    const name = lockedList[i];
    const key = name.toLowerCase();
    const lookupEntry = BOOKING_LOOKUP[name] || BOOKING_LOOKUP[key] || BOOKING_LOOKUP[Object.keys(BOOKING_LOOKUP).find(k => k.toLowerCase() === key)];
    const slug = extractResySlug(lookupEntry?.url);

    if (!slug) {
      console.log(`  ❌ [${i+1}/${lockedList.length}] ${name}: no slug`);
      failed++;
      continue;
    }

    const venueId = await resolveVenueId(slug, lookupEntry);
    if (!venueId) {
      console.log(`  ❌ [${i+1}/${lockedList.length}] ${name}: no venue ID`);
      failed++;
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
    let opensIn = null;

    try {
      const resp = await fetch(
        `https://api.resy.com/4/venue/calendar?venue_id=${venueId}&num_seats=${PARTY_SIZE}&start_date=${futureDate(15)}&end_date=${futureDate(28)}`,
        { headers: getHeaders(), signal: AbortSignal.timeout(10000) }
      );

      if (resp.ok) {
        const data = await resp.json();
        const scheduled = data?.scheduled || [];

        // Check target offset dates first
        const targetDates = OFFSETS.map(o => futureDate(o));
        for (let d = 0; d < targetDates.length; d++) {
          const day = scheduled.find(s => s.date === targetDates[d]);
          if (day && day.inventory?.reservation === 'available') {
            opensIn = OFFSETS[d];
            break;
          }
        }

        // If not on exact dates, check any available day in range
        if (!opensIn) {
          const anyAvailable = scheduled.find(s => s.inventory?.reservation === 'available');
          if (anyAvailable) {
            const diffMs = new Date(anyAvailable.date) - new Date(TODAY);
            opensIn = Math.round(diffMs / 86400000);
          }
        }
      }
    } catch {}

    if (opensIn) {
      availability[key].opens_in = opensIn;
      delete availability[key].fully_locked;
      found++;
      console.log(`  🟢 [${i+1}/${lockedList.length}] ${name}: opens in +${opensIn}d`);
    } else {
      stillLocked++;
      console.log(`  🔒 [${i+1}/${lockedList.length}] ${name}: still locked`);
    }

    // Save every 25
    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(AVAIL_FILE, JSON.stringify(availability, null, 2));
      console.log(`    💾 Progress saved`);
    }

    await sleep(5000);
  }

  // Final save
  fs.writeFileSync(AVAIL_FILE, JSON.stringify(availability, null, 2));

  console.log(`\n${'═'.repeat(45)}`);
  console.log(`📊 RESULTS`);
  console.log(`   🟢 Opens up: ${found}`);
  console.log(`   🔒 Still locked: ${stillLocked}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`\n💾 Saved → ${AVAIL_FILE}`);
}

main().catch(console.error);
