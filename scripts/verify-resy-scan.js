/**
 * verify-resy-scan.js
 *
 * Takes the 181 Resy finds from website_platform_scan.json,
 * extracts slugs from links/signals, then verifies each against
 * the Resy API to check if the listing is actually live/bookable.
 *
 * OUTPUT: data/resy_scan_verification.json (for manual review)
 * DOES NOT modify BOOKING_MASTER.
 *
 * RUN:
 *   node scripts/verify-resy-scan.js
 *   node scripts/verify-resy-scan.js --resume
 *   node scripts/verify-resy-scan.js --limit 30
 */

const fs = require('fs');
const path = require('path');

const SCAN_FILE = path.join(__dirname, '..', 'data', 'website_platform_scan.json');
const OUTPUT = path.join(__dirname, '..', 'data', 'resy_scan_verification.json');

const args = process.argv.slice(2);
const RESUME = args.includes('--resume');
const LIMIT = parseInt((args.includes('--limit') && args[args.indexOf('--limit') + 1]) || '9999', 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Resy API config ──
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

// ── Extract slug from resy links/signals ──
function extractSlug(resyData) {
  // First check if slug was already extracted
  if (resyData.slug) return resyData.slug;

  // Try to extract from signal links
  const signals = resyData.signals || [];
  for (const sig of signals) {
    // Match: resy.com/cities/XX/SLUG or resy.com/cities/XX/venues/SLUG
    const m = sig.match(/resy\.com\/cities\/[a-z-]+\/(?:venues\/)?([a-z0-9_-]+)/i);
    if (m && !['global-dining-access', 'resycredit', 'resyos'].includes(m[1].toLowerCase())) {
      return m[1].toLowerCase();
    }
  }
  return null;
}

// ── Check if signals are just generic resy.com links (false positive) ──
function isFalsePositive(resyData) {
  const signals = resyData.signals || [];
  const genericPatterns = [
    /resy\.com\/global-dining/i,
    /resy\.com\/resycredit/i,
    /resy\.com\/resyos/i,
    /resy\.com\/about/i,
    /resy\.com\/?$/i,
    /resy\.com\/gift-cards/i,
    /rum\.browser-intake-datadoghq/i,  // DataDog analytics, not Resy
  ];

  // If all signals match generic patterns, it's a false positive
  const realSignals = signals.filter(sig => {
    return !genericPatterns.some(p => p.test(sig));
  });

  // Also check for just "widgets.resy.com" embed without a venue link
  // These are likely real (embedded widget)
  const hasWidget = signals.some(s => /widgets\.resy\.com/i.test(s));
  const hasVenueLink = signals.some(s => /resy\.com\/cities\/[a-z-]+\/[a-z0-9_-]+/i.test(s));

  if (realSignals.length === 0) return true;
  return false;
}

// ── Resy API: resolve slug to venue ──
async function resolveVenue(slug) {
  try {
    const resp = await fetch(
      `https://api.resy.com/3/venue?url_slug=${slug}&location=ny`,
      { headers: getHeaders(), signal: AbortSignal.timeout(10000) }
    );
    if (!resp.ok) return { exists: false, status: resp.status };
    const data = await resp.json();
    return {
      exists: true,
      venue_id: data?.id?.resy || null,
      venue_name: data?.name || null,
      location: data?.location?.name || null,
      type: data?.type || null,
    };
  } catch (e) {
    return { exists: false, error: e.message };
  }
}

// ── Resy API: check availability ──
async function checkAvailability(venueId, slug) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const date = tomorrow.toISOString().split('T')[0];

  // Also check a week out (more likely to have slots)
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const dateWeek = nextWeek.toISOString().split('T')[0];

  for (const day of [date, dateWeek]) {
    try {
      const qs = venueId ? `venue_id=${venueId}` : `slug=${slug}&location=ny`;
      const url = `https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${day}&party_size=2&${qs}`;
      const resp = await fetch(url, { headers: getHeaders(), signal: AbortSignal.timeout(10000) });
      if (!resp.ok) continue;
      const data = await resp.json();
      const slots = data?.results?.venues?.[0]?.slots || [];
      if (slots.length > 0) {
        return { bookable: true, date: day, slotCount: slots.length };
      }
    } catch (e) {}
  }
  return { bookable: false };
}

async function main() {
  const scan = JSON.parse(fs.readFileSync(SCAN_FILE, 'utf8'));

  // Extract all Resy finds
  const candidates = [];
  for (const [name, info] of Object.entries(scan.found)) {
    if (!info.platforms?.resy) continue;
    const resyData = info.platforms.resy;

    if (isFalsePositive(resyData)) {
      candidates.push({ name, status: 'false_positive', signals: resyData.signals });
      continue;
    }

    const slug = extractSlug(resyData);
    candidates.push({
      name,
      slug,
      website: info.url,
      signals: resyData.signals,
      status: slug ? 'to_verify' : 'no_slug'
    });
  }

  console.log(`Resy scan results: ${candidates.length} total`);
  console.log(`  False positives: ${candidates.filter(c => c.status === 'false_positive').length}`);
  console.log(`  No slug found: ${candidates.filter(c => c.status === 'no_slug').length}`);
  console.log(`  To verify: ${candidates.filter(c => c.status === 'to_verify').length}`);
  console.log();

  // Load previous results if resuming
  let results = { active: [], exists_but_booked: [], dead: [], false_positive: [], no_slug: [], errors: [] };
  if (RESUME && fs.existsSync(OUTPUT)) {
    try {
      results = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
      console.log(`Resuming — ${Object.values(results).flat().length} already checked`);
    } catch (e) {}
  }
  const checked = new Set([
    ...results.active.map(r => r.name),
    ...results.exists_but_booked.map(r => r.name),
    ...results.dead.map(r => r.name),
    ...results.false_positive.map(r => r.name),
    ...results.no_slug.map(r => r.name),
    ...results.errors.map(r => r.name),
  ]);

  // Add false positives and no-slugs immediately
  for (const c of candidates) {
    if (checked.has(c.name)) continue;
    if (c.status === 'false_positive') {
      results.false_positive.push({ name: c.name, signals: c.signals });
      checked.add(c.name);
    } else if (c.status === 'no_slug') {
      results.no_slug.push({ name: c.name, website: c.website, signals: c.signals });
      checked.add(c.name);
    }
  }

  // Verify the ones with slugs
  const toVerify = candidates.filter(c => c.status === 'to_verify' && !checked.has(c.name)).slice(0, LIMIT);
  console.log(`Verifying ${toVerify.length} against Resy API...\n`);

  for (let i = 0; i < toVerify.length; i++) {
    const c = toVerify[i];
    process.stdout.write(`[${i + 1}/${toVerify.length}] ${c.name} (${c.slug}) ... `);

    try {
      // Step 1: resolve venue
      const venue = await resolveVenue(c.slug);
      await sleep(3000 + Math.random() * 2000); // 3-5s rate limit

      if (!venue.exists) {
        console.log(`DEAD (${venue.status || venue.error})`);
        results.dead.push({ name: c.name, slug: c.slug, website: c.website, reason: `venue not found: ${venue.status || venue.error}` });
      } else {
        // Step 2: check availability
        const avail = await checkAvailability(venue.venue_id, c.slug);
        await sleep(3000 + Math.random() * 2000);

        if (avail.bookable) {
          console.log(`ACTIVE - ${avail.slotCount} slots on ${avail.date} (venue: ${venue.venue_name})`);
          results.active.push({
            name: c.name,
            slug: c.slug,
            venue_id: venue.venue_id,
            venue_name: venue.venue_name,
            website: c.website,
            sample_slots: avail.slotCount,
            sample_date: avail.date
          });
        } else {
          console.log(`EXISTS but fully booked (venue: ${venue.venue_name})`);
          results.exists_but_booked.push({
            name: c.name,
            slug: c.slug,
            venue_id: venue.venue_id,
            venue_name: venue.venue_name,
            website: c.website
          });
        }
      }
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      results.errors.push({ name: c.name, slug: c.slug, error: e.message });
    }

    // Save every 10
    if ((i + 1) % 10 === 0) {
      fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
    }
  }

  // Final save
  fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));

  console.log('\n════════════════════════════════════');
  console.log('VERIFICATION COMPLETE');
  console.log('════════════════════════════════════');
  console.log(`  ACTIVE (bookable):       ${results.active.length}`);
  console.log(`  EXISTS (fully booked):   ${results.exists_but_booked.length}`);
  console.log(`  DEAD (no listing):       ${results.dead.length}`);
  console.log(`  FALSE POSITIVE:          ${results.false_positive.length}`);
  console.log(`  NO SLUG (manual check):  ${results.no_slug.length}`);
  console.log(`  ERRORS:                  ${results.errors.length}`);
  console.log(`\nResults saved to: data/resy_scan_verification.json`);
  console.log('Review before making any changes to BOOKING_MASTER!');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
