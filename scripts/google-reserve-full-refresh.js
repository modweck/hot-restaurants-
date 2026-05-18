/**
 * google-reserve-full-refresh.js
 *
 * Full refresh:
 *   Step 1: Google API check on outside-Manhattan website restaurants (find reservable ones)
 *   Step 2: Phase 1 - Get Reserve IDs for all new reservable restaurants
 *   Step 3: Phase 2 - Scrape availability for ALL google_reserve restaurants
 *   Step 4: Phase 3 - Check future dates for booked ones
 *
 * RUN: node scripts/google-reserve-full-refresh.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const BM_PATH = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const SCRAPER_PATH = path.join(__dirname, '..', 'netlify', 'functions', 'google-reserve-scraper.js');
// Random pick from rotation pool (set in .env as GOOGLE_API_KEYS, comma-separated)
const _keyPool = (process.env.GOOGLE_API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
const API_KEY = _keyPool.length > 0 ? _keyPool[Math.floor(Math.random() * _keyPool.length)] : (process.env.GOOGLE_PLACES_API_KEY || '');
if (!API_KEY) { console.error('No Google API key available'); process.exit(1); }

function googlePlacesCheck(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ textQuery: query, maxResultCount: 1 });
    const options = {
      hostname: 'places.googleapis.com',
      path: '/v1/places:searchText',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.id,places.reservable'
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('═══ GOOGLE RESERVE FULL REFRESH ═══\n');

  // Load BOOKING_MASTER
  const bm = JSON.parse(fs.readFileSync(BM_PATH, 'utf8'));

  // ── STEP 1: Find reservable restaurants outside Manhattan ──
  console.log('── STEP 1: Checking outside-Manhattan website restaurants via Google API ──\n');

  const outsideKeywords = ['brooklyn', 'queens', 'bronx', 'staten island', 'flushing', 'astoria',
    'long island', 'jersey', 'edgewater', 'great neck', 'bayside', 'hollis', 'woodside',
    'elmhurst', 'jackson heights'];

  const websiteOutside = Object.entries(bm).filter(([_, v]) => {
    if (v.platform !== 'website') return false;
    const addr = (v.address || '').toLowerCase();
    return outsideKeywords.some(k => addr.includes(k));
  });

  console.log(`  Found ${websiteOutside.length} outside-Manhattan website restaurants`);

  let newReservable = 0;
  let checked = 0;

  for (const [name, v] of websiteOutside) {
    checked++;
    try {
      const result = await googlePlacesCheck(`${name} restaurant NYC`);
      if (result.places && result.places[0] && result.places[0].reservable) {
        bm[name].platform = 'google_reserve';
        bm[name].place_id = result.places[0].id;
        newReservable++;
      }
    } catch(e) {}

    if (checked % 100 === 0) {
      console.log(`  [${checked}/${websiteOutside.length}] found ${newReservable} reservable so far`);
    }
  }

  console.log(`  ✅ Step 1 done: ${newReservable} new reservable out of ${websiteOutside.length}\n`);

  // Save updated BOOKING_MASTER
  fs.writeFileSync(BM_PATH, JSON.stringify(bm, null, 2));
  console.log('  📁 Saved BOOKING_MASTER\n');

  // ── STEP 2 & 3: Run the scraper (Phase 1 + Phase 2 + Phase 3) ──
  console.log('── STEP 2: Running Google Reserve scraper (Phase 1 + 2 + 3) ──\n');

  const { execSync } = require('child_process');
  try {
    execSync(`node ${SCRAPER_PATH} --all`, {
      stdio: 'inherit',
      cwd: path.dirname(SCRAPER_PATH),
      timeout: 3600000 // 1 hour max
    });
  } catch(e) {
    console.log('Scraper finished (or timed out)');
  }

  // ── Final summary ──
  console.log('\n═══ FULL REFRESH COMPLETE ═══');

  try {
    const googleFile = path.join(__dirname, '..', 'netlify', 'functions', 'tonight_availability_google.json');
    const google = JSON.parse(fs.readFileSync(googleFile, 'utf8'));
    const entries = Object.entries(google).filter(([k]) => k !== '_meta');
    const open = entries.filter(([_, v]) => v.tier === 'open').length;
    const limited = entries.filter(([_, v]) => v.tier === 'limited').length;
    const booked = entries.filter(([_, v]) => v.tier === 'booked').length;
    console.log(`  Total: ${entries.length}`);
    console.log(`  🟢 Open: ${open}`);
    console.log(`  🟡 Limited: ${limited}`);
    console.log(`  🔴 Booked: ${booked}`);
  } catch(e) {
    console.log('  Could not read final results');
  }
}

main().catch(console.error);
