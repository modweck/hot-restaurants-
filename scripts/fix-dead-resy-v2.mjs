// Search for 367 dead Resy venues using POST to the correct search API
import { readFileSync, writeFileSync } from 'fs';

const verification = JSON.parse(readFileSync('./data/resy_api_verification.json', 'utf8'));
const dead = verification.closed_or_dead;
const bm = JSON.parse(readFileSync('./netlify/functions/BOOKING_MASTER.json', 'utf8'));

console.log(`\n🔎 Searching Resy for ${dead.length} dead venues (POST API)...\n`);

const results = {
  found_new_link: [],
  truly_dead: [],
  maybe_match: [],
  error: [],
};

const BATCH_SIZE = 3;
const DELAY_MS = 3000;

function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function similarity(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  // Jaccard on trigrams
  const triA = new Set(), triB = new Set();
  for (let i = 0; i <= na.length - 3; i++) triA.add(na.slice(i, i + 3));
  for (let i = 0; i <= nb.length - 3; i++) triB.add(nb.slice(i, i + 3));
  if (triA.size === 0 || triB.size === 0) return 0;
  const intersection = [...triA].filter(t => triB.has(t)).length;
  const union = new Set([...triA, ...triB]).size;
  return intersection / union;
}

async function searchVenue(entry) {
  const { name, slug } = entry;
  const bmEntry = bm[name] || bm[name.toLowerCase()];
  const lat = bmEntry?.lat || 40.7128;
  const lng = bmEntry?.lng || -74.006;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch('https://api.resy.com/3/venuesearch/search', {
      method: 'POST',
      headers: {
        'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Origin': 'https://resy.com',
        'Referer': 'https://resy.com/',
      },
      body: JSON.stringify({
        query: name,
        geo: { latitude: lat, longitude: lng },
        types: ['venue'],
        per_page: 5,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      results.error.push({ name, slug, error: `HTTP ${resp.status}` });
      return;
    }

    const data = await resp.json();
    const hits = data?.search?.hits || [];

    if (!hits.length) {
      results.truly_dead.push({ name, slug, reason: 'no search results' });
      return;
    }

    // Filter to NYC area (lat ~40.5-41.0, lng ~-74.3 to -73.7)
    const nycHits = hits.filter(h => {
      const geo = h._geoloc;
      if (!geo) return false;
      return geo.lat >= 40.4 && geo.lat <= 41.0 && geo.lng >= -74.3 && geo.lng <= -73.6;
    });

    const candidates = nycHits.length ? nycHits : hits;

    let bestMatch = null;
    let bestScore = 0;

    for (const h of candidates) {
      const vName = h.name || '';
      const vSlug = h.url_slug || '';
      const vId = h.id?.resy || null;
      const vNeighborhood = h.neighborhood || '';
      const vLocality = h.locality || '';
      const vLocation = h.location?.name || '';
      const isNYC = vLocality.includes('New York') || vLocality.includes('Brooklyn') || vLocation.includes('New York') || vLocation.includes('Brooklyn');
      const score = similarity(name, vName);
      // Boost score for NYC matches
      const adjustedScore = isNYC ? score + 0.1 : score;

      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        bestMatch = {
          venueName: vName,
          venueId: vId,
          newSlug: vSlug,
          neighborhood: vNeighborhood,
          locality: vLocality,
          location: vLocation,
          score: adjustedScore,
          isNYC,
          newUrl: vSlug ? `https://resy.com/cities/new-york-ny/venues/${vSlug}` : null,
        };
      }
    }

    if (bestMatch && bestScore >= 0.65 && bestMatch.isNYC) {
      results.found_new_link.push({ name, oldSlug: slug, ...bestMatch });
    } else if (bestMatch && bestScore >= 0.5) {
      results.maybe_match.push({ name, oldSlug: slug, ...bestMatch });
    } else {
      results.truly_dead.push({
        name, slug, reason: 'no good NYC match',
        bestCandidate: bestMatch?.venueName || 'none',
        bestScore: bestScore.toFixed(2),
        isNYC: bestMatch?.isNYC || false,
      });
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      results.error.push({ name, slug, error: 'timeout' });
    } else {
      results.error.push({ name, slug, error: err.message?.slice(0, 100) });
    }
  }
}

for (let i = 0; i < dead.length; i += BATCH_SIZE) {
  const batch = dead.slice(i, i + BATCH_SIZE);
  const progress = Math.min(i + BATCH_SIZE, dead.length);

  await Promise.all(batch.map(e => searchVenue(e)));

  const pct = ((progress / dead.length) * 100).toFixed(1);
  console.log(`  [${progress}/${dead.length}] (${pct}%) ✅ ${results.found_new_link.length} found | 🤔 ${results.maybe_match.length} maybe | ❌ ${results.truly_dead.length} dead | ⚠️  ${results.error.length} err`);

  if (i + BATCH_SIZE < dead.length) {
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`RESULTS SUMMARY`);
console.log(`${'═'.repeat(60)}`);
console.log(`✅ Found new Resy link:   ${results.found_new_link.length}`);
console.log(`🤔 Maybe match:           ${results.maybe_match.length}`);
console.log(`❌ Truly dead/closed:      ${results.truly_dead.length}`);
console.log(`⚠️  Errors:                ${results.error.length}`);
console.log(`${'═'.repeat(60)}\n`);

writeFileSync('./data/resy_dead_search_results.json', JSON.stringify(results, null, 2));
console.log(`💾 Results saved to data/resy_dead_search_results.json`);

if (results.found_new_link.length) {
  console.log(`\n✅ FOUND NEW LINKS (${results.found_new_link.length}):`);
  for (const f of results.found_new_link) {
    console.log(`  "${f.name}" → "${f.venueName}" (${f.newSlug}) [score: ${f.score.toFixed(2)}] ${f.neighborhood}`);
  }
}

if (results.maybe_match.length) {
  console.log(`\n🤔 MAYBE MATCHES (${results.maybe_match.length}):`);
  for (const m of results.maybe_match) {
    console.log(`  "${m.name}" → "${m.venueName}" [score: ${m.score.toFixed(2)}] NYC: ${m.isNYC} ${m.locality}`);
  }
}

if (results.truly_dead.length) {
  console.log(`\n❌ TRULY DEAD — first 30 of ${results.truly_dead.length}:`);
  for (const d of results.truly_dead.slice(0, 30)) {
    console.log(`  ${d.name} — ${d.reason}${d.bestCandidate ? ` (closest: "${d.bestCandidate}" score:${d.bestScore} nyc:${d.isNYC})` : ''}`);
  }
}
