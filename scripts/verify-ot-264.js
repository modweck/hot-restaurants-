/**
 * verify-ot-264.js
 *
 * For the 264 restaurants with broken Resy links, search OpenTable
 * by name + location and verify matches are accurate.
 * Only accepts strong name matches near the restaurant's coordinates.
 */

const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, '..', 'data', 'resy_264_ot_check.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'resy_264_ot_results.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function norm(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function distance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isStrongMatch(searchName, resultName) {
  const a = norm(searchName);
  const b = norm(resultName);
  if (a === b) return 'exact';

  // One contains the other, substantial overlap
  const longer = Math.max(a.length, b.length);
  const shorter = Math.min(a.length, b.length);
  if ((a.includes(b) || b.includes(a)) && shorter >= longer * 0.4 && shorter >= 3) return 'contains';

  // Word-level matching — require core words to match
  const wa = a.split(' ').filter(w => w.length >= 3);
  const wb = b.split(' ').filter(w => w.length >= 3);
  if (wa.length === 0 || wb.length === 0) {
    // Short names — exact character match only
    return a === b ? 'exact' : null;
  }

  const wbSet = new Set(wb);
  const waSet = new Set(wa);
  const matchCount = wa.filter(w => wbSet.has(w)).length;
  const revMatchCount = wb.filter(w => waSet.has(w)).length;

  // Both single significant words that match
  if (wa.length === 1 && wb.length === 1 && wa[0] === wb[0]) return 'single_word';

  // Multi-word: need good overlap on BOTH sides
  if (matchCount >= 1 && wa.length <= 2 && matchCount / wa.length >= 0.5 && revMatchCount / wb.length >= 0.5) return 'word_match';
  if (matchCount >= 2 && matchCount / wa.length >= 0.5 && revMatchCount / wb.length >= 0.4) return 'word_overlap';

  return null;
}

async function searchOT(name, lat, lng) {
  try {
    const resp = await fetch('https://www.opentable.com/dapi/fe/gql?type=autocomplete', {
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
        variables: { term: name, latitude: lat || 40.7128, longitude: lng || -74.006 },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return [];
    const data = await resp.json();
    return data?.data?.autocomplete?.restaurants || [];
  } catch (e) { return []; }
}

async function main() {
  const entries = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));

  let results = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    results = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  }

  const remaining = entries.filter(e => !results[e.name]);
  console.log(`\n🔍 Searching OpenTable for ${remaining.length} restaurants (${Object.keys(results).length} already done)\n`);

  let found = 0, notFound = 0;

  for (let i = 0; i < remaining.length; i++) {
    const e = remaining[i];
    const pct = ((i + 1) / remaining.length * 100).toFixed(0);

    const otResults = await searchOT(e.name, e.lat, e.lng);

    let bestMatch = null;
    for (const r of otResults) {
      const matchType = isStrongMatch(e.name, r.name);
      if (!matchType) continue;

      const dist = distance(e.lat, e.lng, r.latitude, r.longitude);
      // Accept if name matches AND within 5 miles (or no coords)
      if (dist === null || dist < 5) {
        bestMatch = {
          name: r.name,
          rid: r.rid,
          slug: r.urlSlug,
          url: `https://www.opentable.com/r/${r.urlSlug}`,
          match_type: matchType,
          distance: dist ? dist.toFixed(1) + 'mi' : null,
        };
        break; // take first strong match
      }
    }

    if (bestMatch) {
      results[e.name] = { status: 'found', match: bestMatch };
      found++;
      console.log(`✅ [${pct}%] ${e.name} → ${bestMatch.name} (${bestMatch.match_type}, ${bestMatch.distance || 'no coords'})`);
    } else {
      results[e.name] = {
        status: 'not_found',
        searched: e.name,
        got: otResults.slice(0, 3).map(r => r.name),
      };
      notFound++;
      const got = otResults.length > 0 ? ` (closest: ${otResults[0].name})` : '';
      console.log(`❌ [${pct}%] ${e.name}${got}`);
    }

    if ((i + 1) % 10 === 0 || i === remaining.length - 1) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    }

    await sleep(800);
  }

  console.log(`\n📊 Results: ${found} found, ${notFound} not found`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
}

main().catch(console.error);
