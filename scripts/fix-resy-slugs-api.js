/**
 * fix-resy-slugs-api.js
 *
 * Uses Resy search API to find correct slugs for locked restaurants.
 * Much faster than Puppeteer — one API call per restaurant.
 * Updates booking_lookup.json with fixed URLs.
 *
 * RUN:   node scripts/fix-resy-slugs-api.js
 * OPTIONS:
 *   --quick       First 20 only
 *   --batch N     Check N then stop
 */

const fs = require('fs');
const path = require('path');

const LOOKUP_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'booking_lookup.json');
const AVAIL_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'tonight_availability.json');
const SCRIPT_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'resy-tonight-check.js');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'resy_slug_fixes.json');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
function getArg(name, def) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}
const BATCH_LIMIT = parseInt(getArg('batch', '0'), 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Extract API key and tokens from resy-tonight-check.js
const src = fs.readFileSync(SCRIPT_FILE, 'utf8');
const RESY_API_KEY = src.match(/RESY_API_KEY\s*=\s*['"]([^'"]+)/)[1];
const RESY_TOKENS = src.match(/RESY_TOKENS\s*=\s*\[([\s\S]*?)\]/)[1].match(/['"]([^'"]+)['"]/g).map(t => t.replace(/['"]/g, ''));
let tokenIdx = 0;

function getHeaders() {
  const token = RESY_TOKENS[tokenIdx % RESY_TOKENS.length];
  tokenIdx++;
  return {
    'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
    'X-Resy-Auth-Token': token,
    'Content-Type': 'application/json'
  };
}

// Search Resy for a restaurant name, return best matching slug
async function searchResy(name) {
  try {
    const resp = await fetch('https://api.resy.com/3/venuesearch/search', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ query: name, geo: { latitude: 40.7128, longitude: -74.006 }, types: ['venue'], per_page: 5 }),
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const hits = data?.search?.hits || [];
    if (hits.length === 0) return null;

    // Score matches by name similarity
    const nameWords = name.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 1);

    for (const hit of hits) {
      const hitName = (hit.name || '').toLowerCase();
      const matchCount = nameWords.filter(w => hitName.includes(w)).length;
      const ratio = nameWords.length > 0 ? matchCount / nameWords.length : 0;

      // Also check if slug contains name words
      const slug = hit.url_slug || '';
      const slugMatch = nameWords.filter(w => slug.includes(w)).length;
      const slugRatio = nameWords.length > 0 ? slugMatch / nameWords.length : 0;

      if (ratio >= 0.5 || slugRatio >= 0.5) {
        // Check it's in NYC area
        const loc = (hit.location || hit.neighborhood || '').toLowerCase();
        const isNYC = loc.includes('new york') || loc.includes('brooklyn') || loc.includes('queens') ||
                     loc.includes('bronx') || loc.includes('ny') || loc === '' || // empty location = probably NYC
                     slug.includes('ny') || slug.includes('brooklyn');

        if (isNYC || ratio >= 0.8) {
          return {
            slug: hit.url_slug,
            name: hit.name,
            venueId: hit.id?.resy || hit.objectID,
            url: `https://resy.com/cities/ny/${hit.url_slug}`,
            matchRatio: Math.max(ratio, slugRatio)
          };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Verify a slug works via /3/venue
async function verifySlug(slug) {
  try {
    const resp = await fetch(`https://api.resy.com/3/venue?url_slug=${slug}&location=ny`, {
      headers: getHeaders(),
      signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return { venueId: data?.id?.resy, name: data?.name, slug: data?.url_slug || slug };
  } catch {
    return null;
  }
}

async function main() {
  const lookup = JSON.parse(fs.readFileSync(LOOKUP_FILE, 'utf8'));
  const avail = JSON.parse(fs.readFileSync(AVAIL_FILE, 'utf8'));
  let results = {};
  try { results = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}

  // Get locked Resy restaurants
  const locked = Object.entries(avail)
    .filter(([k, v]) => !k.startsWith('_') && v.fully_locked)
    .map(([name]) => name)
    .filter(name => {
      const entry = lookup[name] || lookup[Object.keys(lookup).find(k => k.toLowerCase() === name)];
      return entry && entry.platform === 'resy' && entry.url;
    })
    .filter(name => !results[name]);

  let todo = locked;
  if (QUICK) todo = todo.slice(0, 20);
  if (BATCH_LIMIT > 0) todo = todo.slice(0, BATCH_LIMIT);

  console.log(`\n🔧 Resy Slug Fixer (API Search)`);
  console.log(`📋 Locked Resy restaurants: ${locked.length}`);
  console.log(`✅ Already checked: ${Object.keys(results).length}`);
  console.log(`📋 To check: ${todo.length}`);
  console.log(`${'═'.repeat(55)}\n`);

  if (todo.length === 0) { printSummary(results); return; }

  let fixed = 0, correct = 0, notFound = 0;

  for (let i = 0; i < todo.length; i++) {
    const name = todo[i];
    const lookupKey = Object.keys(lookup).find(k => k.toLowerCase() === name.toLowerCase()) || name;
    const entry = lookup[lookupKey];
    const currentSlug = entry.url.match(/\/([a-z0-9_-]+)\/?$/i)?.[1] || '';

    process.stdout.write(`  [${i + 1}/${todo.length}] ${name.substring(0, 35).padEnd(35)} `);

    // Step 1: Verify current slug
    const current = await verifySlug(currentSlug);
    await sleep(500 + Math.random() * 500);

    if (current) {
      results[name] = { slug: currentSlug, venueName: current.name, venueId: current.venueId, status: 'correct' };
      correct++;
      console.log(`✅ slug works (${current.name})`);
    } else {
      // Step 2: Search for correct slug
      const found = await searchResy(name);
      await sleep(500 + Math.random() * 500);

      if (found) {
        // Step 3: Verify the found slug
        const verified = await verifySlug(found.slug);
        await sleep(500 + Math.random() * 500);

        if (verified) {
          results[name] = {
            oldSlug: currentSlug,
            newSlug: found.slug,
            newUrl: found.url,
            venueName: found.name,
            venueId: verified.venueId,
            matchRatio: found.matchRatio,
            status: 'fixed'
          };
          fixed++;
          console.log(`🔧 ${currentSlug} → ${found.slug} (${found.name})`);
        } else {
          results[name] = { slug: currentSlug, searchHit: found.slug, status: 'unverified' };
          notFound++;
          console.log(`🟡 found ${found.slug} but unverified`);
        }
      } else {
        results[name] = { slug: currentSlug, status: 'not_found' };
        notFound++;
        console.log(`💀 not found`);
      }
    }

    // Save every 25
    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
      console.log(`    💾 Progress saved`);
    }

    await sleep(1000 + Math.random() * 1000);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

  // Apply fixes
  const fixes = Object.entries(results).filter(([, v]) => v.status === 'fixed');
  if (fixes.length > 0) {
    console.log(`\n📝 Applying ${fixes.length} slug fixes to booking_lookup.json...\n`);
    for (const [name, fix] of fixes) {
      const lk = Object.keys(lookup).find(k => k.toLowerCase() === name.toLowerCase()) || name;
      if (lookup[lk]) {
        lookup[lk].url = fix.newUrl;
        if (fix.venueId) lookup[lk].venue_id = fix.venueId;
      }
    }
    fs.writeFileSync(LOOKUP_FILE, JSON.stringify(lookup, null, 2));
    console.log(`✅ booking_lookup.json updated with ${fixes.length} fixes`);
  }

  printSummary(results);
}

function printSummary(results) {
  const entries = Object.values(results);
  const fixed = entries.filter(v => v.status === 'fixed').length;
  const correct = entries.filter(v => v.status === 'correct').length;
  const notFound = entries.filter(v => v.status === 'not_found').length;
  const unverified = entries.filter(v => v.status === 'unverified').length;

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`📊 SUMMARY (${entries.length} checked)`);
  console.log(`   🔧 Fixed slugs: ${fixed}`);
  console.log(`   ✅ Already correct: ${correct}`);
  console.log(`   💀 Not found: ${notFound}`);
  console.log(`   🟡 Unverified: ${unverified}`);
  console.log(`\n💾 Results: data/resy_slug_fixes.json`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
