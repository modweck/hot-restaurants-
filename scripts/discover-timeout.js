/**
 * discover-timeout.js
 *
 * Discovers restaurants from TimeOut NYC and tags them in BOOKING_MASTER.
 *
 * STRATEGY:
 *   1. Scrape TimeOut NYC listing pages → collect restaurant page URLs
 *   2. Extract restaurant names from URL slugs
 *   3. Cross-check against BOOKING_MASTER:
 *      - Existing → add 'Time Out' to buzz_sources
 *      - New → enrich with Google Places + find Resy/OT booking links
 *   4. Add new ones to BOOKING_MASTER with new_rising: true
 *   5. Age out restaurants with 50+ reviews (drop new_rising)
 *
 * RUN:   node scripts/discover-timeout.js
 * FLAGS: --add           Auto-add new + tag existing in BOOKING_MASTER
 *        --skip-enrich   Skip Google/Resy/OT lookups
 *        --force         Ignore 48-hour cooldown
 *
 * OUTPUT: data/timeout_discoveries.json
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BM_PATH = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const LOOKUP_PATH = path.join(__dirname, '..', 'netlify', 'functions', 'booking_lookup.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'timeout_discoveries.json');
const LAST_RUN_PATH = path.join(__dirname, '..', 'data', 'timeout_last_run.json');
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_PLACES_API_KEY || 'AIzaSyDrtbSIA_BvJIzq1_-3pfQ_RgP2DiM_TKo';
const RESY_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const AUTO_ADD = process.argv.includes('--add');
const SKIP_ENRICH = process.argv.includes('--skip-enrich');
const FORCE = process.argv.includes('--force');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeName(name) {
  return name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`]/g, '').replace(/&/g, 'and')
    .replace(/[-–—]/g, ' ').replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function slugToName(slug) {
  return slug.replace(/-(\d)/g, ' $1').replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase()).trim();
}

function checkCooldown() {
  if (FORCE) return false;
  if (!fs.existsSync(LAST_RUN_PATH)) return false;
  const { lastRun } = JSON.parse(fs.readFileSync(LAST_RUN_PATH, 'utf8'));
  return (Date.now() - new Date(lastRun).getTime()) < 48 * 3600000;
}

// Patterns to filter out article/list pages (not individual restaurants)
const ARTICLE_PATTERN = /best-|top-|100-|cheap|brunch-|outdoor-|new-bar|openings|guide|most-|haunted|latest|market|reviews-in|romantic|family|classic-|michelin-|where-to|how-to|what-to|tips|events|deals|news|awards/;

// ── Scrape TimeOut listing pages ────────────────────────────────────────────
async function scrapeTimeOutLinks(browser) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
    else req.continue();
  });

  const listPages = [
    'https://www.timeout.com/newyork/restaurants/best-restaurants-in-nyc',
    'https://www.timeout.com/newyork/restaurants/100-best-new-york-restaurants',
    'https://www.timeout.com/newyork/restaurants/best-cheap-eats-in-nyc',
    'https://www.timeout.com/newyork/restaurants/the-best-new-restaurants-in-nyc',
    'https://www.timeout.com/newyork/restaurants/best-brunch-in-nyc',
    'https://www.timeout.com/newyork/restaurants/best-restaurants-for-outdoor-dining-in-nyc',
  ];

  const allSlugs = new Set();
  const patternSrc = ARTICLE_PATTERN.source;

  for (const url of listPages) {
    const shortName = url.split('/').pop();
    process.stdout.write(`  📰 ${shortName.padEnd(50)} `);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(2000);

      // Scroll to load lazy content
      for (let i = 0; i < 10; i++) {
        await page.evaluate(() => window.scrollBy(0, 1000));
        await sleep(400);
      }

      const slugs = await page.evaluate((pattern) => {
        const re = new RegExp(pattern);
        const found = [];
        document.querySelectorAll('a[href*="/newyork/restaurants/"]').forEach(a => {
          let href = a.getAttribute('href') || '';
          href = href.replace('https://www.timeout.com', '');
          if (re.test(href)) return;
          const m = href.match(/^\/newyork\/restaurants\/([a-z0-9][\w-]*)$/);
          if (m && m[1].length >= 3) found.push(m[1]);
        });
        return [...new Set(found)];
      }, patternSrc);

      slugs.forEach(s => allSlugs.add(s));
      console.log(`${slugs.length} restaurants`);
    } catch (e) {
      console.log(`❌ ${e.message?.slice(0, 50)}`);
    }
    await sleep(3000);
  }

  await page.close();
  return [...allSlugs];
}

// ── Google Places enrichment (New API) ──────────────────────────────────────
const FIELDS_MASK = 'places.id,places.displayName,places.rating,places.userRatingCount,places.location,places.websiteUri,places.priceLevel,places.formattedAddress,places.types,places.primaryType';

const typeMap = {
  japanese_restaurant: 'Japanese', italian_restaurant: 'Italian', mexican_restaurant: 'Mexican',
  chinese_restaurant: 'Chinese', indian_restaurant: 'Indian', thai_restaurant: 'Thai',
  korean_restaurant: 'Korean', french_restaurant: 'French', vietnamese_restaurant: 'Vietnamese',
  mediterranean_restaurant: 'Mediterranean', greek_restaurant: 'Greek', pizza_restaurant: 'Pizza',
  seafood_restaurant: 'Seafood', steak_house: 'Steakhouse', sushi_restaurant: 'Sushi',
  american_restaurant: 'American', spanish_restaurant: 'Spanish', turkish_restaurant: 'Turkish',
  barbecue_restaurant: 'BBQ', ramen_restaurant: 'Ramen', vegan_restaurant: 'Vegan',
};

const priceLevels = { PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 };

async function enrichGoogle(name) {
  try {
    const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_API_KEY, 'X-Goog-FieldMask': FIELDS_MASK },
      body: JSON.stringify({ textQuery: `${name} restaurant NYC`, maxResultCount: 1 }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const p = data.places?.[0];
    if (!p) return null;
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

// ── Resy lookup ─────────────────────────────────────────────────────────────
async function checkResy(name) {
  try {
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const resp = await fetch(`https://api.resy.com/3/venue?url_slug=${slug}&location=new-york-ny`, {
      headers: { 'Authorization': `ResyAPI api_key="${RESY_KEY}"`, 'Origin': 'https://resy.com' },
    });
    if (!resp.ok) return null;
    const d = await resp.json();
    if (d.name) return { platform: 'resy', url: `https://resy.com/cities/new-york-ny/venues/${d.url_slug || slug}` };
  } catch {}
  return null;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  🔍 RESTAURANT DISCOVERY — TimeOut NYC`);
  console.log(`${'═'.repeat(55)}\n`);

  if (checkCooldown()) {
    console.log('⏱️ Already ran within 48 hours. Use --force to override.\n');
    process.exit(0);
  }

  const bm = JSON.parse(fs.readFileSync(BM_PATH, 'utf8'));
  const bmNorms = {};
  for (const k of Object.keys(bm)) bmNorms[normalizeName(k)] = k;

  console.log(`📗 BOOKING_MASTER: ${Object.keys(bm).length} restaurants\n`);

  // Step 1: Scrape restaurant links
  console.log('📰 Scraping TimeOut NYC listing pages...');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  let slugs;
  try {
    slugs = await scrapeTimeOutLinks(browser);
  } catch (e) {
    console.error('Scraping failed:', e.message);
    await browser.close();
    return;
  }
  await browser.close();

  console.log(`\n🔎 Total unique restaurant slugs: ${slugs.length}\n`);

  // Step 2: Convert slugs to names and categorize
  const newRestaurants = [];
  let taggedExisting = 0;

  for (const slug of slugs) {
    const name = slugToName(slug);
    const norm = normalizeName(name);

    // Check if already in BOOKING_MASTER
    const existingKey = bmNorms[norm];
    if (existingKey) {
      // Tag existing restaurant with Time Out buzz
      if (!bm[existingKey].buzz_sources) bm[existingKey].buzz_sources = [];
      if (!bm[existingKey].buzz_sources.includes('Time Out')) {
        bm[existingKey].buzz_sources.push('Time Out');
        taggedExisting++;
      }
    } else {
      newRestaurants.push({ name, slug, source: 'Time Out', discovered_at: new Date().toISOString() });
    }
  }

  console.log(`📌 Tagged ${taggedExisting} existing restaurants with Time Out buzz`);
  console.log(`✨ New restaurants to process: ${newRestaurants.length}\n`);

  // Step 3: Enrich new restaurants
  const enriched = [];
  if (!SKIP_ENRICH && newRestaurants.length > 0) {
    for (let i = 0; i < newRestaurants.length; i++) {
      const r = newRestaurants[i];
      process.stdout.write(`  [${i + 1}/${newRestaurants.length}] ${r.name.substring(0, 35).padEnd(35)} `);

      const google = await enrichGoogle(r.name);
      await sleep(300);

      if (google) {
        const resy = await checkResy(r.name);
        await sleep(300);

        enriched.push({
          ...r, ...google,
          platform: resy?.platform || 'website',
          url: resy?.url || google.website || null,
        });
        console.log(`✅ ${google.google_rating}★ (${google.google_reviews} rev) ${resy ? 'resy' : 'website'}`);
      } else {
        enriched.push({ ...r, platform: 'website', url: null });
        console.log('⚠️ no Google match');
      }
    }
  } else if (SKIP_ENRICH) {
    enriched.push(...newRestaurants);
    newRestaurants.forEach(r => console.log(`  → ${r.name} (skipped enrichment)`));
  }

  // Step 4: Save discoveries
  const output = {
    _meta: {
      last_run: new Date().toISOString(),
      total_slugs: slugs.length,
      tagged_existing: taggedExisting,
      new_found: enriched.length,
    },
    found: enriched,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  fs.writeFileSync(LAST_RUN_PATH, JSON.stringify({ lastRun: new Date().toISOString() }));
  console.log(`\n💾 Saved to ${OUTPUT_PATH}`);

  // Step 5: Auto-add to BOOKING_MASTER + booking_lookup
  if (AUTO_ADD) {
    let lookup = {};
    try { lookup = JSON.parse(fs.readFileSync(LOOKUP_PATH, 'utf8')); } catch {}

    let added = 0, aged = 0;
    for (const r of enriched) {
      const key = r.name.toLowerCase();
      const norm = normalizeName(r.name);
      if (bmNorms[norm]) continue; // already exists

      bm[key] = {
        platform: r.platform,
        booking_url: r.url || null,
        lat: r.lat || null, lng: r.lng || null,
        google_rating: r.google_rating || null, google_reviews: r.google_reviews || null,
        place_id: r.place_id || null, website: r.website || null, address: r.address || null,
        cuisine: r.cuisine || null, price: r.price || null,
        buzz_sources: ['Time Out'], vibe_tags: ['new_rising'],
        new_rising: true, discovered_at: r.discovered_at,
      };

      if (r.platform === 'resy' && r.url && !lookup[key]) {
        lookup[key] = { platform: 'resy', url: r.url };
      }
      added++;
    }

    // Age out: 50+ reviews loses new_rising
    for (const [key, entry] of Object.entries(bm)) {
      if (entry.new_rising && (entry.google_reviews || 0) >= 50) {
        entry.new_rising = false;
        const idx = (entry.vibe_tags || []).indexOf('new_rising');
        if (idx > -1) entry.vibe_tags.splice(idx, 1);
        aged++;
      }
    }

    fs.writeFileSync(BM_PATH, JSON.stringify(bm, null, 2));
    fs.writeFileSync(LOOKUP_PATH, JSON.stringify(lookup, null, 2));
    console.log(`✅ Added ${added} new restaurants to BOOKING_MASTER`);
    console.log(`📌 Tagged ${taggedExisting} existing restaurants with Time Out buzz`);
    if (aged > 0) console.log(`📈 Aged out ${aged} restaurants (50+ reviews)`);
  }

  console.log(`\n✅ Done!\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
