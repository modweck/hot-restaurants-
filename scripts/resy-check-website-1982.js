/**
 * resy-check-website-1982.js
 *
 * Checks if website-only restaurants are on Resy.
 * Uses Resy search API to find by name, then verifies with venue endpoint.
 *
 * RUN:   node scripts/resy-check-website-1982.js
 * OPTIONS:
 *   --quick     First 20 only
 *   --batch N   Check N then stop
 *   --resume    Skip already checked
 *
 * OUTPUT: data/resy_from_website_check.json
 */

const fs = require('fs');
const path = require('path');

const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'resy_from_website_check.json');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const RESUME = args.includes('--resume');
const BATCH = parseInt(args[args.indexOf('--batch') + 1] || '0', 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));

const RESY_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const RESY_TOKEN = fs.readFileSync(path.join(__dirname, 'resy-future-avail-booked186.js'), 'utf8').match(/RESY_TOKENS\s*=\s*\[\s*'([^']+)'/)?.[1] || '';

function getHeaders() {
  return {
    'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
    'X-Resy-Auth-Token': RESY_TOKEN,
    'X-Resy-Universal-Auth': RESY_TOKEN,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Origin': 'https://resy.com',
    'Referer': 'https://resy.com/',
    'Accept': 'application/json'
  };
}

// Load master
const master = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
const toCheck = Object.entries(master)
  .filter(([_, v]) => v.platform === 'website')
  .map(([name, v]) => ({ name, lat: v.lat, lng: v.lng }));

console.log(`🔍 ${toCheck.length} website-only restaurants to check for Resy\n`);

let existing = {};
try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}

function matchScore(search, found) {
  const c = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const sc = c(search), fc = c(found);
  if (sc === fc) return 1.0;
  if (fc.includes(sc) || sc.includes(fc)) return 0.9;
  const stop = ['the', 'and', 'restaurant', 'bar', 'grill', 'cafe', 'kitchen', 'nyc', 'new', 'york'];
  const sw = sc.split(' ').filter(w => w.length > 2 && !stop.includes(w));
  const fw = fc.split(' ').filter(w => w.length > 2 && !stop.includes(w));
  if (sw.length === 0) return 0;
  const overlap = sw.filter(w => fw.some(f => f.includes(w) || w.includes(f)));
  return overlap.length / sw.length;
}

async function checkResy(name, lat, lng) {
  try {
    const cleanName = name.replace(/\(.*?\)/g, '').replace(/[^\w\s'-]/g, '').replace(/\s+/g, ' ').trim();

    // Generate possible slugs from restaurant name
    const baseSlug = cleanName.toLowerCase().replace(/[']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const slugs = new Set([
      baseSlug,
      baseSlug + '-new-york',
      baseSlug + '-nyc',
      baseSlug + '-brooklyn',
      baseSlug.replace(/-new-york$/, ''),
      baseSlug.replace(/-nyc$/, ''),
    ]);

    for (const slug of slugs) {
      if (!slug || slug.length < 3) continue;
      for (const loc of ['new-york-ny', 'ny', 'brooklyn-ny']) {
        try {
          const resp = await fetch(`https://api.resy.com/3/venue?url_slug=${slug}&location=${loc}`, {
            headers: getHeaders(),
            signal: AbortSignal.timeout(8000)
          });

          if (!resp.ok) continue;
          const data = await resp.json();
          const venueId = data?.id?.resy;
          const venueName = data?.name;

          if (venueId && venueName) {
            const score = matchScore(name, venueName);
            if (score >= 0.6) {
              return {
                found: true,
                venue_id: venueId,
                matched_name: venueName,
                slug: slug,
                score: score,
                url: `https://resy.com/cities/${loc.replace('-ny', '')}/${slug}`
              };
            }
          }
        } catch {}
      }
    }

    return { found: false };
  } catch (e) {
    return { found: false, error: e.message?.slice(0, 50) };
  }
}

async function main() {
  let list = [...toCheck];
  if (RESUME) {
    const done = new Set(Object.keys(existing).map(k => k.toLowerCase()));
    list = list.filter(r => !done.has(r.name.toLowerCase()));
    console.log(`⏭️  Resuming: ${list.length} remaining`);
  }
  if (QUICK) list = list.slice(0, 20);
  if (BATCH > 0) list = list.slice(0, BATCH);

  console.log(`🔍 Checking ${list.length} restaurants...\n`);

  const results = { ...existing };
  let checked = 0, found = 0, notFound = 0, errors = 0;

  for (const { name, lat, lng } of list) {
    const result = await checkResy(name, lat, lng);
    checked++;

    if (result.found) {
      results[name] = result;
      found++;
      console.log(`  🟢 [${checked}/${list.length}] ${name} → ${result.matched_name} (vid:${result.venue_id})`);
    } else if (result.error) {
      errors++;
      if (result.error.includes('429')) {
        console.log(`  ⏸️  Rate limited — pausing 30s`);
        await sleep(30000);
      }
    } else {
      notFound++;
    }

    if (checked % 50 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
      console.log(`  💾 ${found} found / ${checked} checked`);
    }

    await sleep(1000);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Done! Checked ${checked} restaurants`);
  console.log(`   🟢 Found on Resy: ${found}`);
  console.log(`   ❌ Not found: ${notFound}`);
  console.log(`   ⚠️  Errors: ${errors}`);
  console.log(`   Output: ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
