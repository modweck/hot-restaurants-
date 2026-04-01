/**
 * fix-resy-303.js
 *
 * For each of the 303 broken Resy entries:
 * 1. Try the current slug across city codes (ny, new-york-ny, brooklyn-ny)
 * 2. Generate slug variations from the name and try those
 * 3. Search Resy API by name — only accept if name is a strong match AND in NYC area
 * 4. Categorize: fixed / not_on_resy / needs_review
 */

const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, '..', 'data', 'resy_303_to_fix.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'resy_303_results.json');

const RESY_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const HEADERS = {
  'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
  'Accept': 'application/json',
  'Origin': 'https://resy.com',
  'Referer': 'https://resy.com/',
};

const CITIES = ['ny', 'new-york-ny', 'brooklyn-ny'];
const NYC_REGIONS = ['ny', 'nj', 'ct']; // accept tristate
const DELAY_MS = 600;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalize(name) {
  return (name || '').toLowerCase()
    .replace(/[''`\u2019\u2018\u00e9\u00e8\u00ea\u00f4\u00fb\u00e0]/g, m => {
      const map = {'\u00e9':'e','\u00e8':'e','\u00ea':'e','\u00f4':'o','\u00fb':'u','\u00e0':'a'};
      return map[m] || '';
    })
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function nameToSlug(name) {
  return normalize(name).replace(/\s+/g, '-');
}

function distance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function slugVariations(name, currentSlug) {
  const variations = [];
  if (currentSlug) variations.push(currentSlug);

  const slug = nameToSlug(name);
  if (!variations.includes(slug)) variations.push(slug);

  // Without common suffixes
  const cleaned = normalize(name)
    .replace(/\b(nyc|ny|new york|manhattan|brooklyn|queens|restaurant|bar|grill|kitchen|cafe|bistro|lounge|estiatorio|ristorante|trattoria|sushi|japanese|asian|fusion|italian|mexican|chinese|thai|indian|french|greek|show|drag queen)\b/g, '')
    .trim().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (cleaned.length > 2 && !variations.includes(cleaned)) variations.push(cleaned);

  // With -ny suffix
  const withNy = `${slug}-ny`;
  if (!variations.includes(withNy)) variations.push(withNy);

  // First two words
  const words = normalize(name).split(' ').filter(w => w.length >= 2);
  if (words.length >= 2) {
    const twoWord = `${words[0]}-${words[1]}`;
    if (!variations.includes(twoWord)) variations.push(twoWord);
  }

  // First word only if substantial
  if (words[0] && words[0].length >= 4 && !variations.includes(words[0])) {
    variations.push(words[0]);
  }

  return variations.filter(s => s && s.length > 1);
}

async function verifySlug(slug, city) {
  try {
    const resp = await fetch(`https://api.resy.com/3/venue?url_slug=${encodeURIComponent(slug)}&location=${city}`, { headers: HEADERS });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.id?.resy) return null;
    return {
      id: data.id.resy,
      name: data.name,
      slug: data.url_slug || slug,
      city: city,
      lat: data.location?.latitude,
      lng: data.location?.longitude,
      active: data.config?.enable_resys !== false,
      region: data.location?.code,
    };
  } catch (e) { return null; }
}

async function searchResy(query) {
  try {
    const resp = await fetch('https://api.resy.com/3/venuesearch/search', {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: query,
        geo: { latitude: 40.7128, longitude: -74.006 },
        types: ['venue'],
        per_page: 10
      })
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.search?.hits || []).map(h => ({
      name: h.name,
      slug: h.url_slug,
      id: h.id?.resy,
      lat: h.location?.latitude || h.geo?.lat,
      lng: h.location?.longitude || h.geo?.lon,
      region: h.region,
    }));
  } catch (e) { return []; }
}

function isStrongNameMatch(searchName, resultName) {
  const a = normalize(searchName);
  const b = normalize(resultName);
  if (a === b) return 'exact';

  // One contains the other, but contained part must be >50% of longer
  const longer = Math.max(a.length, b.length);
  if (a.includes(b) && b.length >= longer * 0.5) return 'contains';
  if (b.includes(a) && a.length >= longer * 0.5) return 'contains';

  // Word-level: require significant words to match
  const wa = a.split(' ').filter(w => w.length >= 3);
  const wb = b.split(' ').filter(w => w.length >= 3);
  if (wa.length === 0 || wb.length === 0) return null;

  const wbSet = new Set(wb);
  const waSet = new Set(wa);
  const matchCount = wa.filter(w => wbSet.has(w)).length;

  // Both names are single significant words and match
  if (wa.length === 1 && wb.length === 1 && wa[0] === wb[0]) return 'single_word';

  // Multi-word: require at least 2 matching words and >50% overlap on both sides
  if (matchCount >= 2) {
    const overlapA = matchCount / wa.length;
    const overlapB = wb.filter(w => waSet.has(w)).length / wb.length;
    if (overlapA >= 0.5 && overlapB >= 0.5) return 'word_overlap';
  }

  return null;
}

function isNYCRegion(region) {
  if (!region) return false;
  const r = region.toLowerCase();
  return r.includes('ny') || r.includes('new york') || r.includes('brooklyn') ||
         r.includes('queens') || r.includes('bronx') || r.includes('staten') ||
         r === 'nj' || r.includes('new jersey') || r.includes('ct') || r.includes('connecticut');
}

async function tryFixEntry(entry) {
  const { name, slug, lat, lng } = entry;

  // STRATEGY 1: Try current slug across all city codes
  if (slug) {
    for (const city of CITIES) {
      const result = await verifySlug(slug, city);
      if (result) {
        const dist = distance(lat, lng, result.lat, result.lng);
        if (dist === null || dist < 30) {
          return { strategy: 'direct_slug', match: result, distance: dist ? dist.toFixed(1) + 'mi' : null };
        }
      }
      await sleep(250);
    }
  }

  // STRATEGY 2: Try slug variations from the restaurant name
  const variations = slugVariations(name, null);
  for (const varSlug of variations) {
    if (varSlug === slug) continue;
    for (const city of ['ny', 'new-york-ny']) {
      const result = await verifySlug(varSlug, city);
      if (result) {
        const dist = distance(lat, lng, result.lat, result.lng);
        if (dist === null || dist < 30) {
          return { strategy: 'slug_variation', tried: varSlug, match: result, distance: dist ? dist.toFixed(1) + 'mi' : null };
        }
      }
      await sleep(250);
    }
  }

  // STRATEGY 3: Search by name, only accept strong matches in NYC
  await sleep(400);
  const results = await searchResy(name);
  const nycResults = results.filter(r => isNYCRegion(r.region));

  for (const r of nycResults) {
    const matchType = isStrongNameMatch(name, r.name);
    if (matchType) {
      const dist = distance(lat, lng, r.lat, r.lng);
      if (dist === null || dist < 15) {
        return { strategy: 'search_match', match: { ...r, active: true }, match_type: matchType, distance: dist ? dist.toFixed(1) + 'mi' : null };
      }
    }
  }

  // Return what we found for review
  return {
    status: 'not_on_resy',
    searched: name,
    slug_tried: slug,
    search_results: results.slice(0, 3).map(r => ({ name: r.name, slug: r.slug, region: r.region })),
  };
}

async function main() {
  const entries = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));

  let results = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    results = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  }

  const remaining = entries.filter(e => !results[e.name]);
  console.log(`\n🔧 Fixing Resy slugs`);
  console.log(`   Total: ${entries.length}`);
  console.log(`   Already done: ${Object.keys(results).length}`);
  console.log(`   Remaining: ${remaining.length}\n`);

  let fixed = 0, notOnResy = 0;

  for (let i = 0; i < remaining.length; i++) {
    const entry = remaining[i];
    const pct = ((i + 1) / remaining.length * 100).toFixed(0);

    try {
      const result = await tryFixEntry(entry);
      if (result.status === 'not_on_resy') {
        results[entry.name] = result;
        notOnResy++;
        const got = result.search_results.length > 0
          ? ` (closest: ${result.search_results[0].name})`
          : '';
        console.log(`❌ [${pct}%] ${entry.name} — not on Resy${got}`);
      } else {
        results[entry.name] = { status: 'found', ...result };
        fixed++;
        console.log(`✅ [${pct}%] ${entry.name} → ${result.match.name} (${result.strategy})`);
      }
    } catch (err) {
      results[entry.name] = { status: 'error', error: err.message };
      console.log(`⚠️ [${pct}%] ${entry.name} — error: ${err.message}`);
    }

    // Save progress every 10
    if ((i + 1) % 10 === 0 || i === remaining.length - 1) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    }

    await sleep(DELAY_MS);
  }

  // Summary
  const allFound = Object.values(results).filter(r => r.status === 'found');
  const allNotResy = Object.values(results).filter(r => r.status === 'not_on_resy');
  const allErrors = Object.values(results).filter(r => r.status === 'error');

  console.log(`\n📊 Final Results:`);
  console.log(`   ✅ Fixed: ${allFound.length}`);
  console.log(`   ❌ Not on Resy: ${allNotResy.length}`);
  console.log(`   ⚠️ Errors: ${allErrors.length}`);

  if (allFound.length > 0) {
    const strategies = {};
    allFound.forEach(r => { strategies[r.strategy] = (strategies[r.strategy] || 0) + 1; });
    console.log(`   Strategies:`, strategies);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\n💾 Saved to ${OUTPUT_FILE}`);
}

main().catch(console.error);
