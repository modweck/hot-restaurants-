// Check if 313 dead Resy restaurants are on OpenTable
import { readFileSync, writeFileSync } from 'fs';

const deadData = JSON.parse(readFileSync('./data/resy_dead_search_results.json', 'utf8'));
const dead = deadData.truly_dead;
const bm = JSON.parse(readFileSync('./netlify/functions/BOOKING_MASTER.json', 'utf8'));

console.log(`\n🔎 Checking OpenTable for ${dead.length} dead Resy restaurants...\n`);

const results = {
  found_opentable: [],
  not_found: [],
  error: [],
};

const BATCH_SIZE = 3;
const DELAY_MS = 2500;

function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

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

async function searchOpenTable(entry) {
  const { name } = entry;
  const bmEntry = bm[name] || bm[name.toLowerCase()];
  const lat = bmEntry?.lat || 40.7128;
  const lng = bmEntry?.lng || -74.006;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    // OpenTable autocomplete/search API
    const query = encodeURIComponent(name);
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
            restaurants {
              name
              rid
              locality
              neighborhood
              urlSlug
              latitude
              longitude
            }
          }
        }`,
        variables: {
          term: name,
          latitude: lat,
          longitude: lng,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      // Try simpler search
      const simpleUrl = `https://www.opentable.com/s?term=${query}&metroId=4&regionIds=&latitude=${lat}&longitude=${lng}&corrid=&uiType=autocomplete`;
      const simpleResp = await fetch(simpleUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!simpleResp.ok) {
        results.not_found.push({ name, reason: `OT search failed ${resp.status}` });
        return;
      }

      const simpleData = await simpleResp.json();
      processOTResults(simpleData, entry);
      return;
    }

    const data = await resp.json();
    processOTResults(data, entry);

  } catch (err) {
    if (err.name === 'AbortError') {
      results.error.push({ name, error: 'timeout' });
    } else {
      results.error.push({ name, error: err.message?.slice(0, 100) });
    }
  }
}

function processOTResults(data, entry) {
  const { name } = entry;
  const bmEntry = bm[name] || bm[name.toLowerCase()];
  const lat = bmEntry?.lat || 40.7128;
  const lng = bmEntry?.lng || -74.006;

  // Try to extract restaurants from various response formats
  let restaurants = [];
  if (data?.data?.autocomplete?.restaurants) {
    restaurants = data.data.autocomplete.restaurants;
  } else if (data?.restaurants) {
    restaurants = data.restaurants;
  } else if (data?.items) {
    restaurants = data.items.filter(i => i.type === 'restaurant');
  } else if (Array.isArray(data)) {
    restaurants = data;
  }

  if (!restaurants.length) {
    results.not_found.push({ name, reason: 'no OT results' });
    return;
  }

  let bestMatch = null;
  let bestScore = 0;

  for (const r of restaurants) {
    const rName = r.name || r.restaurantName || '';
    const rSlug = r.urlSlug || r.profileLink || '';
    const rLat = r.latitude || r.lat || 0;
    const rLng = r.longitude || r.lng || 0;
    const rLocality = r.locality || r.city || '';
    const rNeighborhood = r.neighborhood || '';

    // Check if it's in NYC area
    const isNYC = (rLat >= 40.4 && rLat <= 41.0 && rLng >= -74.3 && rLng <= -73.6) ||
      rLocality.includes('New York') || rLocality.includes('Brooklyn');

    const score = similarity(name, rName);

    // Distance check (rough, in degrees ≈ miles * 0.014)
    const dist = Math.sqrt(Math.pow(rLat - lat, 2) + Math.pow(rLng - lng, 2));
    const isClose = dist < 0.1; // ~7 miles

    const adjustedScore = (isNYC ? score + 0.1 : score) + (isClose ? 0.05 : 0);

    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      bestMatch = {
        otName: rName,
        otSlug: rSlug,
        neighborhood: rNeighborhood,
        locality: rLocality,
        score: adjustedScore,
        isNYC,
        isClose,
        otUrl: rSlug ? `https://www.opentable.com/r/${rSlug}` : null,
      };
    }
  }

  if (bestMatch && bestScore >= 0.65 && (bestMatch.isNYC || bestMatch.isClose)) {
    results.found_opentable.push({ name, ...bestMatch });
  } else {
    results.not_found.push({
      name,
      reason: 'no good NYC match on OT',
      bestCandidate: bestMatch?.otName || 'none',
      bestScore: bestScore.toFixed(2),
      isNYC: bestMatch?.isNYC || false,
    });
  }
}

for (let i = 0; i < dead.length; i += BATCH_SIZE) {
  const batch = dead.slice(i, i + BATCH_SIZE);
  const progress = Math.min(i + BATCH_SIZE, dead.length);

  await Promise.all(batch.map(e => searchOpenTable(e)));

  const pct = ((progress / dead.length) * 100).toFixed(1);
  console.log(`  [${progress}/${dead.length}] (${pct}%) ✅ ${results.found_opentable.length} on OT | ❌ ${results.not_found.length} not found | ⚠️  ${results.error.length} err`);

  if (i + BATCH_SIZE < dead.length) {
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`RESULTS SUMMARY`);
console.log(`${'═'.repeat(60)}`);
console.log(`✅ Found on OpenTable:    ${results.found_opentable.length}`);
console.log(`❌ Not found anywhere:    ${results.not_found.length}`);
console.log(`⚠️  Errors:               ${results.error.length}`);
console.log(`${'═'.repeat(60)}\n`);

writeFileSync('./data/resy_dead_opentable_check.json', JSON.stringify(results, null, 2));
console.log(`💾 Results saved to data/resy_dead_opentable_check.json`);

if (results.found_opentable.length) {
  console.log(`\n✅ FOUND ON OPENTABLE (${results.found_opentable.length}):`);
  for (const f of results.found_opentable) {
    console.log(`  "${f.name}" → "${f.otName}" — ${f.otUrl}`);
  }
}

if (results.not_found.length) {
  console.log(`\n❌ NOT FOUND — first 30 of ${results.not_found.length}:`);
  for (const d of results.not_found.slice(0, 30)) {
    console.log(`  ${d.name} — ${d.reason}${d.bestCandidate ? ` (closest: "${d.bestCandidate}")` : ''}`);
  }
}
