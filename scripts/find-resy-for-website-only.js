/**
 * find-resy-for-dead-ot.js
 *
 * For restaurants with dead OT links, searches Resy to find a match.
 *
 * TRIPLE VERIFICATION:
 *   1. Name similarity + location within 0.3 miles
 *   2. Slug is active on Resy API (venue endpoint returns valid ID)
 *   3. Availability endpoint confirms it's actually bookable (returns slots or "no availability" — not an error)
 *
 * Only saves matches that pass ALL THREE checks.
 *
 * RUN:   node scripts/find-resy-for-dead-ot.js
 * OPTIONS:
 *   --quick     Only check first 30
 *   --resume    Skip already-checked from previous run
 *
 * OUTPUT: data/resy_replacements.json
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const RESUME = args.includes('--resume');

const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'resy_for_website_only.json');

const MASTER = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));

// Load previous results
let previous = {};
if (RESUME) {
  try {
    previous = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    console.log(`📂 Loaded ${Object.keys(previous.results || {}).length} previous results`);
  } catch (e) { /* first run */ }
}

const RESY_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const RESY_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzc5MDk0MTQsInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.AWCYkK7wyE0h-KnU7IMnRzUTPpPPh_B7t2ZsXPKg3Pj4uTvQvtGRLLUwG1TYB7yulCfq2U3iD6UdtQgyR4ashAnHAAcrbXK3jAr0BT6YPjHWHadcdlT8KUpeSv2Dixv-PlrW0gfm1eKtocNFz7qn-p14iVgI2YnLZU_KwoUsB3fW0Co1';

const RESY_HEADERS = {
  'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
  'X-Resy-Auth-Token': RESY_TOKEN,
  'X-Resy-Universal-Auth': RESY_TOKEN,
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Origin': 'https://resy.com',
  'Referer': 'https://resy.com/'
};

const TODAY = new Date(Date.now() + 86400000).toISOString().split('T')[0]; // tomorrow, since late-night runs won't find today's slots

// ── Helpers ──

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalize(name) {
  return (name || '').toLowerCase()
    .replace(/[''`\u2019]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordOverlap(a, b) {
  const wa = normalize(a).split(' ').filter(Boolean);
  const wb = new Set(normalize(b).split(' ').filter(Boolean));
  if (wa.length === 0) return 0;
  const matches = wa.filter(w => wb.has(w)).length;
  return matches / Math.max(wa.length, wb.size);
}

function namesMatch(masterName, resyName) {
  const a = normalize(masterName);
  const b = normalize(resyName);
  if (a === b) return { match: true, confidence: 'exact' };
  if (a.includes(b) || b.includes(a)) return { match: true, confidence: 'contains' };
  const overlap = wordOverlap(masterName, resyName);
  if (overlap >= 0.7) return { match: true, confidence: `overlap_${Math.round(overlap * 100)}` };
  return { match: false, confidence: `low_${Math.round(overlap * 100)}` };
}

// ── CHECK 1: Resy Search by name + location ──

async function searchResy(name, lat, lng) {
  try {
    const resp = await fetch('https://api.resy.com/3/venuesearch/search', {
      method: 'POST',
      headers: RESY_HEADERS,
      body: JSON.stringify({
        query: name,
        geo: { latitude: lat || 40.7128, longitude: lng || -74.006 },
        types: ['venue'],
        per_page: 5
      })
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.search?.hits || []).map(h => ({
      name: h.name,
      slug: h.url_slug,
      lat: h._geoloc?.lat,
      lng: h._geoloc?.lng,
      id: h.id?.resy,
      location: h.locality,
      neighborhood: h.neighborhood
    }));
  } catch (e) {
    return [];
  }
}

// ── CHECK 2: Verify slug is active (venue endpoint) ──

async function verifySlug(slug) {
  try {
    const resp = await fetch(`https://api.resy.com/3/venue?url_slug=${slug}&location=ny`, {
      headers: RESY_HEADERS
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.id?.resy) return null;
    // Return venue details for extra verification
    return {
      id: data.id.resy,
      name: data.name,
      lat: data.location?.geo?.lat,
      lng: data.location?.geo?.lon
    };
  } catch (e) {
    return null;
  }
}

// ── CHECK 3: Verify actually bookable (availability endpoint) ──

async function verifyBookable(venueId) {
  try {
    const resp = await fetch(
      `https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${TODAY}&party_size=2&venue_id=${venueId}`,
      { headers: RESY_HEADERS }
    );
    if (!resp.ok) return false;
    const data = await resp.json();
    // The venue shows up in results — even 0 slots means it's a real bookable venue
    // (just fully booked). An error or missing venue means it's not bookable.
    const venue = data.results?.venues?.[0];
    return !!venue; // venue object exists = bookable restaurant
  } catch (e) {
    return false;
  }
}

// ── Main ──

async function main() {
  const websiteOnly = [];
  for (const [name, entry] of Object.entries(MASTER)) {
    if (entry.platform !== 'website') continue;
    if (RESUME && previous.results && previous.results[name]) continue;
    websiteOnly.push({ name, lat: entry.lat, lng: entry.lng });
  }

  let toCheck = QUICK ? websiteOnly.slice(0, 30) : websiteOnly;

  console.log(`\n🔍 Resy Finder for Website-Only Restaurants (TRIPLE VERIFIED)`);
  console.log(`📊 Website-only to check: ${websiteOnly.length + Object.keys(previous.results || {}).length}`);
  if (RESUME) console.log(`⏭️  Skipping ${Object.keys(previous.results || {}).length} already checked`);
  console.log(`🎯 Checking: ${toCheck.length}`);
  console.log(`⏱️  Est: ~${Math.round(toCheck.length * 8 / 60)} minutes`);
  console.log(`\n   Verification steps for each:`);
  console.log(`   1️⃣  Search Resy → name match + within 0.3mi`);
  console.log(`   2️⃣  Verify slug → venue API returns active ID`);
  console.log(`   3️⃣  Verify bookable → availability API responds\n`);

  const results = previous.results || {};
  let found = 0, notFound = 0;

  for (const v of Object.values(results)) {
    if (v.resy_match) found++;
    else notFound++;
  }

  for (let i = 0; i < toCheck.length; i++) {
    const { name, lat, lng } = toCheck[i];
    process.stdout.write(`  [${String(i + 1).padStart(4)}/${toCheck.length}] ${name.substring(0, 35).padEnd(35)} `);

    // ── CHECK 1: Search ──
    const hits = await searchResy(name, lat, lng);
    await sleep(1500);

    if (hits.length === 0) {
      results[name] = { resy_match: null, reason: 'no_search_results' };
      notFound++;
      console.log('❌ no results');
      continue;
    }

    // Find best name + location match
    let bestMatch = null;
    let bestConfidence = null;
    let rejectReason = null;

    for (const hit of hits) {
      const nameCheck = namesMatch(name, hit.name);
      if (!nameCheck.match) continue;

      if (lat && lng && hit.lat && hit.lng) {
        const dist = haversineMiles(lat, lng, hit.lat, hit.lng);
        if (dist > 0.3) {
          rejectReason = `name_ok_but_${dist.toFixed(1)}mi_away`;
          continue;
        }
      }

      bestMatch = hit;
      bestConfidence = nameCheck.confidence;
      break;
    }

    if (!bestMatch) {
      results[name] = { resy_match: null, reason: rejectReason || 'no_name_location_match', top_results: hits.map(h => h.name).slice(0, 3) };
      notFound++;
      console.log(`❌ ${rejectReason || 'no match'} (got: ${hits.map(h => h.name).slice(0, 2).join(', ')})`);
      continue;
    }

    process.stdout.write(`[1✓] `);

    // ── CHECK 2: Verify slug active ──
    const venueInfo = await verifySlug(bestMatch.slug);
    await sleep(1500);

    if (!venueInfo) {
      results[name] = { resy_match: null, reason: 'slug_inactive', slug: bestMatch.slug };
      notFound++;
      console.log(`[2✗] slug inactive: ${bestMatch.slug}`);
      continue;
    }

    // Extra name check against venue API response (belt and suspenders)
    const venueNameCheck = namesMatch(name, venueInfo.name);
    if (!venueNameCheck.match) {
      results[name] = { resy_match: null, reason: 'venue_name_mismatch', expected: name, got: venueInfo.name, slug: bestMatch.slug };
      notFound++;
      console.log(`[2✗] name mismatch: "${venueInfo.name}" ≠ "${name}"`);
      continue;
    }

    process.stdout.write(`[2✓] `);

    // ── CHECK 3: Verify bookable ──
    const isBookable = await verifyBookable(venueInfo.id);
    await sleep(1500);

    if (!isBookable) {
      results[name] = { resy_match: null, reason: 'not_bookable', slug: bestMatch.slug, venue_id: venueInfo.id };
      notFound++;
      console.log(`[3✗] not bookable`);
      continue;
    }

    // ✅ ALL THREE CHECKS PASSED
    const resyUrl = `https://resy.com/cities/ny/${bestMatch.slug}`;
    results[name] = {
      resy_match: {
        name: venueInfo.name,
        slug: bestMatch.slug,
        url: resyUrl,
        resy_id: venueInfo.id,
        confidence: bestConfidence,
        verified_active: true,
        verified_bookable: true
      }
    };
    found++;
    console.log(`[3✓] ✅ ${venueInfo.name} → ${resyUrl}`);

    // Save every 25
    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ _meta: { total: Object.keys(results).length, found, not_found: notFound, last_run: new Date().toISOString() }, results }, null, 2));
      process.stdout.write(`  💾 Saved progress\n`);
    }
  }

  // Final save
  const meta = { total: Object.keys(results).length, found, not_found: notFound, last_run: new Date().toISOString() };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ _meta: meta, results }, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 RESULTS (triple verified):`);
  console.log(`   ✅ Resy replacement found: ${found}`);
  console.log(`   ❌ No match:               ${notFound}`);
  console.log(`\n💾 Saved to: ${OUTPUT_FILE}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
