/**
 * discover-new-on-resy.js
 *
 * Finds recently added restaurants on Resy that aren't in BOOKING_MASTER.
 *
 * STRATEGY:
 *   1. Search Resy API across all NYC neighborhoods for restaurants
 *   2. Compare against BOOKING_MASTER to find new ones
 *   3. Enrich with Google Places data
 *   4. Optionally add to BOOKING_MASTER
 *
 * The Resy search API returns results sorted by relevance/newness,
 * so recent additions naturally bubble up.
 *
 * RUN:   node scripts/discover-new-on-resy.js
 * FLAGS: --add           Auto-add to BOOKING_MASTER
 *        --skip-enrich   Skip Google Places lookups
 *        --quick         Only search 5 neighborhoods
 *
 * OUTPUT: data/resy_new_discoveries.json
 */

const fs = require('fs');
const path = require('path');

const BM_PATH = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const DISCOVERIES_PATH = path.join(__dirname, '..', 'data', 'press_discoveries.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'resy_new_discoveries.json');
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_PLACES_API_KEY || 'AIzaSyDrtbSIA_BvJIzq1_-3pfQ_RgP2DiM_TKo';
const RESY_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const RESY_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzc5MDk0MTQsInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.AWCYkK7wyE0h-KnU7IMnRzUTPpPPh_B7t2ZsXPKg3Pj4uTvQvtGRLLUwG1TYB7yulCfq2U3iD6UdtQgyR4ashAnHAAcrbXK3jAr0BT6YPjHWHadcdlT8KUpeSv2Dixv-PlrW0gfm1eKtocNFz7qn-p14iVgI2YnLZU_KwoUsB3fW0Co1';
const AUTO_ADD = process.argv.includes('--add');
const SKIP_ENRICH = process.argv.includes('--skip-enrich');
const QUICK = process.argv.includes('--quick');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeName(name) {
  return name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`]/g, '').replace(/&/g, 'and')
    .replace(/[-–—]/g, ' ').replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

const RESY_HEADERS = {
  'Authorization': `ResyAPI api_key="${RESY_KEY}"`,
  'X-Resy-Auth-Token': RESY_TOKEN,
  'X-Resy-Universal-Auth': RESY_TOKEN,
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Origin': 'https://resy.com',
  'Referer': 'https://resy.com/',
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

// NYC neighborhood coordinates for search coverage
const NEIGHBORHOODS = [
  { name: 'Lower Manhattan', lat: 40.7128, lng: -74.0060 },
  { name: 'West Village', lat: 40.7336, lng: -74.0027 },
  { name: 'East Village', lat: 40.7265, lng: -73.9815 },
  { name: 'SoHo/NoLIta', lat: 40.7233, lng: -73.9988 },
  { name: 'Chelsea', lat: 40.7465, lng: -74.0014 },
  { name: 'Midtown', lat: 40.7549, lng: -73.9840 },
  { name: 'Upper East Side', lat: 40.7736, lng: -73.9566 },
  { name: 'Upper West Side', lat: 40.7870, lng: -73.9754 },
  { name: 'Harlem', lat: 40.8116, lng: -73.9465 },
  { name: 'Williamsburg', lat: 40.7081, lng: -73.9571 },
  { name: 'Greenpoint', lat: 40.7282, lng: -73.9462 },
  { name: 'Park Slope', lat: 40.6710, lng: -73.9814 },
  { name: 'DUMBO/Brooklyn Heights', lat: 40.7033, lng: -73.9903 },
  { name: 'Bushwick', lat: 40.6942, lng: -73.9213 },
  { name: 'Crown Heights', lat: 40.6694, lng: -73.9422 },
  { name: 'Astoria', lat: 40.7644, lng: -73.9235 },
  { name: 'Long Island City', lat: 40.7447, lng: -73.9485 },
  { name: 'Flushing', lat: 40.7580, lng: -73.8317 },
  { name: 'LES/Chinatown', lat: 40.7158, lng: -73.9898 },
  { name: 'Flatiron/NoMad', lat: 40.7410, lng: -73.9896 },
];

// ── Search Resy by location ─────────────────────────────────────────────────
async function searchResyNearby(lat, lng, page = 1) {
  try {
    const resp = await fetch('https://api.resy.com/3/venuesearch/search', {
      method: 'POST',
      headers: RESY_HEADERS,
      body: JSON.stringify({
        geo: { latitude: lat, longitude: lng },
        per_page: 50,
        page,
        types: ['venue'],
      }),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.search?.hits || [];
  } catch (e) {
    return [];
  }
}

// ── Google Places enrichment (New API) ───────────────────────────────────────
const FIELDS_MASK = 'places.id,places.displayName,places.rating,places.userRatingCount,places.location,places.websiteUri,places.priceLevel,places.formattedAddress,places.types,places.primaryType';

const typeMap = {
  japanese_restaurant: 'Japanese', italian_restaurant: 'Italian', mexican_restaurant: 'Mexican',
  chinese_restaurant: 'Chinese', indian_restaurant: 'Indian', thai_restaurant: 'Thai',
  korean_restaurant: 'Korean', french_restaurant: 'French', vietnamese_restaurant: 'Vietnamese',
  mediterranean_restaurant: 'Mediterranean', seafood_restaurant: 'Seafood', steak_house: 'Steakhouse',
  sushi_restaurant: 'Sushi', pizza_restaurant: 'Pizza', american_restaurant: 'American',
  spanish_restaurant: 'Spanish', greek_restaurant: 'Greek', turkish_restaurant: 'Turkish',
  barbecue_restaurant: 'BBQ', ramen_restaurant: 'Ramen', vegan_restaurant: 'Vegan',
};

const priceLevels = { PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 };

async function enrichGoogle(name) {
  try {
    const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': FIELDS_MASK,
      },
      body: JSON.stringify({ textQuery: `${name} restaurant NYC`, maxResultCount: 1 }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const p = data.places?.[0];
    if (!p) return null;

    // Must be NYC area
    if (p.formattedAddress && !p.formattedAddress.match(/\bN\.?Y\.?\b|New York|Brooklyn|Queens|Bronx/i)) return null;

    let cuisine = '';
    for (const t of (p.types || [])) { if (typeMap[t]) { cuisine = typeMap[t]; break; } }
    if (!cuisine && p.primaryType && typeMap[p.primaryType]) cuisine = typeMap[p.primaryType];

    return {
      place_id: p.id || null, google_name: p.displayName?.text || '',
      google_rating: p.rating || 0, google_reviews: p.userRatingCount || 0,
      lat: p.location?.latitude || null, lng: p.location?.longitude || null,
      website: p.websiteUri || null, address: p.formattedAddress || '',
      price: priceLevels[p.priceLevel] ?? null, cuisine,
    };
  } catch { return null; }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  🔍 NEW RESTAURANT DISCOVERY — New on Resy`);
  console.log(`${'═'.repeat(55)}\n`);

  const bm = JSON.parse(fs.readFileSync(BM_PATH, 'utf8'));
  const bmNorms = new Set(Object.keys(bm).map(k => normalizeName(k)));
  console.log(`📗 BOOKING_MASTER: ${Object.keys(bm).length} restaurants`);

  let previous = [];
  if (fs.existsSync(DISCOVERIES_PATH)) {
    try { previous = JSON.parse(fs.readFileSync(DISCOVERIES_PATH, 'utf8')).filter(d => d.name); } catch {}
  }
  const prevNorms = new Set(previous.map(d => normalizeName(d.name)));

  const neighborhoods = QUICK ? NEIGHBORHOODS.slice(0, 5) : NEIGHBORHOODS;
  console.log(`🗺️ Searching ${neighborhoods.length} neighborhoods\n`);

  // Step 1: Search Resy across neighborhoods
  const allVenues = new Map(); // slug → venue data

  for (const hood of neighborhoods) {
    process.stdout.write(`  📍 ${hood.name.padEnd(25)} `);
    const hits = await searchResyNearby(hood.lat, hood.lng);

    let newCount = 0;
    for (const h of hits) {
      const slug = h.url_slug || h.slug;
      if (!slug || allVenues.has(slug)) continue;

      const name = h.name || '';
      const norm = normalizeName(name);
      if (bmNorms.has(norm) || prevNorms.has(norm)) continue;

      // Must be in NYC area
      const loc = h.location?.code || '';
      if (loc && loc !== 'ny') continue;

      allVenues.set(slug, {
        name,
        slug,
        neighborhood: h.location?.neighborhood || hood.name,
        resyUrl: `https://resy.com/cities/new-york-ny/venues/${slug}`,
        venueId: h.id?.resy || null,
        lat: h._geoloc?.lat || null,
        lng: h._geoloc?.lng || null,
      });
      newCount++;
    }

    console.log(`${hits.length} results, ${newCount} new`);
    await sleep(1500);
  }

  console.log(`\n🔎 Total new Resy venues: ${allVenues.size}\n`);

  if (allVenues.size === 0) {
    console.log('No new restaurants found.\n');
    return;
  }

  // Step 2: Enrich with Google Places
  const enriched = [];
  const venues = [...allVenues.values()];

  for (let i = 0; i < venues.length; i++) {
    const v = venues[i];
    process.stdout.write(`  [${i + 1}/${venues.length}] ${v.name.substring(0, 35).padEnd(35)} `);

    if (!SKIP_ENRICH) {
      const google = await enrichGoogle(v.name);
      await sleep(300);

      if (google) {
        enriched.push({
          name: v.name,
          source: 'Resy (new)',
          discovered_at: new Date().toISOString(),
          neighborhood: v.neighborhood,
          platform: 'resy',
          url: v.resyUrl,
          ...google,
        });
        console.log(`✅ ${google.google_rating}★ (${google.google_reviews} rev)`);
      } else {
        // Still add without Google data
        enriched.push({
          name: v.name,
          source: 'Resy (new)',
          discovered_at: new Date().toISOString(),
          neighborhood: v.neighborhood,
          platform: 'resy',
          url: v.resyUrl,
          lat: v.lat, lng: v.lng,
        });
        console.log('⚠️ no Google match');
      }
    } else {
      enriched.push({
        name: v.name,
        source: 'Resy (new)',
        discovered_at: new Date().toISOString(),
        neighborhood: v.neighborhood,
        platform: 'resy',
        url: v.resyUrl,
        lat: v.lat, lng: v.lng,
      });
      console.log('→ skipped enrichment');
    }
  }

  // Step 3: Save
  const output = {
    _meta: {
      last_run: new Date().toISOString(),
      neighborhoods_searched: neighborhoods.length,
      new_found: enriched.length,
    },
    found: enriched,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\n💾 Saved ${enriched.length} new Resy restaurants to ${OUTPUT_PATH}`);

  // Also append to press_discoveries.json
  const allDiscoveries = [...previous, ...enriched];
  fs.writeFileSync(DISCOVERIES_PATH, JSON.stringify(allDiscoveries, null, 2));

  // Step 4: Auto-add to BOOKING_MASTER + booking_lookup
  if (AUTO_ADD && enriched.length > 0) {
    const LOOKUP_PATH = path.join(__dirname, '..', 'netlify', 'functions', 'booking_lookup.json');
    let lookup = {};
    try { lookup = JSON.parse(fs.readFileSync(LOOKUP_PATH, 'utf8')); } catch {}

    let added = 0, aged = 0;
    for (const r of enriched) {
      const key = r.name.toLowerCase();
      const norm = normalizeName(r.name);
      const exists = bm[key] || Object.keys(bm).some(k => normalizeName(k) === norm);
      if (exists) continue;

      bm[key] = {
        platform: 'resy',
        booking_url: r.url,
        lat: r.lat, lng: r.lng,
        google_rating: r.google_rating || null, google_reviews: r.google_reviews || null,
        place_id: r.place_id || null, website: r.website || null, address: r.address || null,
        cuisine: r.cuisine || null, price: r.price || null,
        buzz_sources: ['Resy'], vibe_tags: ['new_rising'],
        new_rising: true,
        discovered_at: r.discovered_at,
      };

      // Also add to booking_lookup
      if (!lookup[key]) {
        lookup[key] = { platform: 'resy', url: r.url };
      }
      added++;
    }

    // Age out: any restaurant with 50+ reviews loses new_rising tag
    for (const [key, entry] of Object.entries(bm)) {
      if (entry.new_rising && (entry.google_reviews || 0) >= 50) {
        entry.new_rising = false;
        // Keep in master, just remove the new_rising flag
        const idx = (entry.vibe_tags || []).indexOf('new_rising');
        if (idx > -1) entry.vibe_tags.splice(idx, 1);
        aged++;
      }
    }

    fs.writeFileSync(BM_PATH, JSON.stringify(bm, null, 2));
    fs.writeFileSync(LOOKUP_PATH, JSON.stringify(lookup, null, 2));
    console.log(`✅ Added ${added} restaurants to BOOKING_MASTER + booking_lookup`);
    if (aged > 0) console.log(`📈 Aged out ${aged} restaurants (50+ reviews, no longer new_rising)`);
  }

  console.log(`\n✅ Done!\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
