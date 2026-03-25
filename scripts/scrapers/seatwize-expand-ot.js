#!/usr/bin/env node
/**
 * SEATWIZE OPENTABLE EXPANDER v2
 * ================================
 * Uses OpenTable's search API to find restaurant links.
 * Much faster and more accurate than slug guessing.
 *
 * RUN:
 *   cd ~/ai-concierge-
 *   node seatwize-expand-ot.js
 *
 * OPTIONS:
 *   --quick             Only process 30 restaurants (for testing)
 *   --limit 100         Process N restaurants
 *   --skip-availability Skip availability checks
 *   --date 2026-03-01   Date for availability (default: tomorrow)
 *   --party 2           Party size (default: 2)
 */

const fs = require('fs');
const path = require('path');

// ── Config ──
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const QUICK = args.includes('--quick');
const LIMIT = QUICK ? 30 : parseInt(getArg('limit', '9999'), 10);
const SKIP_AVAILABILITY = args.includes('--skip-availability');
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
const CHECK_DATE = getArg('date', tomorrow.toISOString().split('T')[0]);

// ── File paths ──
const FUNC_DIR = path.join(__dirname, 'netlify', 'functions');
const POPULAR_FILE = path.join(FUNC_DIR, 'popular_nyc.json');
const BOOKING_FILE = path.join(FUNC_DIR, 'booking_lookup.json');
const AVAIL_FILE = path.join(FUNC_DIR, 'availability_data.json');
const EXPAND_RESULTS = path.join(__dirname, 'expand-results.json');
const OT_RESULTS_FILE = path.join(__dirname, 'expand-results-ot.json');

// ── Load data ──
let POPULAR = []; try { POPULAR = JSON.parse(fs.readFileSync(POPULAR_FILE, 'utf8')); } catch(e) { console.log('⚠️  No popular_nyc.json'); }
let BOOKING = {}; try { BOOKING = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8')); } catch(e) { console.log('⚠️  No booking_lookup.json'); }
let AVAIL_DATA = {}; try { AVAIL_DATA = JSON.parse(fs.readFileSync(AVAIL_FILE, 'utf8')); } catch(e) {}
let EXPAND = null; try { EXPAND = JSON.parse(fs.readFileSync(EXPAND_RESULTS, 'utf8')); } catch(e) {}

// Build set of restaurants that already have bookings
const hasBooking = new Set();
for (const [k, v] of Object.entries(BOOKING)) {
  hasBooking.add(k.toLowerCase().trim());
}

console.log(`\n🍽️  SEATWIZE OPENTABLE EXPANDER v2`);
console.log(`${'='.repeat(50)}`);
console.log(`📊 Existing: ${Object.keys(BOOKING).length} bookings, ${POPULAR.length} popular`);
console.log(`📊 Already have booking links: ${hasBooking.size}`);

// ── Helpers ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normName(s) {
  return s.toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`'.!?,;:\-–—()\[\]{}\"]/g, '')
    .replace(/&/g, 'and')
    .replace(/\s+/g, ' ').trim();
}

function namesMatch(ourName, otName) {
  const a = normName(ourName);
  const b = normName(otName);
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const wordsA = a.split(' ').filter(w => w.length > 2);
  const wordsB = b.split(' ').filter(w => w.length > 2);
  if (wordsA.length === 0 || wordsB.length === 0) return false;
  const common = wordsA.filter(w => wordsB.includes(w));
  const overlap = common.length / Math.min(wordsA.length, wordsB.length);
  return overlap >= 0.6;
}

// ── OpenTable Search ──
async function findOnOpenTable(name, lat, lng) {
  const latitude = lat || 40.7128;
  const longitude = lng || -74.006;

  // Method 1: Autocomplete/search API (GraphQL)
  try {
    const variables = JSON.stringify({
      term: name,
      latitude,
      longitude,
      useNewVersion: true
    });
    const url = `https://www.opentable.com/dapi/fe/gql?operation=Autocomplete&variables=${encodeURIComponent(variables)}`;
    
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.opentable.com/',
      }
    });
    
    if (resp.ok) {
      const data = await resp.json();
      const restaurants = data?.data?.autocomplete?.restaurants || [];
      
      for (const r of restaurants) {
        const otName = r.name || '';
        if (namesMatch(name, otName)) {
          const rid = r.rid || r.restaurantId || null;
          const link = r.profileLink || 
            (r.urlSlug ? `https://www.opentable.com/r/${r.urlSlug}` : null) ||
            (rid ? `https://www.opentable.com/restref/client/?rid=${rid}` : null);
          
          return {
            found: true,
            platform: 'opentable',
            name: otName,
            restaurant_id: rid,
            url: link || `https://www.opentable.com/s?term=${encodeURIComponent(name)}`,
          };
        }
      }
    }
  } catch(e) { /* continue to next method */ }
  
  await sleep(300);

  // Method 2: Direct slug check (common OT patterns)
  const slug = name.toLowerCase()
    .replace(/['']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  
  const slugVariants = [slug];
  // Add -new-york suffix
  slugVariants.push(`${slug}-new-york`);
  // Remove common suffixes
  const shortened = slug.replace(/-restaurant$/, '').replace(/-nyc$/, '').replace(/-new-york$/, '');
  if (shortened !== slug) {
    slugVariants.push(shortened);
    slugVariants.push(`${shortened}-new-york`);
  }
  
  for (const s of [...new Set(slugVariants)]) {
    try {
      const pageUrl = `https://www.opentable.com/r/${s}`;
      const resp = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html',
        },
        redirect: 'follow'
      });
      
      if (resp.ok) {
        const html = await resp.text();
        if (html.includes('data-restaurant-id') || 
            html.includes('"restaurantId"') ||
            html.includes('RestaurantProfile') ||
            html.includes('og:type" content="restaurant"')) {
          
          let rid = null;
          const m = html.match(/data-restaurant-id="(\d+)"/) || 
                    html.match(/"rid"\s*:\s*(\d+)/) ||
                    html.match(/"restaurantId"\s*:\s*(\d+)/) ||
                    html.match(/rid=(\d+)/);
          if (m) rid = m[1];
          
          const titleMatch = html.match(/<title>([^<]+)/);
          const pageTitle = titleMatch ? titleMatch[1].replace(/ \| OpenTable.*/, '').replace(/ - .*$/, '').trim() : name;
          
          // Verify name match
          if (namesMatch(name, pageTitle)) {
            return {
              found: true,
              platform: 'opentable',
              name: pageTitle,
              restaurant_id: rid,
              url: resp.url || pageUrl,
            };
          }
        }
      }
    } catch(e) {}
    await sleep(200);
  }
  
  return null;
}

// Check availability
async function checkOTAvailability(restaurantId, date, partySize) {
  if (!restaurantId) return null;
  
  try {
    const url = `https://www.opentable.com/dapi/availability?rid=${restaurantId}&partySize=${partySize}&dateTime=${date}T19:00&enableFutureAvailability=true`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.opentable.com/',
      }
    });
    
    if (resp.ok) {
      const data = await resp.json();
      const slots = data?.availability?.timeSlots || data?.timeSlots || [];
      const windows = { early: 0, prime: 0, late: 0 };
      for (const slot of slots) {
        const time = slot.dateTime || slot.time || '';
        const hour = parseInt(time.split('T')[1]?.split(':')[0] || time.split(':')[0] || '0');
        if (hour < 18) windows.early++;
        else if (hour <= 20) windows.prime++;
        else windows.late++;
      }
      return { available: slots.length > 0, slots: slots.length, windows };
    }
  } catch(e) {}
  
  return null;
}

function getTier(totalSlots) {
  if (totalSlots === 0) return 'sold_out';
  if (totalSlots <= 2) return 'nearly_full';
  if (totalSlots <= 5) return 'limited';
  if (totalSlots <= 10) return 'moderate';
  return 'available';
}

function getWindowTier(count) {
  if (count === 0) return 'hard';
  if (count <= 2) return 'medium';
  return 'easy';
}

// ── Build candidate list ──
function buildCandidates() {
  const candidates = [];
  const seen = new Set();
  
  function addCandidate(name, lat, lng, source) {
    const key = normName(name);
    if (seen.has(key)) return;
    if (hasBooking.has(name.toLowerCase().trim())) return;
    for (const bk of hasBooking) {
      if (normName(bk) === key) return;
    }
    seen.add(key);
    candidates.push({ name, lat, lng, source });
  }
  
  if (EXPAND?.notFoundOnResy) {
    for (const r of EXPAND.notFoundOnResy) {
      addCandidate(r.name, r.lat, r.lng, 'expand');
    }
  }
  
  for (const r of POPULAR) {
    if (r.booking_platform || r.booking_url) continue;
    const lat = r.geometry?.location?.lat || r.lat || null;
    const lng = r.geometry?.location?.lng || r.lng || null;
    addCandidate(r.name, lat, lng, 'popular');
  }
  
  return candidates;
}

// ── Main ──
async function main() {
  const startTime = Date.now();
  const candidates = buildCandidates();
  const toProcess = candidates.slice(0, LIMIT);
  
  console.log(`\n📋 Candidates without bookings: ${candidates.length}`);
  console.log(`  🔍 Processing: ${toProcess.length}${QUICK ? ' (quick mode)' : ''}`);
  console.log(`  📅 Date: ${CHECK_DATE}, Party: ${PARTY_SIZE}\n`);
  
  const found = [];
  const notFound = [];
  
  for (let i = 0; i < toProcess.length; i++) {
    const c = toProcess[i];
    process.stdout.write(`  [${i+1}/${toProcess.length}] ${c.name}... `);
    
    try {
      const result = await findOnOpenTable(c.name, c.lat, c.lng);
      if (result) {
        console.log(`✅ Found! (ID: ${result.restaurant_id || 'N/A'})`);
        found.push({ ...c, ot: result });
      } else {
        console.log(`❌`);
        notFound.push(c);
      }
    } catch(err) {
      console.log(`⚠️ ${err.message}`);
      notFound.push(c);
    }
    
    await sleep(600);
  }
  
  console.log(`\n📊 Search: ✅ ${found.length} found, ❌ ${notFound.length} not found`);
  
  if (found.length === 0) {
    console.log('\n😔 No new OpenTable restaurants found.');
    return;
  }
  
  // ── Availability ──
  if (!SKIP_AVAILABILITY) {
    console.log(`\n📅 Checking availability...\n`);
    for (let i = 0; i < found.length; i++) {
      const r = found[i];
      process.stdout.write(`  [${i+1}/${found.length}] ${r.name}... `);
      if (!r.ot.restaurant_id) { console.log('⏭️ No ID'); r.availability = null; continue; }
      
      try {
        const avail = await checkOTAvailability(r.ot.restaurant_id, CHECK_DATE, PARTY_SIZE);
        r.availability = avail;
        if (avail) {
          console.log(`${avail.available ? '🟢' : '🔴'} ${avail.slots} slots (E:${avail.windows?.early || 0} P:${avail.windows?.prime || 0} L:${avail.windows?.late || 0})`);
        } else {
          console.log('⏭️ No data');
        }
      } catch(err) { console.log(`⚠️ ${err.message}`); r.availability = null; }
      await sleep(800);
    }
  }
  
  // ── Save to files ──
  let bookingAdded = 0;
  for (const r of found) {
    if (!BOOKING[r.name]) {
      BOOKING[r.name] = { platform: 'opentable', url: r.ot.url, restaurant_id: r.ot.restaurant_id };
      bookingAdded++;
    }
  }
  if (bookingAdded > 0) fs.writeFileSync(BOOKING_FILE, JSON.stringify(BOOKING, null, 2));
  
  let availAdded = 0;
  for (const r of found) {
    if (!r.availability?.available) continue;
    const key = r.name.toLowerCase().trim();
    AVAIL_DATA[key] = {
      tier: getTier(r.availability.slots),
      total_slots: r.availability.slots,
      source: 'opentable',
      checked: CHECK_DATE,
      windows: {
        early: getWindowTier(r.availability.windows?.early || 0),
        prime: getWindowTier(r.availability.windows?.prime || 0),
        late: getWindowTier(r.availability.windows?.late || 0)
      }
    };
    availAdded++;
  }
  if (availAdded > 0) fs.writeFileSync(AVAIL_FILE, JSON.stringify(AVAIL_DATA, null, 2));
  
  let popularUpdated = 0;
  const foundByName = new Map(found.map(r => [r.name.toLowerCase().trim(), r]));
  for (const p of POPULAR) {
    const match = foundByName.get(p.name?.toLowerCase().trim());
    if (match && !p.booking_platform) {
      p.booking_platform = 'opentable';
      p.booking_url = match.ot.url;
      popularUpdated++;
    }
  }
  if (popularUpdated > 0) fs.writeFileSync(POPULAR_FILE, JSON.stringify(POPULAR, null, 2));
  
  // Save report
  fs.writeFileSync(OT_RESULTS_FILE, JSON.stringify({
    timestamp: new Date().toISOString(),
    date: CHECK_DATE, partySize: PARTY_SIZE,
    totalChecked: toProcess.length, foundCount: found.length,
    found: found.map(r => ({ name: r.name, otName: r.ot.name, url: r.ot.url, rid: r.ot.restaurant_id, slots: r.availability?.slots || 0, source: r.source })),
    notFound: notFound.map(r => r.name)
  }, null, 2));
  
  const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`🎉 Done in ${elapsed} min`);
  console.log(`  📝 +${bookingAdded} booking links`);
  console.log(`  📝 +${availAdded} availability entries`);
  console.log(`  📝 +${popularUpdated} popular_nyc updated`);
  console.log(`  📄 Results: expand-results-ot.json\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
