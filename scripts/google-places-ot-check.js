/**
 * google-places-ot-check.js
 *
 * Uses Google Places API to check restaurant profiles for OpenTable booking links.
 * Google Places returns booking URLs for restaurants that have them.
 *
 * RUN:   node scripts/google-places-ot-check.js
 * OPTIONS:
 *   --quick     First 20 only
 *   --batch N   Check N then stop
 *   --resume    Skip already checked
 *
 * OUTPUT: data/ot_from_google_places.json
 */

const fs = require('fs');
const path = require('path');

const PLACES_LIST = path.join(__dirname, 'ot-mention-420-placeids.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'ot_from_google_places.json');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const RESUME = args.includes('--resume');
const BATCH = parseInt(args[args.indexOf('--batch') + 1] || '0', 10);

const KEY = process.env.GOOGLE_PLACES_API_KEY || (() => {
  // Try to load from .env or netlify.toml
  try {
    const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
    const match = toml.match(/GOOGLE_PLACES_API_KEY\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  } catch {}
  try {
    const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const match = env.match(/GOOGLE_PLACES_API_KEY=(.+)/);
    if (match) return match[1].trim();
  } catch {}
  return null;
})();

if (!KEY) {
  console.error('❌ No GOOGLE_PLACES_API_KEY found. Set it in environment or .env');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const places = JSON.parse(fs.readFileSync(PLACES_LIST, 'utf8'));
console.log(`🔍 ${places.length} restaurants to check via Google Places API\n`);

let existing = {};
try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}

async function checkPlace(placeId, name) {
  try {
    // Use Places API v1 (new) to get booking links
    const resp = await fetch(`https://places.googleapis.com/v1/places/${placeId}?languageCode=en`, {
      headers: {
        'X-Goog-Api-Key': KEY,
        'X-Goog-FieldMask': 'displayName,websiteUri,reservable,googleMapsLinks',
      }
    });

    if (!resp.ok) {
      // Fallback to legacy API
      const resp2 = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,website,url,reservable&key=${KEY}`);
      if (!resp2.ok) return { found: false, error: `HTTP ${resp2.status}` };
      const data2 = await resp2.json();
      const result = data2.result || {};
      return {
        found: false,
        reservable: result.reservable || false,
        website: result.website || null
      };
    }

    const data = await resp.json();
    const links = data.googleMapsLinks || {};

    // Check for OT in any booking links
    const allLinks = JSON.stringify(links).toLowerCase();
    const hasOT = allLinks.includes('opentable');

    return {
      found: hasOT,
      reservable: data.reservable || false,
      links: links,
      website: data.websiteUri || null,
    };
  } catch (e) {
    return { found: false, error: e.message?.slice(0, 50) };
  }
}

async function main() {
  let list = [...places];
  if (RESUME) {
    list = list.filter(p => !existing[p.name]);
    console.log(`⏭️  Resuming: ${list.length} remaining`);
  }
  if (QUICK) list = list.slice(0, 20);
  if (BATCH > 0) list = list.slice(0, BATCH);

  console.log(`🔍 Checking ${list.length} restaurants...\n`);

  const results = { ...existing };
  let checked = 0, found = 0, reservable = 0, errors = 0;

  for (const { name, place_id } of list) {
    const result = await checkPlace(place_id, name);
    checked++;

    if (result.found) {
      results[name] = { place_id, ...result };
      found++;
      console.log(`  🟢 [${checked}/${list.length}] ${name} → OT link found`);
    } else if (result.reservable) {
      results[name] = { place_id, ...result, platform_unknown: true };
      reservable++;
      console.log(`  📋 [${checked}/${list.length}] ${name} → reservable (unknown platform)`);
    } else if (result.error) {
      errors++;
      if (checked <= 10) console.log(`  ⚠️  [${checked}/${list.length}] ${name}: ${result.error}`);
    }

    if (checked % 50 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
      console.log(`  💾 Progress: ${found} OT / ${reservable} reservable / ${checked} checked`);
    }

    await sleep(200); // Google API allows higher rate
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Done! Checked ${checked} restaurants`);
  console.log(`   🟢 OT link found: ${found}`);
  console.log(`   📋 Reservable (unknown): ${reservable}`);
  console.log(`   ⚠️  Errors: ${errors}`);
  console.log(`   Output: ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
