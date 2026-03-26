/**
 * discover-from-press.js
 *
 * Full pipeline for discovering new restaurants from Eater NYC.
 *
 * FLOW:
 *   1. Scrape Eater monthly openings articles → names, neighborhoods, Instagram links
 *   2. Cross-check against BOOKING_MASTER → skip existing
 *   3. Cross-check against press_discoveries.json → skip already found
 *   4. Google Places → rating, reviews, lat/lng, website, address
 *   5. Resy API → check for booking link
 *   6. OpenTable API → check for booking link
 *   7. Add to BOOKING_MASTER with new_rising: true, buzz_sources: ['Eater']
 *
 * RUN:   node scripts/discover-from-press.js
 * FLAGS: --add           Auto-add to BOOKING_MASTER
 *        --skip-enrich   Skip Google/Resy/OT lookups
 *        --force         Ignore 48-hour cooldown
 *
 * COST: ~$0.50 per run (Google Places), Resy/OT free
 * RUN EVERY: 2 days
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BM_PATH = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'press_discoveries.json');
const LAST_RUN_PATH = path.join(__dirname, '..', 'data', 'press_last_run.json');
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

// ── Neighborhoods ───────────────────────────────────────────────────────────
const NEIGHBORHOODS = new Set([
  'west village', 'east village', 'greenwich village', 'lower east side', 'les',
  'soho', 'noho', 'nolita', 'tribeca', 'chinatown', 'little italy', 'financial district',
  'chelsea', 'flatiron', 'gramercy', 'murray hill', 'kips bay', 'midtown',
  "hell's kitchen", 'times square', 'upper west side', 'upper east side', 'uws', 'ues',
  'harlem', 'east harlem', 'washington heights', 'inwood', 'morningside heights',
  'meatpacking district', 'hudson yards', 'nomad', 'koreatown', 'two bridges',
  'union square', 'battery park', 'bowery',
  'williamsburg', 'greenpoint', 'bushwick', 'bed-stuy', 'bedford-stuyvesant',
  'crown heights', 'park slope', 'cobble hill', 'carroll gardens', 'boerum hill',
  'gowanus', 'red hook', 'dumbo', 'brooklyn heights', 'fort greene', 'clinton hill',
  'prospect heights', 'prospect-lefferts garden', 'bay ridge', 'sunset park',
  'astoria', 'long island city', 'jackson heights', 'flushing', 'forest hills',
  'brooklyn', 'queens', 'bronx', 'staten island', 'manhattan',
]);

function isNeighborhood(text) {
  return NEIGHBORHOODS.has(text.toLowerCase().replace(/:$/, '').trim());
}

// ── 48-hour cooldown ────────────────────────────────────────────────────────
function checkCooldown() {
  if (FORCE) return false;
  if (!fs.existsSync(LAST_RUN_PATH)) return false;
  const { lastRun } = JSON.parse(fs.readFileSync(LAST_RUN_PATH, 'utf8'));
  return (Date.now() - new Date(lastRun).getTime()) < 48 * 3600000;
}

// ── Scrape Eater articles ───────────────────────────────────────────────────
async function scrapeEater(page) {
  // Find article URLs from the openings page
  console.log('  Finding article URLs...');
  await page.goto('https://ny.eater.com/restaurant-openings', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);

  // Dismiss cookies
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) { if (b.textContent.trim().toLowerCase().includes('accept')) { b.click(); break; } }
  });
  await sleep(1000);

  // Find monthly roundup article links
  const articleUrls = await page.evaluate(() => {
    const links = [];
    const allLinks = document.querySelectorAll('a[href]');
    for (const a of allLinks) {
      const href = a.href;
      if (href.match(/restaurant-openings.*\d{4}$|new-restaurant-openings/)) {
        links.push(href);
      }
    }
    return [...new Set(links)];
  });

  // Add known recent URLs as fallback
  const knownUrls = [
    'https://ny.eater.com/news/409757/nyc-new-restaurant-openings-march-2026',
    'https://ny.eater.com/news/409076/nyc-new-restaurant-openings-february-2026',
  ];
  const allUrls = [...new Set([...articleUrls, ...knownUrls])].slice(0, 3);
  console.log(`  Found ${allUrls.length} article URLs`);

  const allRestaurants = [];

  for (const url of allUrls) {
    const month = url.match(/openings-(\w+)-/)?.[1] || url.match(/(\w+)-\d{4}$/)?.[1] || 'unknown';
    console.log(`  📰 ${month}: loading...`);

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(2000);
      await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) { if (b.textContent.trim().toLowerCase().includes('accept')) { b.click(); break; } }
      });
      await sleep(1000);

      for (let i = 0; i < 8; i++) {
        await page.evaluate(() => window.scrollBy(0, 1500));
        await sleep(500);
      }

      // Extract bold text (restaurant names + neighborhoods) AND Instagram links
      const data = await page.evaluate(() => {
        const bolds = [];
        const instas = {};

        const boldEls = document.querySelectorAll('article strong, article b, .c-entry-content strong, .c-entry-content b');
        for (const el of boldEls) {
          const text = el.textContent.trim();
          if (text.length >= 2 && text.length <= 60) bolds.push(text);
        }

        // Find Instagram links near restaurant names
        const allLinks = document.querySelectorAll('article a[href*="instagram.com"], .c-entry-content a[href*="instagram.com"]');
        for (const a of allLinks) {
          const href = a.href;
          const handle = href.match(/instagram\.com\/([a-zA-Z0-9_.]+)/)?.[1];
          if (!handle || handle === 'p' || handle === 'reel') continue;

          // Find the nearest bold text (restaurant name) before this link
          const parent = a.closest('p, li, div');
          if (parent) {
            const nearBolds = parent.querySelectorAll('strong, b');
            for (const b of nearBolds) {
              const name = b.textContent.trim();
              if (name.length >= 3 && name.length <= 50) {
                instas[name] = handle;
              }
            }
          }
        }

        return { bolds, instas };
      });

      // Parse bold text: neighborhood → restaurant name alternating
      let currentNeighborhood = null;
      for (const bold of data.bolds) {
        const cleaned = bold.replace(/:$/, '').trim();
        if (isNeighborhood(cleaned)) {
          currentNeighborhood = cleaned;
        } else if (currentNeighborhood && cleaned.length >= 3) {
          allRestaurants.push({
            name: cleaned,
            neighborhood: currentNeighborhood,
            source: 'Eater',
            month,
            article_url: url,
            instagram: data.instas[cleaned] || null,
          });
        }
      }

      console.log(`     ${allRestaurants.length} restaurants total`);
    } catch (e) {
      console.log(`     ❌ ${e.message?.slice(0, 50)}`);
    }

    await sleep(2000);
  }

  return allRestaurants;
}

// ── Google Places enrichment (New API) ───────────────────────────────────────
const FIELDS_MASK = 'places.id,places.displayName,places.rating,places.userRatingCount,places.location,places.websiteUri,places.priceLevel,places.formattedAddress,places.types,places.primaryType';

const typeMap = {
  japanese_restaurant: 'Japanese', italian_restaurant: 'Italian', mexican_restaurant: 'Mexican',
  chinese_restaurant: 'Chinese', indian_restaurant: 'Indian', thai_restaurant: 'Thai',
  korean_restaurant: 'Korean', french_restaurant: 'French', vietnamese_restaurant: 'Vietnamese',
  mediterranean_restaurant: 'Mediterranean', greek_restaurant: 'Greek', turkish_restaurant: 'Turkish',
  pizza_restaurant: 'Pizza', seafood_restaurant: 'Seafood', steak_house: 'Steakhouse',
  sushi_restaurant: 'Sushi', ramen_restaurant: 'Ramen', barbecue_restaurant: 'BBQ',
  vegan_restaurant: 'Vegan', vegetarian_restaurant: 'Vegetarian', american_restaurant: 'American',
  spanish_restaurant: 'Spanish',
};

const priceLevels = { PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 };

async function enrichGoogle(name, neighborhood) {
  try {
    const query = `${name} restaurant ${neighborhood || 'NYC'}`;
    const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': FIELDS_MASK,
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const p = data.places?.[0];
    if (!p) return null;

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

// ── OpenTable lookup ────────────────────────────────────────────────────────
async function checkOpenTable(name, lat, lng) {
  try {
    const query = encodeURIComponent(name);
    const resp = await fetch(`https://www.opentable.com/restref/api/suggest?term=${query}&latitude=${lat || 40.7128}&longitude=${lng || -74.006}&lang=en-US`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const results = data?.restaurants || data?.results || [];
    if (!Array.isArray(results)) return null;

    const norm = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const r of results) {
      const rNorm = (r.name || r.restaurantName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (rNorm.includes(norm) || norm.includes(rNorm)) {
        const link = r.profileLink || r.link || r.url || '';
        const fullUrl = link.startsWith('http') ? link : `https://www.opentable.com${link}`;
        return { platform: 'opentable', url: fullUrl };
      }
    }
  } catch {}
  return null;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  🔍 NEW RESTAURANT DISCOVERY — Eater NYC`);
  console.log(`${'═'.repeat(55)}\n`);

  if (checkCooldown()) {
    console.log('⏱️ Already ran within 48 hours. Use --force to override.\n');
    process.exit(0);
  }

  const bm = JSON.parse(fs.readFileSync(BM_PATH, 'utf8'));
  const bmNorms = new Set(Object.keys(bm).map(k => normalizeName(k)));
  console.log(`📗 BOOKING_MASTER: ${Object.keys(bm).length} restaurants`);

  let previous = [];
  if (fs.existsSync(OUTPUT_PATH)) {
    try { previous = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')).filter(d => d.name); } catch {}
  }
  const prevNorms = new Set(previous.map(d => normalizeName(d.name)));
  console.log(`📁 Previous discoveries: ${previous.length}\n`);

  // Step 1: Scrape
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

  let eaterFinds;
  try {
    console.log('📰 Scraping Eater NYC...');
    eaterFinds = await scrapeEater(page);
  } finally {
    await browser.close();
  }

  // Deduplicate
  const deduped = new Map();
  for (const r of eaterFinds) {
    const n = normalizeName(r.name);
    if (!deduped.has(n)) deduped.set(n, r);
  }

  // Filter
  const newFinds = [];
  let inBM = 0, inPrev = 0;
  for (const [n, data] of deduped) {
    if (bmNorms.has(n)) { inBM++; continue; }
    if (prevNorms.has(n)) { inPrev++; continue; }
    newFinds.push(data);
  }

  console.log(`\n📊 Scraped ${deduped.size} unique | In BM: ${inBM} | Already found: ${inPrev} | ✨ New: ${newFinds.length}\n`);

  if (newFinds.length === 0) {
    console.log('💤 No new restaurants this run.\n');
    fs.writeFileSync(LAST_RUN_PATH, JSON.stringify({ lastRun: new Date().toISOString() }));
    return;
  }

  // Step 2: Enrich
  if (!SKIP_ENRICH) {
    console.log('🔍 Enriching (Google + Resy + OpenTable)...');
    for (let i = 0; i < newFinds.length; i++) {
      const f = newFinds[i];
      process.stdout.write(`  [${i + 1}/${newFinds.length}] ${f.name.slice(0, 28).padEnd(28)} `);

      // Google
      const g = await enrichGoogle(f.name, f.neighborhood);
      if (g) {
        f.google = g;
        process.stdout.write(`${g.google_rating}★ ${g.google_reviews}rv `);
      } else {
        console.log('❌ not on Google');
        continue;
      }

      // Resy
      const resy = await checkResy(f.name);
      if (resy) {
        f.booking = resy;
        process.stdout.write(`[resy] `);
      } else {
        // OpenTable
        await sleep(200);
        const ot = await checkOpenTable(f.name, g.lat, g.lng);
        if (ot) {
          f.booking = ot;
          process.stdout.write(`[opentable] `);
        }
      }

      console.log(f.instagram ? `📸 @${f.instagram}` : '');
      await sleep(300);
    }
  }

  // Step 3: Save discoveries
  const discoveries = newFinds.map(f => ({
    name: f.name, neighborhood: f.neighborhood, source: 'Eater',
    month: f.month, article_url: f.article_url,
    instagram: f.instagram || null,
    discovered_at: new Date().toISOString(),
    ...(f.google || {}), ...(f.booking || {}),
  }));

  const merged = [...previous, ...discoveries];
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(merged, null, 2));

  // Step 4: Add to BOOKING_MASTER
  let added = 0;
  if (AUTO_ADD) {
    for (const d of discoveries) {
      if (!d.lat) continue;
      const reviews = d.google_reviews || 0;
      const rating = d.google_rating || 0;
      if (reviews > 50 || rating < 4.0) continue; // quality gate

      const key = d.name.toLowerCase().trim();
      if (bm[key]) continue;

      bm[key] = {
        platform: d.platform || '',
        url: d.url || '',
        lat: d.lat, lng: d.lng,
        google_rating: d.google_rating,
        google_reviews: d.google_reviews,
        place_id: d.place_id,
        website: d.website || '',
        address: d.address || '',
        cuisine: d.cuisine || '',
        instagram: d.instagram || '',
        buzz_sources: ['Eater'],
        vibe_tags: ['new_rising', 'trendy'],
        price: d.price || 0,
        new_rising: true,
      };
      added++;
    }
    if (added > 0) fs.writeFileSync(BM_PATH, JSON.stringify(bm, null, 2));
  }

  // Save last run
  fs.writeFileSync(LAST_RUN_PATH, JSON.stringify({ lastRun: new Date().toISOString() }));

  // Results
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`✨ NEW FROM EATER (${discoveries.length})`);
  console.log(`${'═'.repeat(55)}`);
  for (const d of discoveries) {
    const g = d.google_rating ? `${d.google_rating}★ ${d.google_reviews}rv` : '';
    const b = d.platform ? `[${d.platform}]` : '';
    const ig = d.instagram ? `📸 @${d.instagram}` : '';
    console.log(`  ${d.name} (${d.neighborhood || '?'}) ${g} ${b} ${ig}`);
  }

  console.log(`\n💾 Saved ${discoveries.length} discoveries`);
  if (AUTO_ADD) console.log(`📗 Added ${added} to BOOKING_MASTER (${Object.keys(bm).length} total)`);
  if (!AUTO_ADD && discoveries.length) console.log(`Run with --add to auto-add to BOOKING_MASTER`);
  console.log();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
