// For the 367 dead Resy links, search Resy API to find correct venue
import { readFileSync, writeFileSync } from 'fs';

const verification = JSON.parse(readFileSync('./data/resy_api_verification.json', 'utf8'));
const dead = verification.closed_or_dead;
const bm = JSON.parse(readFileSync('./netlify/functions/BOOKING_MASTER.json', 'utf8'));

console.log(`\n🔎 Searching for ${dead.length} dead Resy venues...\n`);

const results = {
  found_new_link: [],      // Found a matching venue on Resy
  truly_dead: [],           // No match found — probably closed
  maybe_match: [],          // Found something but name doesn't match well
  error: [],
};

const BATCH_SIZE = 4;
const DELAY_MS = 2500;

// Normalize name for comparison
function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function similarity(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  // Simple character overlap
  const setA = new Set(na.split(''));
  const setB = new Set(nb.split(''));
  const intersection = [...setA].filter(c => setB.has(c)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

async function searchVenue(entry) {
  const { name, slug } = entry;

  // Get coords from BOOKING_MASTER for geo search
  const bmEntry = bm[name] || bm[name.toLowerCase()];
  const lat = bmEntry?.lat || 40.7128;
  const lng = bmEntry?.lng || -74.006;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    // Search Resy API by name
    const searchUrl = `https://api.resy.com/3/venuesearch/search?query=${encodeURIComponent(name)}&geo={"latitude":${lat},"longitude":${lng}}&types=["venue"]&per_page=5`;

    const resp = await fetch(searchUrl, {
      headers: {
        'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
        'Accept': 'application/json',
        'Origin': 'https://resy.com',
        'Referer': 'https://resy.com/',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      // Try alternate search endpoint
      const altUrl = `https://api.resy.com/2/search?query=${encodeURIComponent(name)}&geo={"latitude":${lat},"longitude":${lng}}&types=venue&per_page=5`;
      const altResp = await fetch(altUrl, {
        headers: {
          'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
          'Accept': 'application/json',
          'Origin': 'https://resy.com',
          'Referer': 'https://resy.com/',
        },
      });

      if (!altResp.ok) {
        results.truly_dead.push({ name, slug, reason: `search returned ${resp.status}` });
        return;
      }

      const altData = await altResp.json();
      processSearchResults(altData, entry);
      return;
    }

    const data = await resp.json();
    processSearchResults(data, entry);

  } catch (err) {
    if (err.name === 'AbortError') {
      results.error.push({ name, slug, error: 'timeout' });
    } else {
      results.error.push({ name, slug, error: err.message?.slice(0, 100) });
    }
  }
}

function processSearchResults(data, entry) {
  const { name, slug } = entry;

  // Try to find venues in various response formats
  let venues = [];
  if (data?.search?.hits) {
    venues = data.search.hits;
  } else if (data?.results?.venues) {
    venues = data.results.venues;
  } else if (Array.isArray(data?.hits)) {
    venues = data.hits;
  } else if (Array.isArray(data)) {
    venues = data;
  }

  if (!venues.length) {
    results.truly_dead.push({ name, slug, reason: 'no search results' });
    return;
  }

  // Check each result for a good match
  let bestMatch = null;
  let bestScore = 0;

  for (const v of venues) {
    const vName = v.name || v.venue_name || '';
    const vSlug = v.url_slug || v.slug || '';
    const vId = v.id?.resy || v.venue_id || v.id || null;
    const vLocation = v.location?.name || v.neighborhood || '';
    const score = similarity(name, vName);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = {
        venueName: vName,
        venueId: vId,
        slug: vSlug,
        location: vLocation,
        score,
        newUrl: vSlug ? `https://resy.com/cities/new-york-ny/venues/${vSlug}` : null,
      };
    }
  }

  if (bestMatch && bestScore >= 0.7) {
    results.found_new_link.push({
      name,
      oldSlug: slug,
      ...bestMatch,
    });
  } else if (bestMatch && bestScore >= 0.4) {
    results.maybe_match.push({
      name,
      oldSlug: slug,
      ...bestMatch,
    });
  } else {
    results.truly_dead.push({
      name,
      slug,
      reason: 'no good match',
      bestCandidate: bestMatch?.venueName || 'none',
      bestScore: bestScore.toFixed(2),
    });
  }
}

// Process in batches
for (let i = 0; i < dead.length; i += BATCH_SIZE) {
  const batch = dead.slice(i, i + BATCH_SIZE);
  const progress = Math.min(i + BATCH_SIZE, dead.length);

  await Promise.all(batch.map(entry => searchVenue(entry)));

  const pct = ((progress / dead.length) * 100).toFixed(1);
  console.log(`  [${progress}/${dead.length}] (${pct}%) ✅ ${results.found_new_link.length} found | 🤔 ${results.maybe_match.length} maybe | ❌ ${results.truly_dead.length} dead | ⚠️  ${results.error.length} err`);

  if (i + BATCH_SIZE < dead.length) {
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
}

// Summary
console.log(`\n${'═'.repeat(60)}`);
console.log(`RESULTS SUMMARY`);
console.log(`${'═'.repeat(60)}`);
console.log(`✅ Found new Resy link:   ${results.found_new_link.length}`);
console.log(`🤔 Maybe match:           ${results.maybe_match.length}`);
console.log(`❌ Truly dead/closed:      ${results.truly_dead.length}`);
console.log(`⚠️  Errors:                ${results.error.length}`);
console.log(`${'═'.repeat(60)}\n`);

// Save
writeFileSync('./data/resy_dead_search_results.json', JSON.stringify(results, null, 2));
console.log(`💾 Results saved to data/resy_dead_search_results.json`);

// Show found new links
if (results.found_new_link.length) {
  console.log(`\n✅ FOUND NEW LINKS (${results.found_new_link.length}):`);
  for (const f of results.found_new_link.slice(0, 20)) {
    console.log(`  ${f.name} → ${f.venueName} (${f.slug}) [score: ${f.score.toFixed(2)}]`);
  }
  if (results.found_new_link.length > 20) console.log(`  ... and ${results.found_new_link.length - 20} more`);
}

// Show truly dead
if (results.truly_dead.length) {
  console.log(`\n❌ TRULY DEAD (${results.truly_dead.length}):`);
  for (const d of results.truly_dead.slice(0, 20)) {
    console.log(`  ${d.name} — ${d.reason}${d.bestCandidate ? ` (closest: ${d.bestCandidate})` : ''}`);
  }
  if (results.truly_dead.length > 20) console.log(`  ... and ${results.truly_dead.length - 20} more`);
}

// Show maybe matches
if (results.maybe_match.length) {
  console.log(`\n🤔 MAYBE MATCHES (${results.maybe_match.length}):`);
  for (const m of results.maybe_match.slice(0, 20)) {
    console.log(`  ${m.name} → ${m.venueName} (score: ${m.score.toFixed(2)})`);
  }
  if (results.maybe_match.length > 20) console.log(`  ... and ${results.maybe_match.length - 20} more`);
}
