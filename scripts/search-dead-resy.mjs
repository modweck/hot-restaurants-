// Search Resy API for updated URLs for the 31 dead entries from Puppeteer verification
import { readFileSync, writeFileSync } from 'fs';

const verified = JSON.parse(readFileSync('./data/resy_puppeteer_verification.json', 'utf8'));
const bm = JSON.parse(readFileSync('./netlify/functions/BOOKING_MASTER.json', 'utf8'));

// Get only the dead ones (Sorry page or error)
const dead = Object.entries(verified).filter(([, v]) => {
  const vname = v.venueName || '';
  return vname.includes('Sorry') || vname.includes("can't find") || v.result === 'error';
});

console.log(`\n🔎 Searching Resy API (v4/find) for ${dead.length} dead entries...\n`);

const results = {
  found_new_link: [],
  maybe_match: [],
  truly_dead: [],
  error: [],
};

const DELAY_MS = 3000;
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const DATE_STR = tomorrow.toISOString().split('T')[0];

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

async function searchVenue(name, oldUrl) {
  const bmEntry = bm[name] || bm[name.toLowerCase()];
  const lat = bmEntry?.lat || 40.7128;
  const lng = bmEntry?.lng || -74.006;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    // Use the v4/find endpoint which works
    const searchUrl = `https://api.resy.com/4/find?lat=${lat}&long=${lng}&day=${DATE_STR}&party_size=2&query=${encodeURIComponent(name)}`;

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
      return { status: 'error', error: `HTTP ${resp.status}` };
    }

    const data = await resp.json();
    const venues = data?.results?.venues || [];

    if (!venues.length) {
      // Also try the slug-based lookup as a fallback
      const slug = oldUrl.match(/\/([a-z0-9-]+)\/?$/)?.[1];
      if (slug) {
        return await trySlugLookup(slug, name);
      }
      return { status: 'dead', reason: 'no search results' };
    }

    let bestMatch = null;
    let bestScore = 0;

    for (const item of venues) {
      const v = item.venue || item;
      const vName = v.name || '';
      const vSlug = v.url_slug || v.slug || '';
      const vId = v.id?.resy || v.venue_id || v.id || null;
      const vLocation = v.location?.name || v.neighborhood || '';
      const score = similarity(name, vName);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = { venueName: vName, venueId: vId, slug: vSlug, location: vLocation, score };
      }
    }

    if (bestMatch && bestScore >= 0.6) {
      const newUrl = bestMatch.slug
        ? `https://resy.com/cities/new-york-ny/venues/${bestMatch.slug}`
        : null;
      return { status: 'found', ...bestMatch, newUrl };
    } else if (bestMatch && bestScore >= 0.35) {
      return { status: 'maybe', ...bestMatch };
    } else {
      return {
        status: 'dead',
        reason: 'no good match',
        bestCandidate: bestMatch?.venueName || 'none',
        bestScore: bestScore.toFixed(2),
      };
    }
  } catch (err) {
    return { status: 'error', error: err.message?.slice(0, 100) };
  }
}

async function trySlugLookup(slug, name) {
  try {
    // Try different city formats
    for (const loc of ['ny', 'new-york-ny', 'brooklyn-ny']) {
      const url = `https://api.resy.com/3/venue?url_slug=${slug}&location=${loc}`;
      const resp = await fetch(url, {
        headers: {
          'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
          'Accept': 'application/json',
          'Origin': 'https://resy.com',
          'Referer': 'https://resy.com/',
        },
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.name) {
          return {
            status: 'found',
            venueName: data.name,
            venueId: data.id?.resy,
            slug: data.url_slug || slug,
            location: data.location?.name || loc,
            score: similarity(name, data.name),
            newUrl: `https://resy.com/cities/${loc}/venues/${data.url_slug || slug}`,
          };
        }
      }
    }
    return { status: 'dead', reason: 'slug not found in any city' };
  } catch {
    return { status: 'dead', reason: 'slug lookup failed' };
  }
}

for (let i = 0; i < dead.length; i++) {
  const [name, data] = dead[i];
  process.stdout.write(`  [${i + 1}/${dead.length}] ${name} ... `);

  const result = await searchVenue(name, data.url);

  if (result.status === 'found') {
    console.log(`✅ ${result.venueName} → ${result.newUrl} (score: ${result.score.toFixed(2)})`);
    results.found_new_link.push({ name, oldUrl: data.url, ...result });
  } else if (result.status === 'maybe') {
    console.log(`🤔 maybe: ${result.venueName} (score: ${result.score.toFixed(2)})`);
    results.maybe_match.push({ name, oldUrl: data.url, ...result });
  } else if (result.status === 'dead') {
    console.log(`💀 ${result.reason}${result.bestCandidate ? ` (closest: ${result.bestCandidate})` : ''}`);
    results.truly_dead.push({ name, oldUrl: data.url, ...result });
  } else {
    console.log(`❌ error: ${result.error}`);
    results.error.push({ name, oldUrl: data.url, ...result });
  }

  if (i < dead.length - 1) {
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`✅ Found new link:   ${results.found_new_link.length}`);
console.log(`🤔 Maybe match:      ${results.maybe_match.length}`);
console.log(`💀 Truly dead:       ${results.truly_dead.length}`);
console.log(`❌ Errors:           ${results.error.length}`);
console.log(`${'═'.repeat(60)}\n`);

writeFileSync('./data/resy_dead_search_v2.json', JSON.stringify(results, null, 2));
console.log(`💾 Saved to data/resy_dead_search_v2.json`);
