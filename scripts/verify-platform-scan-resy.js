/**
 * verify-platform-scan-resy.js
 *
 * Takes the 229 Resy restaurants from website_platform_scan.txt and verifies
 * each one via the Resy API (search → slug verify → bookable check).
 *
 * RUN:   node scripts/verify-platform-scan-resy.js
 * OPTIONS:
 *   --quick    First 10 only
 *   --batch N  Check N then stop
 */

const fs = require('fs');
const path = require('path');

const SCAN_FILE = path.join(__dirname, '..', 'data', 'website_platform_scan.txt');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'platform_scan_resy_verified.json');

const RESY_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';

const HEADERS = {
  'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Origin': 'https://resy.com',
  'Referer': 'https://resy.com/',
  'Accept': 'application/json, text/plain, */*'
};

const TODAY = new Date().toISOString().split('T')[0];
const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
function getArg(name, def) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}
const BATCH_LIMIT = parseInt(getArg('batch', '0'), 10);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Parse the Resy section from website_platform_scan.txt
function parseResyNames() {
  const text = fs.readFileSync(SCAN_FILE, 'utf8');
  const lines = text.split('\n');
  let inResy = false;
  const names = [];
  for (const line of lines) {
    if (line.startsWith('RESY (')) { inResy = true; continue; }
    if (inResy && /^[A-Z]/.test(line) && !line.startsWith('  ')) break; // next section
    if (inResy && line.startsWith('  ')) {
      const name = line.trim();
      if (name && name !== 'n/a') names.push(name);
    }
  }
  return names;
}

function normalize(name) {
  return (name || '').toLowerCase().replace(/[''`\u2019]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function namesMatch(masterName, resyName) {
  const a = normalize(masterName);
  const b = normalize(resyName);
  if (a === b) return { match: true, confidence: 'exact' };
  if (a.includes(b) || b.includes(a)) return { match: true, confidence: 'contains' };
  const wa = a.split(' ').filter(Boolean);
  const wb = new Set(b.split(' ').filter(Boolean));
  const matches = wa.filter(w => wb.has(w)).length;
  const overlap = matches / Math.max(wa.length, wb.size);
  if (overlap >= 0.7) return { match: true, confidence: `overlap_${Math.round(overlap * 100)}` };
  return { match: false };
}

async function searchResy(name) {
  try {
    const resp = await fetch('https://api.resy.com/3/venuesearch/search', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ query: name, geo: { latitude: 40.7128, longitude: -74.006 }, types: ['venue'], per_page: 5 })
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.search?.hits || []).map(h => ({
      name: h.name, slug: h.url_slug, lat: h._geoloc?.lat, lng: h._geoloc?.lng, id: h.id?.resy
    }));
  } catch (e) { return []; }
}

async function verifySlug(slug) {
  try {
    const resp = await fetch(`https://api.resy.com/3/venue?url_slug=${slug}&location=ny`, { headers: HEADERS });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.id?.resy) return null;
    return { id: data.id.resy, name: data.name };
  } catch (e) { return null; }
}

async function verifyBookable(venueId) {
  try {
    const resp = await fetch(`https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${TODAY}&party_size=2&venue_id=${venueId}`, { headers: HEADERS });
    if (!resp.ok) return false;
    const data = await resp.json();
    return !!(data.results?.venues?.[0]);
  } catch (e) { return false; }
}

async function main() {
  const names = parseResyNames();
  console.log(`\n📋 Parsed ${names.length} Resy names from website_platform_scan.txt`);

  // Load existing results to support resume
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}
  const alreadyChecked = new Set(Object.keys(existing._results || {}).map(n => n.toLowerCase()));

  let todo = names.filter(n => !alreadyChecked.has(n.toLowerCase()));
  if (QUICK) todo = todo.slice(0, 10);
  if (BATCH_LIMIT > 0) todo = todo.slice(0, BATCH_LIMIT);

  console.log(`✅ Already checked: ${names.length - todo.length}`);
  console.log(`📋 To check: ${todo.length}`);
  console.log(`⏱️  Est: ~${Math.round(todo.length * 8 / 60)} minutes\n`);

  if (!existing._results) existing._results = {};
  if (!existing._meta) existing._meta = { valid: 0, invalid: 0, total: 0 };

  let valid = existing._meta.valid || 0;
  let invalid = existing._meta.invalid || 0;

  for (let i = 0; i < todo.length; i++) {
    const name = todo[i];
    process.stdout.write(`  [${String(i + 1).padStart(4)}/${todo.length}] ${name.substring(0, 35).padEnd(35)} `);

    // Step 1: Search
    const hits = await searchResy(name);
    await sleep(1500);

    if (!hits.length) {
      existing._results[name] = { valid: false, reason: 'no_results' };
      invalid++;
      console.log('❌ no results');
      continue;
    }

    // Step 2: Name match
    let bestMatch = null, bestConf = null;
    for (const hit of hits) {
      const nc = namesMatch(name, hit.name);
      if (!nc.match) continue;
      bestMatch = hit; bestConf = nc.confidence; break;
    }

    if (!bestMatch) {
      existing._results[name] = { valid: false, reason: 'no_name_match', got: hits.map(h => h.name).slice(0, 3) };
      invalid++;
      console.log(`❌ no match (got: ${hits[0]?.name})`);
      continue;
    }

    process.stdout.write('[1✓] ');

    // Step 3: Verify slug
    const venue = await verifySlug(bestMatch.slug);
    await sleep(1500);
    if (!venue) {
      existing._results[name] = { valid: false, reason: 'slug_inactive', slug: bestMatch.slug };
      invalid++;
      console.log('[2✗] inactive');
      continue;
    }

    process.stdout.write('[2✓] ');

    // Step 4: Verify bookable
    const bookable = await verifyBookable(venue.id);
    await sleep(1500);

    if (!bookable) {
      existing._results[name] = { valid: false, reason: 'not_bookable', slug: bestMatch.slug, resyName: venue.name, venueId: venue.id };
      invalid++;
      console.log('[3✗] not bookable');
      continue;
    }

    existing._results[name] = {
      valid: true,
      resyName: venue.name,
      slug: bestMatch.slug,
      venueId: venue.id,
      url: `https://resy.com/cities/ny/${bestMatch.slug}`,
      confidence: bestConf
    };
    valid++;
    console.log(`[3✓] ✅ ${venue.name} → ${bestMatch.slug}`);

    // Save every 15
    if ((i + 1) % 15 === 0) {
      existing._meta = { valid, invalid, total: valid + invalid, checked_at: new Date().toISOString() };
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));
      console.log('  💾 Saved progress');
    }
  }

  existing._meta = { valid, invalid, total: valid + invalid, checked_at: new Date().toISOString() };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 RESULTS:`);
  console.log(`   ✅ Valid bookable Resy: ${valid}`);
  console.log(`   ❌ Invalid/not found: ${invalid}`);
  console.log(`   📊 Total: ${valid + invalid}`);
  console.log(`\n💾 Saved to data/platform_scan_resy_verified.json`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
