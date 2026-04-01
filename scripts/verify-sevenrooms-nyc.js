/**
 * verify-sevenrooms-nyc.js
 *
 * Takes the 131+ slugs from sevenrooms_nyc_directory.json and:
 * 1. Visits each sevenrooms.com/reservations/{slug} to confirm it's live
 * 2. Extracts the restaurant name from the page
 * 3. Uses Google Places API to confirm it's actually in NYC
 *
 * Saves verified NYC restaurants to data/sevenrooms_nyc_verified.json
 *
 * RUN: node scripts/verify-sevenrooms-nyc.js
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const INPUT = path.join(__dirname, '..', 'data', 'sevenrooms_nyc_directory.json');
const OUTPUT = path.join(__dirname, '..', 'data', 'sevenrooms_nyc_verified.json');
const GOOGLE_API_KEY = 'AIzaSyDrtbSIA_BvJIzq1_-3pfQ_RgP2DiM_TKo';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// NYC bounding: roughly lat 40.4-40.95, lng -74.3 to -73.7
function isNYC(lat, lng) {
  return lat >= 40.4 && lat <= 40.95 && lng >= -74.3 && lng <= -73.7;
}

// NYC-area place names to accept
const NYC_AREAS = [
  'new york', 'manhattan', 'brooklyn', 'queens', 'bronx', 'staten island',
  'nyc', 'ny ', ', ny', 'long island city', 'astoria', 'williamsburg',
  'bushwick', 'greenpoint', 'dumbo', 'harlem', 'soho', 'tribeca',
  'chelsea', 'midtown', 'flatiron', 'gramercy', 'east village',
  'west village', 'lower east side', 'upper east', 'upper west',
  'financial district', 'chinatown', 'little italy', 'nolita', 'noho',
  'hell\'s kitchen', 'murray hill', 'kips bay', 'downtown brooklyn',
  'cobble hill', 'carroll gardens', 'park slope', 'prospect heights',
  'fort greene', 'bed-stuy', 'crown heights', 'red hook'
];

async function googlePlacesCheck(name) {
  // Use Text Search to find the restaurant and check location
  const query = `${name} restaurant New York City`;
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${GOOGLE_API_KEY}`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();

    if (data.results && data.results.length > 0) {
      const place = data.results[0];
      const lat = place.geometry?.location?.lat;
      const lng = place.geometry?.location?.lng;
      const addr = place.formatted_address || '';
      const placeName = place.name || '';

      const inNYC = isNYC(lat, lng) ||
                    NYC_AREAS.some(a => addr.toLowerCase().includes(a));

      return {
        googleName: placeName,
        address: addr,
        lat, lng,
        inNYC,
        rating: place.rating,
        totalRatings: place.user_ratings_total
      };
    }
    return { inNYC: false, reason: 'not_found_on_google' };
  } catch (e) {
    return { inNYC: null, reason: 'api_error', error: e.message };
  }
}

async function main() {
  // Load scraped slugs
  const raw = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const slugs = Object.values(raw.restaurants);
  console.log(`Loaded ${slugs.length} slugs to verify\n`);

  // Load existing results for resuming
  let results = {};
  if (fs.existsSync(OUTPUT)) {
    try {
      results = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
      console.log(`Resuming — ${Object.keys(results.verified || {}).length} already verified\n`);
    } catch (e) {}
  }
  if (!results.verified) results.verified = {};
  if (!results.rejected) results.rejected = {};

  const alreadyDone = new Set([
    ...Object.keys(results.verified),
    ...Object.keys(results.rejected)
  ]);

  const toCheck = slugs.filter(s => !alreadyDone.has(s.slug));
  console.log(`${toCheck.length} remaining to check\n`);

  if (toCheck.length === 0) {
    console.log('All slugs already verified!');
    printSummary(results);
    return;
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1366, height: 768 });

  console.log('═══════════════════════════════════════════════');
  console.log('🔍 Verifying SevenRooms slugs + NYC location');
  console.log('═══════════════════════════════════════════════\n');

  for (let i = 0; i < toCheck.length; i++) {
    const entry = toCheck[i];
    const slug = entry.slug;
    const url = `https://www.sevenrooms.com/reservations/${slug}`;

    try {
      // Step 1: Visit the page
      const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
      await sleep(2000);

      const status = resp?.status();
      const body = await page.evaluate(() => document.body?.innerText?.substring(0, 1000) || '');
      const title = await page.title();

      const isOffMenu = body.includes('off the menu') ||
                        body.includes('page not found') ||
                        body.includes('Page not found') ||
                        body.includes('no longer available') ||
                        status === 404;

      const hasBooking = body.includes('Find a Table') ||
                         body.includes('Reserve') ||
                         body.includes('Party Size') ||
                         body.includes('Select a Date') ||
                         body.includes('Make a Reservation') ||
                         body.includes('Guests') ||
                         body.includes('reservation');

      if (isOffMenu || !hasBooking) {
        results.rejected[slug] = {
          slug,
          name: entry.name || title,
          reason: isOffMenu ? 'off_menu' : 'no_booking_ui',
          status
        };
        console.log(`  ❌ [${i+1}/${toCheck.length}] ${slug} — ${isOffMenu ? 'OFF MENU' : 'no booking UI'}`);
        saveResults(results);
        await sleep(1500);
        continue;
      }

      // Extract clean name from page title
      const pageName = title
        .replace(/\s*[-–|]?\s*SevenRooms.*$/i, '')
        .replace(/\s*[-–|]?\s*Reservation.*$/i, '')
        .replace(/^Reservation\s*(at|for)\s*/i, '')
        .trim();

      // Step 2: Google Places check for NYC
      const cleanName = pageName || entry.name || slug;
      const geo = await googlePlacesCheck(cleanName);

      if (geo.inNYC) {
        results.verified[slug] = {
          slug,
          name: cleanName,
          bookingUrl: url,
          googleName: geo.googleName,
          address: geo.address,
          lat: geo.lat,
          lng: geo.lng,
          rating: geo.rating,
          totalRatings: geo.totalRatings
        };
        console.log(`  ✅ [${i+1}/${toCheck.length}] ${cleanName} → ${slug} (${geo.address?.substring(0, 50)})`);
      } else if (geo.inNYC === null) {
        // API error — keep for retry
        console.log(`  ⚠️  [${i+1}/${toCheck.length}] ${cleanName} → API error, skipping`);
      } else {
        results.rejected[slug] = {
          slug,
          name: cleanName,
          reason: 'not_nyc',
          address: geo.address,
          lat: geo.lat,
          lng: geo.lng
        };
        console.log(`  🚫 [${i+1}/${toCheck.length}] ${cleanName} → NOT NYC (${geo.address?.substring(0, 50)})`);
      }

    } catch (e) {
      console.log(`  ⚠️  [${i+1}/${toCheck.length}] ${slug} — error: ${e.message?.substring(0, 60)}`);
    }

    saveResults(results);
    await sleep(2000);
  }

  await browser.close();
  saveResults(results);
  printSummary(results);
}

function saveResults(results) {
  const output = {
    verified_at: new Date().toISOString(),
    nyc_count: Object.keys(results.verified).length,
    rejected_count: Object.keys(results.rejected).length,
    verified: results.verified,
    rejected: results.rejected
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
}

function printSummary(results) {
  const verified = Object.values(results.verified);
  const rejected = Object.values(results.rejected);
  const notNYC = rejected.filter(r => r.reason === 'not_nyc');
  const offMenu = rejected.filter(r => r.reason === 'off_menu');
  const noUI = rejected.filter(r => r.reason === 'no_booking_ui');

  console.log('\n═══════════════════════════════════════════════');
  console.log('📊 FINAL RESULTS');
  console.log('═══════════════════════════════════════════════\n');
  console.log(`✅ Verified NYC SevenRooms: ${verified.length}`);
  console.log(`🚫 Not in NYC: ${notNYC.length}`);
  console.log(`❌ Off menu / dead: ${offMenu.length}`);
  console.log(`❌ No booking UI: ${noUI.length}`);
  console.log(`\n💾 Saved to ${OUTPUT}`);

  if (verified.length > 0) {
    console.log('\nVerified NYC restaurants:');
    verified.forEach(r => console.log(`  ✅ ${r.name} → sevenrooms.com/reservations/${r.slug}`));
  }

  if (notNYC.length > 0) {
    console.log('\nRejected (not NYC):');
    notNYC.slice(0, 10).forEach(r => console.log(`  🚫 ${r.name} — ${r.address}`));
  }
}

main().catch(e => { console.error('❌', e); process.exit(1); });
