/**
 * find-booking-for-empty.js
 *
 * Searches OpenTable and Resy for the 99 BOOKING_MASTER entries with no platform.
 * Uses OpenTable search API + Resy slug API.
 *
 * RUN: node scripts/find-booking-for-empty.js
 */

const fs = require('fs');
const path = require('path');

const BM_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'empty_booking_search.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function norm(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }

function similarity(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const triA = new Set(), triB = new Set();
  for (let i = 0; i <= na.length - 3; i++) triA.add(na.slice(i, i + 3));
  for (let i = 0; i <= nb.length - 3; i++) triB.add(nb.slice(i, i + 3));
  if (triA.size === 0 || triB.size === 0) return 0;
  const intersection = [...triA].filter(t => triB.has(t)).length;
  const union = new Set([...triA, ...triB]).size;
  return intersection / union;
}

async function searchOpenTable(name, lat, lng) {
  try {
    const query = encodeURIComponent(name.replace(/[^\w\s'-]/g, '').trim());
    const url = `https://www.opentable.com/dapi/fe/gql?type=autocomplete&lang=en-US&query=${query}&latitude=${lat}&longitude=${lng}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: `query Autocomplete($term: String!, $latitude: Float, $longitude: Float) {
          autocomplete(term: $term, latitude: $latitude, longitude: $longitude) {
            restaurants { name rid locality neighborhood urlSlug latitude longitude }
          }
        }`,
        variables: { term: name, latitude: lat, longitude: lng },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    const restaurants = data?.data?.autocomplete?.restaurants || [];

    let best = null, bestScore = 0;
    for (const r of restaurants) {
      const score = similarity(name, r.name);
      if (score > bestScore) {
        bestScore = score;
        best = { name: r.name, rid: r.rid, slug: r.urlSlug, score };
      }
    }

    if (best && bestScore >= 0.55) {
      return {
        platform: 'opentable',
        name: best.name,
        url: `https://www.opentable.com/r/${best.slug}`,
        score: bestScore,
      };
    }
    return null;
  } catch { return null; }
}

async function searchResy(name, lat, lng) {
  // Try generating a slug from the name
  const slug = norm(name).replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  const headers = {
    'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
    'Accept': 'application/json',
    'Origin': 'https://resy.com',
  };

  // Try slug lookup with various city formats
  for (const loc of ['new-york-ny', 'ny']) {
    try {
      const url = `https://api.resy.com/3/venue?url_slug=${slug}&location=${loc}`;
      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.name) {
          const score = similarity(name, data.name);
          if (score >= 0.5) {
            return {
              platform: 'resy',
              name: data.name,
              url: `https://resy.com/cities/${loc}/venues/${data.url_slug || slug}`,
              score,
            };
          }
        }
      }
    } catch {}
    await sleep(500);
  }

  return null;
}

async function main() {
  const bm = JSON.parse(fs.readFileSync(BM_FILE, 'utf8'));

  const empties = Object.entries(bm).filter(([, v]) => !v.platform || v.platform === 'none');

  console.log(`\n🔍 Searching booking platforms for ${empties.length} entries with no platform...\n`);

  const results = { found: [], not_found: [], error: [] };
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}

  for (let i = 0; i < empties.length; i++) {
    const [name, data] = empties[i];

    // Skip already checked
    if (existing.found?.some(f => f.name === name) || existing.not_found?.some(f => f.name === name)) {
      continue;
    }

    const lat = data.lat || 40.7128;
    const lng = data.lng || -74.006;

    process.stdout.write(`  [${i + 1}/${empties.length}] ${name} ... `);

    // Try OpenTable first (faster, more restaurants)
    let result = await searchOpenTable(name, lat, lng);

    if (!result) {
      await sleep(1000);
      result = await searchResy(name, lat, lng);
    }

    if (result) {
      console.log(`✅ ${result.platform}: ${result.name} (${result.score.toFixed(2)})`);
      results.found.push({ name, ...result });
    } else {
      console.log(`❌ not found`);
      results.not_found.push({ name, lat, lng });
    }

    // Save progress
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

    // 3 sec between searches
    await sleep(3000);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`✅ Found: ${results.found.length}`);
  console.log(`❌ Not found: ${results.not_found.length}`);
  console.log(`${'═'.repeat(60)}`);

  if (results.found.length) {
    console.log(`\n✅ FOUND:`);
    for (const f of results.found) {
      console.log(`  ${f.name} → ${f.platform} ${f.url}`);
    }
  }

  console.log(`\n💾 Saved to ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
