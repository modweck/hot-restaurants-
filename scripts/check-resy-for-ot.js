/**
 * Check if OT restaurants exist on Resy by trying slug variations.
 * Uses Resy venue API (slug lookup), not search.
 * Double-checks NYC location.
 */
const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, '..', 'data', 'ot_check_resy.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'ot_resy_matches.json');

const RESY_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const AUTH_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzc5MDk0MTQsInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.AWCYkK7wyE0h-KnU7IMnRzUTPpPPh_B7t2ZsXPKg3Pj4uTvQvtGRLLUwG1TYB7yulCfq2U3iD6UdtQgyR4ashAnHAAcrbXK3jAr0BT6YPjHWHadcdlT8KUpeSv2Dixv-PlrW0gfm1eKtocNFz7qn-p14iVgI2YnLZU_KwoUsB3fW0Co1';

const HEADERS = {
  'Authorization': `ResyAPI api_key="${RESY_KEY}"`,
  'X-Resy-Auth-Token': AUTH_TOKEN,
  'X-Resy-Universal-Auth': AUTH_TOKEN,
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Origin': 'https://resy.com',
  'Referer': 'https://resy.com/',
  'Accept': 'application/json',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isNYC(lat, lng) {
  if (!lat || !lng) return false;
  return lat >= 40.48 && lat <= 40.95 && lng >= -74.27 && lng <= -73.68;
}

// Generate possible Resy slugs from restaurant name
function generateSlugs(name) {
  const base = name.toLowerCase()
    .replace(/[''"]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const slugs = [base];

  // No hyphens version (69leonardstreet style)
  const noHyphens = base.replace(/-/g, '');
  slugs.push(noHyphens);

  // Just first word (daniel, shion, etc)
  const firstWord = base.split('-')[0];
  if (firstWord.length > 2) slugs.push(firstWord);

  // First two words
  const parts = base.split('-');
  if (parts.length >= 2) slugs.push(parts.slice(0, 2).join('-'));

  // Without common suffixes/locations
  const cleaned = base
    .replace(/-?(new-york|nyc|manhattan|brooklyn|queens|bronx|harlem|tribeca|soho|east-village|west-village|ues|uws|les|midtown|hells-kitchen|astoria|williamsburg|greenpoint|bushwick|park-slope|flatiron|gramercy|nolita|chelsea|44th-street|upper-west-side|upper-east-side)$/g, '')
    .replace(/-$/g, '');
  if (cleaned !== base && cleaned.length > 2) slugs.push(cleaned);

  // Without "restaurant", "ristorante" etc
  const noType = base
    .replace(/-?(restaurant|ristorante|trattoria|osteria|bistro|cafe|bar-and-grill|bar|grill|kitchen|steakhouse|reservations)$/g, '')
    .replace(/-$/g, '');
  if (noType !== base && noType.length > 2) slugs.push(noType);

  // Remove "the-"
  if (base.startsWith('the-')) {
    slugs.push(base.slice(4));
    slugs.push(base.slice(4).replace(/-/g, ''));
  }

  // With "-nyc" suffix
  slugs.push(base + '-nyc');
  if (cleaned !== base) slugs.push(cleaned + '-nyc');

  return [...new Set(slugs)].filter(s => s.length > 1);
}

async function checkVenue(slug) {
  try {
    const res = await fetch(`https://api.resy.com/3/venue?url_slug=${slug}&location=ny`, { headers: HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === 404 || data.code === 1041) return null;
    if (!data.name) return null;

    const lat = data.location?.latitude;
    const lng = data.location?.longitude;
    if (lat && lng && !isNYC(lat, lng)) return null; // wrong city

    return {
      name: data.name,
      slug: data.url_slug,
      id: data.id?.resy,
      neighborhood: data.location?.neighborhood,
      lat, lng,
      is_active: data.is_active,
    };
  } catch (e) {
    return null;
  }
}

async function main() {
  const toCheck = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  console.log(`🔍 Checking ${toCheck.length} restaurants on Resy (slug lookup)\n`);

  const results = [];
  let found = 0, notFound = 0, checked = 0;

  for (const r of toCheck) {
    const slugs = generateSlugs(r.name);
    let match = null;

    for (const slug of slugs) {
      match = await checkVenue(slug);
      if (match) break;
      await sleep(300);
    }

    checked++;

    if (match) {
      found++;
      results.push({
        name: r.name,
        resy_match: true,
        resy_name: match.name,
        resy_slug: match.slug,
        resy_id: match.id,
        resy_url: `https://resy.com/cities/new-york-ny/venues/${match.slug}`,
        neighborhood: match.neighborhood,
        is_active: match.is_active,
      });
      console.log(`  ✅ [${checked}/${toCheck.length}] ${r.name} → ${match.name} (${match.slug})`);
    } else {
      notFound++;
      results.push({ name: r.name, resy_match: false, slugs_tried: slugs.length });
      if (checked % 20 === 0 || checked <= 20) console.log(`  ❌ [${checked}/${toCheck.length}] ${r.name}`);
    }

    if (checked % 50 === 0) fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    await sleep(700);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Done! Checked ${checked} restaurants`);
  console.log(`   ✅ Found on Resy: ${found}`);
  console.log(`   ❌ Not on Resy: ${notFound}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
