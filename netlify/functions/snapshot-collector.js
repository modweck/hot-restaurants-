/**
 * NEW RESTAURANT DISCOVERY SCRAPER
 * ==================================
 * Replaces the old snapshot-collector.js
 *
 * WHAT IT DOES:
 *   1. Scrapes Google Maps "Open recently" across Manhattan + key Brooklyn neighborhoods
 *   2. Uses overlapping grid points so nothing slips through the cracks
 *   3. Filters to: 5–30 reviews, 4.4+ rating, food establishments only
 *   4. Cross-checks every result against your BOOKING_MASTER.json
 *   5. Saves anything new to new-restaurant-candidates.json for your review
 *   6. Skips the run automatically if it already ran within 48 hours
 *
 * COST: $0 — no Google API, pure Puppeteer scraping
 *
 * HOW TO RUN:
 *   node snapshot-collector.js
 *
 * REQUIREMENTS:
 *   npm install puppeteer
 *   Node 18+
 *
 * HOW OFTEN:
 *   Every 2 days is safe from your home IP.
 *   A cron job or just run it manually every couple days.
 *
 * OUTPUT:
 *   new-restaurant-candidates.json  ← review this and add good ones to BOOKING_MASTER
 *   last-run.json                   ← tracks when it last ran (for 48hr skip logic)
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ─── CONFIG — update these paths to match your project ───────────────────────

const BOOKING_MASTER_PATH = path.join(__dirname, 'BOOKING_MASTER.json');
const CANDIDATES_PATH     = path.join(__dirname, '../../data/new-restaurant-candidates.json');
const LAST_RUN_PATH       = path.join(__dirname, '../../data/last-run.json');

// Quality filters
const MIN_REVIEWS  = 5;
const MAX_REVIEWS  = 30;
const MIN_RATING   = 4.4;

// How long to wait between neighborhood searches (ms) — be polite to Google
const SEARCH_DELAY_MS  = 3000;
const SCROLL_DELAY_MS  = 2500;
const SCROLL_ROUNDS    = 4;   // ~80 results per neighborhood search

// ─── NEIGHBORHOOD GRID ────────────────────────────────────────────────────────
// Manhattan + key Brooklyn only.
// Overlapping points with ~700m radius so nothing falls through the gaps.
// Each neighborhood has 2 points (east + west or north + south) for full coverage.

const NEIGHBORHOODS = [

  // ── LOWER MANHATTAN ──
  { lat: 40.7074, lng: -74.0113, label: 'Financial District West' },
  { lat: 40.7074, lng: -74.0020, label: 'Financial District East' },
  { lat: 40.7127, lng: -74.0090, label: 'Tribeca West' },
  { lat: 40.7160, lng: -74.0010, label: 'Tribeca East' },

  // ── CHINATOWN / LITTLE ITALY / NOLITA ──
  { lat: 40.7157, lng: -73.9970, label: 'Chinatown' },
  { lat: 40.7218, lng: -73.9966, label: 'Little Italy / Nolita' },

  // ── SOHO ──
  { lat: 40.7233, lng: -74.0030, label: 'SoHo West' },
  { lat: 40.7233, lng: -73.9960, label: 'SoHo East' },

  // ── LOWER EAST SIDE ──
  { lat: 40.7157, lng: -73.9863, label: 'LES North' },
  { lat: 40.7110, lng: -73.9863, label: 'LES South' },

  // ── EAST VILLAGE ──
  { lat: 40.7265, lng: -73.9815, label: 'East Village West' },
  { lat: 40.7265, lng: -73.9750, label: 'East Village East' },

  // ── WEST VILLAGE / MEATPACKING ──
  { lat: 40.7340, lng: -74.0060, label: 'West Village South' },
  { lat: 40.7380, lng: -74.0020, label: 'West Village North' },
  { lat: 40.7420, lng: -74.0060, label: 'Meatpacking / Chelsea South' },

  // ── GREENWICH VILLAGE / NOHO ──
  { lat: 40.7308, lng: -73.9974, label: 'Greenwich Village' },
  { lat: 40.7280, lng: -73.9920, label: 'NoHo' },

  // ── CHELSEA ──
  { lat: 40.7465, lng: -74.0014, label: 'Chelsea West' },
  { lat: 40.7465, lng: -73.9960, label: 'Chelsea East' },

  // ── FLATIRON / GRAMERCY ──
  { lat: 40.7410, lng: -73.9897, label: 'Flatiron' },
  { lat: 40.7380, lng: -73.9840, label: 'Gramercy' },
  { lat: 40.7440, lng: -73.9840, label: 'Gramercy North / Murray Hill South' },

  // ── MURRAY HILL / KIPS BAY ──
  { lat: 40.7480, lng: -73.9780, label: 'Murray Hill' },
  { lat: 40.7430, lng: -73.9780, label: 'Kips Bay' },

  // ── HELL'S KITCHEN / CLINTON ──
  { lat: 40.7600, lng: -73.9940, label: "Hell's Kitchen South" },
  { lat: 40.7650, lng: -73.9910, label: "Hell's Kitchen North" },

  // ── MIDTOWN ──
  { lat: 40.7549, lng: -73.9840, label: 'Midtown West' },
  { lat: 40.7549, lng: -73.9760, label: 'Midtown East' },
  { lat: 40.7580, lng: -73.9700, label: 'Midtown East / Turtle Bay' },

  // ── UPPER WEST SIDE ──
  { lat: 40.7751, lng: -73.9826, label: 'UWS South' },
  { lat: 40.7830, lng: -73.9800, label: 'UWS Mid' },
  { lat: 40.7900, lng: -73.9750, label: 'UWS North' },

  // ── UPPER EAST SIDE ──
  { lat: 40.7736, lng: -73.9580, label: 'UES South' },
  { lat: 40.7800, lng: -73.9530, label: 'UES Mid' },
  { lat: 40.7860, lng: -73.9500, label: 'UES North / Yorkville' },

  // ── HARLEM / EAST HARLEM ──
  { lat: 40.8075, lng: -73.9626, label: 'Harlem West' },
  { lat: 40.8075, lng: -73.9450, label: 'Harlem East' },
  { lat: 40.7957, lng: -73.9372, label: 'East Harlem' },
  { lat: 40.8160, lng: -73.9550, label: 'Harlem North' },

  // ── WASHINGTON HEIGHTS / INWOOD ──
  { lat: 40.8340, lng: -73.9410, label: 'Washington Heights South' },
  { lat: 40.8510, lng: -73.9370, label: 'Washington Heights North' },
  { lat: 40.8680, lng: -73.9210, label: 'Inwood' },

  // ── BROOKLYN: WILLIAMSBURG ──
  { lat: 40.7140, lng: -73.9613, label: 'Williamsburg North' },
  { lat: 40.7081, lng: -73.9571, label: 'Williamsburg South' },
  { lat: 40.7140, lng: -73.9500, label: 'Williamsburg East' },

  // ── BROOKLYN: GREENPOINT ──
  { lat: 40.7290, lng: -73.9520, label: 'Greenpoint' },

  // ── BROOKLYN: DUMBO / BROOKLYN HEIGHTS ──
  { lat: 40.7033, lng: -73.9900, label: 'DUMBO' },
  { lat: 40.6960, lng: -73.9940, label: 'Brooklyn Heights' },

  // ── BROOKLYN: PARK SLOPE / GOWANUS ──
  { lat: 40.6782, lng: -73.9780, label: 'Park Slope North' },
  { lat: 40.6700, lng: -73.9800, label: 'Park Slope South' },
  { lat: 40.6760, lng: -73.9890, label: 'Gowanus' },

  // ── BROOKLYN: COBBLE HILL / CARROLL GARDENS / BOERUM HILL ──
  { lat: 40.6860, lng: -73.9960, label: 'Cobble Hill' },
  { lat: 40.6800, lng: -74.0000, label: 'Carroll Gardens' },
  { lat: 40.6880, lng: -73.9880, label: 'Boerum Hill' },

  // ── BROOKLYN: BED-STUY / CROWN HEIGHTS ──
  { lat: 40.6872, lng: -73.9418, label: 'Bed-Stuy West' },
  { lat: 40.6820, lng: -73.9300, label: 'Bed-Stuy East' },
  { lat: 40.6710, lng: -73.9442, label: 'Crown Heights' },

  // ── BROOKLYN: BUSHWICK ──
  { lat: 40.6950, lng: -73.9200, label: 'Bushwick West' },
  { lat: 40.6950, lng: -73.9050, label: 'Bushwick East' },

];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Normalize a name for comparison — same logic as BOOKING_MASTER
 */
function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip accents
    .replace(/[''`]/g, '')             // strip apostrophes
    .replace(/&/g, 'and')             // & → and
    .replace(/[-–—]/g, ' ')           // hyphens → space
    .replace(/[^a-z0-9 ]/g, '')       // remove everything else
    .replace(/\s+/g, ' ')             // collapse spaces
    .trim();
}

/**
 * Load BOOKING_MASTER and return a Set of normalized names
 */
function loadBookingMaster() {
  if (!fs.existsSync(BOOKING_MASTER_PATH)) {
    console.error(`❌ BOOKING_MASTER not found at: ${BOOKING_MASTER_PATH}`);
    console.error('   Update BOOKING_MASTER_PATH at the top of this file.');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(BOOKING_MASTER_PATH, 'utf8'));
  const nameSet = new Set(Object.keys(data).map(k => normalizeName(k)));
  console.log(`✅ Loaded BOOKING_MASTER — ${Object.keys(data).length} restaurants, ${nameSet.size} unique names`);
  return nameSet;
}

/**
 * Load existing candidates so we don't re-add restaurants from previous runs
 */
function loadExistingCandidates() {
  if (!fs.existsSync(CANDIDATES_PATH)) return [];
  return JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8'));
}

/**
 * Check if we ran within the last 48 hours — if so, skip
 */
function checkLastRun() {
  if (!fs.existsSync(LAST_RUN_PATH)) return false;
  const { lastRun } = JSON.parse(fs.readFileSync(LAST_RUN_PATH, 'utf8'));
  const hoursSince = (Date.now() - new Date(lastRun).getTime()) / 3600000;
  return hoursSince < 48;
}

function saveLastRun() {
  fs.writeFileSync(LAST_RUN_PATH, JSON.stringify({ lastRun: new Date().toISOString() }, null, 2));
}

// ─── SCRAPE ONE NEIGHBORHOOD ──────────────────────────────────────────────────

async function scrapeNeighborhood(page, neighborhood) {
  // Build a Google Maps URL centered on this neighborhood
  // The "!4m3!2m2!5m1!1e6" at the end applies the "Open recently" filter
  const { lat, lng, label } = neighborhood;
  const zoom = 15;
  const url = `https://www.google.com/maps/search/restaurants/@${lat},${lng},${zoom}z/data=!4m3!2m2!5m1!1e6`;

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // Wait for results panel
    const feedExists = await page.$('[role="feed"]').catch(() => null);
    if (!feedExists) {
      console.log(`  ⚠️  ${label}: no results panel found, skipping`);
      return [];
    }

    // Scroll through results to load more
    for (let i = 0; i < SCROLL_ROUNDS; i++) {
      await page.evaluate(() => {
        const feed = document.querySelector('[role="feed"]');
        if (feed) feed.scrollTop += 2000;
      });
      await sleep(SCROLL_DELAY_MS);
    }

    // Extract all restaurant cards
    const results = await page.evaluate((minReviews, maxReviews, minRating) => {
      const restaurants = [];
      const cards = document.querySelectorAll('[role="feed"] > div');

      cards.forEach(card => {
        // Name from the main link's aria-label
        const nameEl = card.querySelector('a[aria-label]');
        const name = nameEl?.getAttribute('aria-label')?.trim();
        if (!name || name.length < 2) return;

        // Link to the Google Maps page
        const link = nameEl?.href || null;

        // Rating — aria-label like "4.7 stars"
        const ratingEl = card.querySelector('[aria-label*="stars"]');
        const ratingMatch = ratingEl?.getAttribute('aria-label')?.match(/[\d.]+/);
        const rating = ratingMatch ? parseFloat(ratingMatch[0]) : null;

        // Review count — look for a number in parentheses like "(123)"
        const allText = card.innerText || '';
        const reviewMatch = allText.match(/\((\d+(?:,\d+)?)\)/);
        const reviewCount = reviewMatch ? parseInt(reviewMatch[1].replace(',', '')) : null;

        // Address — look for text that looks like a street address
        const spans = Array.from(card.querySelectorAll('span'));
        let address = null;
        for (const span of spans) {
          const t = span.textContent.trim();
          if (t.length > 8 && t.length < 100 &&
              (t.match(/\d+\s+\w/) || t.includes(' St') || t.includes(' Ave') ||
               t.includes(' Blvd') || t.includes(' Rd') || t.includes(' Pl'))) {
            address = t;
            break;
          }
        }

        // Apply quality filters right here in the browser
        if (!rating || rating < minRating) return;
        if (reviewCount === null) return;
        if (reviewCount < minReviews || reviewCount > maxReviews) return;

        restaurants.push({ name, rating, reviewCount, address, link });
      });

      return restaurants;
    }, MIN_REVIEWS, MAX_REVIEWS, MIN_RATING);

    console.log(`  ✅ ${label}: ${results.length} qualifying restaurants found`);
    return results;

  } catch (err) {
    console.log(`  ❌ ${label}: ${err.message}`);
    return [];
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🍽️  New Restaurant Discovery Scraper');
  console.log('=====================================');
  console.log(`📅 ${new Date().toLocaleString()}`);
  console.log(`🎯 Filters: ${MIN_REVIEWS}–${MAX_REVIEWS} reviews, ${MIN_RATING}+ rating, Open recently\n`);

  // ── 48-hour check ──
  if (checkLastRun()) {
    console.log('⏱️  Already ran within 48 hours. Skipping to avoid Google rate limits.');
    console.log('   Delete last-run.json to force a re-run.\n');
    process.exit(0);
  }

  // ── Load BOOKING_MASTER ──
  const existingNames = loadBookingMaster();

  // ── Load previous candidates so we don't duplicate ──
  const existingCandidates = loadExistingCandidates();
  const existingCandidateNames = new Set(existingCandidates.map(r => normalizeName(r.name)));
  console.log(`📁 ${existingCandidates.length} candidates already saved from previous runs\n`);

  // ── Launch browser ──
  console.log('🌐 Launching browser...\n');
  const browser = await puppeteer.launch({
    headless: false,  // Set to true to run in background without opening a window
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 900 }
  });

  const page = await browser.newPage();

  // Real user agent so Google doesn't flag us
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/120.0.0.0 Safari/537.36'
  );

  // Collect all results across all neighborhoods
  const allRaw = [];

  try {
    for (let i = 0; i < NEIGHBORHOODS.length; i++) {
      const neighborhood = NEIGHBORHOODS[i];
      console.log(`[${i + 1}/${NEIGHBORHOODS.length}] Searching ${neighborhood.label}...`);

      const results = await scrapeNeighborhood(page, neighborhood);
      allRaw.push(...results);

      // Pause between neighborhoods — important to avoid IP block
      if (i < NEIGHBORHOODS.length - 1) {
        await sleep(SEARCH_DELAY_MS);
      }
    }
  } finally {
    await browser.close();
    console.log('\n✅ Browser closed');
  }

  // ── Deduplicate by normalized name across all neighborhood results ──
  console.log(`\n📊 Total raw results across all neighborhoods: ${allRaw.length}`);

  const seenThisRun = new Set();
  const deduped = [];
  for (const r of allRaw) {
    const key = normalizeName(r.name);
    if (seenThisRun.has(key)) continue;
    seenThisRun.add(key);
    deduped.push(r);
  }
  console.log(`   After deduplication: ${deduped.length} unique restaurants`);

  // ── Cross-check against BOOKING_MASTER and previous candidates ──
  let alreadyInMaster   = 0;
  let alreadyCandidate  = 0;
  const newCandidates   = [];

  for (const r of deduped) {
    const key = normalizeName(r.name);

    if (existingNames.has(key)) {
      alreadyInMaster++;
      continue;
    }

    if (existingCandidateNames.has(key)) {
      alreadyCandidate++;
      continue;
    }

    // Brand new — not in BOOKING_MASTER, not seen before
    newCandidates.push({
      name:           r.name,
      address:        r.address || 'Unknown',
      rating:         r.rating,
      reviewCount:    r.reviewCount,
      googleMapsLink: r.link || null,
      discoveredAt:   new Date().toISOString(),
      addedToMaster:  false   // flip to true once you add it to BOOKING_MASTER
    });
  }

  // ── Print summary ──
  console.log(`\n📈 RESULTS:`);
  console.log(`   Already in BOOKING_MASTER:     ${alreadyInMaster}`);
  console.log(`   Already in candidates file:    ${alreadyCandidate}`);
  console.log(`   ✨ New candidates this run:    ${newCandidates.length}`);

  // ── Sort by rating desc, then review count desc ──
  newCandidates.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);

  // ── Merge with existing candidates and save ──
  const merged = [...existingCandidates, ...newCandidates];
  fs.writeFileSync(CANDIDATES_PATH, JSON.stringify(merged, null, 2));
  console.log(`\n💾 Saved ${merged.length} total candidates to: ${CANDIDATES_PATH}`);

  // ── Preview new finds ──
  if (newCandidates.length > 0) {
    console.log('\n🆕 New restaurants found this run:');
    newCandidates.slice(0, 15).forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.name} — ⭐ ${r.rating} — ${r.reviewCount} reviews — ${r.address}`);
    });
    if (newCandidates.length > 15) {
      console.log(`   ... and ${newCandidates.length - 15} more in the file`);
    }
  } else {
    console.log('\n💤 No new candidates this run.');
  }

  // ── Save last run timestamp ──
  saveLastRun();

  console.log('\n✅ Done! Run again in 2 days.');
  console.log(`   Review new-restaurant-candidates.json and add good ones to BOOKING_MASTER`);
  console.log(`   with new_and_rising: true\n`);
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
