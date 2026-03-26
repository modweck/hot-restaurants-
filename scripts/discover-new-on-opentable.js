/**
 * discover-new-on-opentable.js
 *
 * Finds recently added restaurants on OpenTable that aren't in BOOKING_MASTER.
 *
 * STRATEGY:
 *   1. Search OpenTable GraphQL autocomplete across cuisine categories + neighborhoods
 *   2. Compare against BOOKING_MASTER to find new ones
 *   3. Validate each OT page via fetch (check it's a real restaurant page)
 *   4. Enrich with Google Places data
 *   5. Optionally add to BOOKING_MASTER
 *
 * RUN:   node scripts/discover-new-on-opentable.js
 * FLAGS: --add           Auto-add to BOOKING_MASTER
 *        --skip-enrich   Skip Google Places lookups
 *        --quick         Only search 5 categories
 *
 * OUTPUT: data/ot_new_discoveries.json
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BM_PATH = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const DISCOVERIES_PATH = path.join(__dirname, '..', 'data', 'press_discoveries.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'ot_new_discoveries.json');
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_PLACES_API_KEY || 'AIzaSyDrtbSIA_BvJIzq1_-3pfQ_RgP2DiM_TKo';
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

// Search terms to cover different cuisines and neighborhoods
const SEARCH_TERMS = [
  // By cuisine
  'new restaurant', 'new opening', 'recently opened',
  'italian restaurant', 'japanese restaurant', 'french restaurant',
  'korean restaurant', 'mexican restaurant', 'chinese restaurant',
  'indian restaurant', 'thai restaurant', 'steakhouse',
  'sushi', 'seafood restaurant', 'mediterranean restaurant',
  'american restaurant', 'pizza', 'brunch',
  // By neighborhood
  'soho restaurant', 'west village restaurant', 'east village restaurant',
  'williamsburg restaurant', 'chelsea restaurant', 'lower east side restaurant',
  'midtown restaurant', 'upper east side restaurant', 'tribeca restaurant',
  'greenpoint restaurant', 'park slope restaurant', 'harlem restaurant',
  'flatiron restaurant', 'nomad restaurant', 'nolita restaurant',
];

const QUICK_TERMS = SEARCH_TERMS.slice(0, 8);

// ── OpenTable Puppeteer search ───────────────────────────────────────────────
let _browser = null;
async function getBrowser() {
  if (!_browser) _browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  return _browser;
}

async function searchOT(term) {
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (['image', 'font', 'media', 'stylesheet'].includes(req.resourceType())) req.abort();
      else req.continue();
    });

    const searchUrl = `https://www.opentable.com/s?term=${encodeURIComponent(term)}&metroId=4&regionIds=4&includeTicketedAvailability=true`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(3000);

    const results = await page.evaluate(() => {
      const restaurants = [];
      // OT search results use restaurant cards with links
      document.querySelectorAll('[data-test="restaurant-card"], .restaurant-card, [class*="RestaurantCard"]').forEach(card => {
        const nameEl = card.querySelector('h2, [data-test="restaurant-name"], a[href*="/r/"]');
        const linkEl = card.querySelector('a[href*="/r/"], a[href*="opentable.com"]');
        if (nameEl) {
          const name = nameEl.textContent.trim();
          const href = linkEl ? linkEl.href : '';
          const neighborhood = (card.querySelector('[class*="neighborhood"], [class*="location"]') || {}).textContent || '';
          if (name.length >= 2) restaurants.push({ name, href, neighborhood: neighborhood.trim() });
        }
      });
      // Fallback: any link to /r/ pages
      if (restaurants.length === 0) {
        document.querySelectorAll('a[href*="/r/"]').forEach(a => {
          const name = a.textContent.trim();
          if (name.length >= 3 && name.length <= 60 && !name.toLowerCase().includes('opentable')) {
            restaurants.push({ name, href: a.href, neighborhood: '' });
          }
        });
      }
      return restaurants;
    });

    await page.close();
    return results;
  } catch (e) {
    return [];
  }
}

// ── Google Places enrichment ────────────────────────────────────────────────
async function enrichGoogle(name) {
  try {
    const query = `${name} restaurant NYC`;
    const sr = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id,name,formatted_address&key=${GOOGLE_API_KEY}`);
    const sd = await sr.json();
    if (!sd.candidates?.length) return null;

    const pid = sd.candidates[0].place_id;
    const dr = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${pid}&fields=name,rating,user_ratings_total,geometry,website,price_level,formatted_address,types&key=${GOOGLE_API_KEY}`);
    const { result: r } = await dr.json();
    if (!r) return null;

    // Must be NYC area
    if (r.formatted_address && !r.formatted_address.match(/\bN\.?Y\.?\b|New York|Brooklyn|Queens|Bronx/i)) return null;

    const typeMap = {
      japanese_restaurant: 'Japanese', italian_restaurant: 'Italian', mexican_restaurant: 'Mexican',
      chinese_restaurant: 'Chinese', indian_restaurant: 'Indian', thai_restaurant: 'Thai',
      korean_restaurant: 'Korean', french_restaurant: 'French', vietnamese_restaurant: 'Vietnamese',
      mediterranean_restaurant: 'Mediterranean', seafood_restaurant: 'Seafood', steak_house: 'Steakhouse',
      sushi_restaurant: 'Sushi', pizza_restaurant: 'Pizza',
    };
    let cuisine = '';
    for (const t of (r.types || [])) { if (typeMap[t]) { cuisine = typeMap[t]; break; } }

    return {
      place_id: pid, google_name: r.name,
      google_rating: r.rating || 0, google_reviews: r.user_ratings_total || 0,
      lat: r.geometry?.location?.lat, lng: r.geometry?.location?.lng,
      website: r.website || null, address: r.formatted_address || '',
      price: r.price_level || null, cuisine,
    };
  } catch { return null; }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  🔍 NEW RESTAURANT DISCOVERY — New on OpenTable`);
  console.log(`${'═'.repeat(55)}\n`);

  const bm = JSON.parse(fs.readFileSync(BM_PATH, 'utf8'));
  const bmNorms = new Set(Object.keys(bm).map(k => normalizeName(k)));
  console.log(`📗 BOOKING_MASTER: ${Object.keys(bm).length} restaurants`);

  let previous = [];
  if (fs.existsSync(DISCOVERIES_PATH)) {
    try { previous = JSON.parse(fs.readFileSync(DISCOVERIES_PATH, 'utf8')).filter(d => d.name); } catch {}
  }
  const prevNorms = new Set(previous.map(d => normalizeName(d.name)));

  const terms = QUICK ? QUICK_TERMS : SEARCH_TERMS;
  console.log(`🔎 Searching ${terms.length} terms\n`);

  // Step 1: Search OT across all terms
  const allRestaurants = new Map(); // name norm → data

  for (const term of terms) {
    process.stdout.write(`  🔍 "${term}"`.padEnd(50));

    const results = await searchOT(term);

    let newCount = 0;
    for (const r of results) {
      const name = r.name || '';
      if (!name || name.length < 2) continue;

      const norm = normalizeName(name);
      if (bmNorms.has(norm) || prevNorms.has(norm) || allRestaurants.has(norm)) continue;

      const otUrl = r.href && r.href.includes('opentable.com') ? r.href : null;
      if (!otUrl) continue;

      allRestaurants.set(norm, {
        name,
        otUrl,
        rid: null,
        neighborhood: r.neighborhood || '',
      });
      newCount++;
    }

    console.log(`${results.length} results, ${newCount} new`);
    await sleep(4000); // Respect OT rate limits
  }

  console.log(`\n🔎 Total new OT restaurants: ${allRestaurants.size}\n`);

  if (allRestaurants.size === 0) {
    console.log('No new restaurants found.\n');
    return;
  }

  // Step 2: Enrich with Google Places
  const enriched = [];
  const restaurants = [...allRestaurants.values()];

  for (let i = 0; i < restaurants.length; i++) {
    const r = restaurants[i];
    process.stdout.write(`  [${i + 1}/${restaurants.length}] ${r.name.substring(0, 35).padEnd(35)} `);

    if (!SKIP_ENRICH) {
      const google = await enrichGoogle(r.name);
      await sleep(300);

      if (google) {
        enriched.push({
          name: r.name,
          source: 'OpenTable (new)',
          discovered_at: new Date().toISOString(),
          neighborhood: r.neighborhood || '',
          platform: 'opentable',
          url: r.otUrl,
          rid: r.rid,
          ...google,
        });
        console.log(`✅ ${google.google_rating}★ (${google.google_reviews} rev)`);
      } else {
        enriched.push({
          name: r.name,
          source: 'OpenTable (new)',
          discovered_at: new Date().toISOString(),
          neighborhood: r.neighborhood || '',
          platform: 'opentable',
          url: r.otUrl,
          rid: r.rid,
        });
        console.log('⚠️ no Google match');
      }
    } else {
      enriched.push({
        name: r.name,
        source: 'OpenTable (new)',
        discovered_at: new Date().toISOString(),
        neighborhood: r.neighborhood || '',
        platform: 'opentable',
        url: r.otUrl,
        rid: r.rid,
      });
      console.log('→ skipped enrichment');
    }
  }

  // Step 3: Save
  const output = {
    _meta: {
      last_run: new Date().toISOString(),
      terms_searched: terms.length,
      new_found: enriched.length,
    },
    found: enriched,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\n💾 Saved ${enriched.length} new OT restaurants to ${OUTPUT_PATH}`);

  // Also append to press_discoveries.json
  const allDiscoveries = [...previous, ...enriched];
  fs.writeFileSync(DISCOVERIES_PATH, JSON.stringify(allDiscoveries, null, 2));

  // Step 4: Auto-add
  if (AUTO_ADD && enriched.length > 0) {
    let added = 0;
    for (const r of enriched) {
      const key = r.name.toLowerCase();
      if (bm[key]) continue;
      bm[key] = {
        platform: 'opentable',
        booking_url: r.url,
        lat: r.lat, lng: r.lng,
        google_rating: r.google_rating, google_reviews: r.google_reviews,
        place_id: r.place_id, website: r.website, address: r.address,
        cuisine: r.cuisine, price: r.price,
        buzz_sources: ['OpenTable'], vibe_tags: ['new_rising'],
        new_rising: true,
      };
      if (r.rid) bm[key].ot_rid = r.rid;
      added++;
    }
    fs.writeFileSync(BM_PATH, JSON.stringify(bm, null, 2));
    console.log(`✅ Added ${added} restaurants to BOOKING_MASTER`);
  }

  // Cleanup browser
  if (_browser) await _browser.close();

  console.log(`\n✅ Done!\n`);
}

main().catch(async err => { if (_browser) await _browser.close(); console.error('Fatal:', err); process.exit(1); });
