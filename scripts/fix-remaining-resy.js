/**
 * fix-remaining-resy.js
 *
 * Goes through the ~301 Resy entries missing from availability:
 * 1. Checks if current slug is valid
 * 2. If not, searches Resy for the correct slug (looser matching)
 * 3. Updates BOOKING_MASTER with fixes
 * 4. Checks availability for all valid ones
 * 5. Marks truly dead ones for removal
 */

const fs = require('fs');
const path = require('path');

const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const AVAIL_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'tonight_availability.json');
const PROGRESS_FILE = path.join(__dirname, '..', 'data', 'resy_fix_progress.json');

const RESY_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const RESY_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzc5MDk0MTQsInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.AWCYkK7wyE0h-KnU7IMnRzUTPpPPh_B7t2ZsXPKg3Pj4uTvQvtGRLLUwG1TYB7yulCfq2U3iD6UdtQgyR4ashAnHAAcrbXK3jAr0BT6YPjHWHadcdlT8KUpeSv2Dixv-PlrW0gfm1eKtocNFz7qn-p14iVgI2YnLZU_KwoUsB3fW0Co1';

const HEADERS = {
  'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
  'X-Resy-Auth-Token': RESY_TOKEN,
  'X-Resy-Universal-Auth': RESY_TOKEN,
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Origin': 'https://resy.com',
  'Referer': 'https://resy.com/',
  'Accept': 'application/json, text/plain, */*'
};

const TODAY = new Date().toISOString().split('T')[0];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalize(name) {
  return (name || '').toLowerCase()
    .replace(/[''`\u2019\u2018]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function extractSlug(url) {
  if (!url) return null;
  const m = url.match(/resy\.com\/cities\/[^/]+\/(?:venues\/)?([^?#]+)/);
  return m ? m[1].replace(/\/$/, '') : null;
}

async function verifySlug(slug) {
  try {
    const resp = await fetch(`https://api.resy.com/3/venue?url_slug=${slug}&location=ny`, { headers: HEADERS });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.id?.resy) return null;
    return { id: data.id.resy, name: data.name, slug: data.url_slug || slug };
  } catch (e) { return null; }
}

async function searchResy(name, lat, lng) {
  try {
    const resp = await fetch('https://api.resy.com/3/venuesearch/search', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ query: name, geo: { latitude: lat || 40.7128, longitude: lng || -74.006 }, types: ['venue'], per_page: 5 })
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.search?.hits || []).map(h => ({
      name: h.name, slug: h.url_slug, id: h.id?.resy
    }));
  } catch (e) { return []; }
}

function namesMatch(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 'exact';
  if (na.includes(nb) || nb.includes(na)) return 'contains';
  // Word overlap
  const wa = na.split(' ').filter(Boolean);
  const wb = new Set(nb.split(' ').filter(Boolean));
  const matches = wa.filter(w => wb.has(w)).length;
  if (matches > 0 && matches / Math.max(wa.length, wb.size) >= 0.5) return 'overlap';
  // First word match (common for restaurant names)
  if (wa[0] && wb.has(wa[0]) && wa[0].length >= 4) return 'first_word';
  return null;
}

function getHour(t) { const m = (t||'').match(/(\d{2}):\d{2}/); return m ? parseInt(m[1]) : null; }
function getMin(t) { const m = (t||'').match(/\d{2}:(\d{2})/); return m ? m[1] : '00'; }
function fmtTime(t) {
  const h = getHour(t); if (h === null) return null;
  const min = getMin(t);
  const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
  return `${h12}:${min}${h >= 12 ? 'pm' : 'am'}`;
}

async function checkAvailability(venueId) {
  try {
    const resp = await fetch(`https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${TODAY}&party_size=2&venue_id=${venueId}`, { headers: HEADERS });
    if (!resp.ok) return null;
    const data = await resp.json();
    const slots = (data?.results?.venues?.[0]?.slots || []).map(s => ({
      time: s.date?.start || '', type: s.config?.type || 'dining_room'
    }));
    const dinner = slots.filter(s => { const h = getHour(s.time); return h !== null && h >= 17 && h < 23; });
    const early = slots.filter(s => { const h = getHour(s.time); const m = parseInt(getMin(s.time)); const t = h*60+m; return t >= 1020 && t < 1110; });
    const prime = slots.filter(s => { const h = getHour(s.time); const m = parseInt(getMin(s.time)); const t = h*60+m; return t >= 1125 && t < 1230; });
    const late = slots.filter(s => { const h = getHour(s.time); const m = parseInt(getMin(s.time)); const t = h*60+m; return t >= 1245; });
    const allDinner = dinner.length + early.length + late.length;
    let tier = allDinner === 0 ? 'booked' : allDinner >= 8 ? 'open' : 'limited';
    const times = [...early, ...dinner, ...late].map(s => fmtTime(s.time)).filter(Boolean).slice(0, 5);
    return { tier, dinner_slots: allDinner, has_early: early.length > 0, has_prime: prime.length > 0, has_late: late.length > 0, sample_times: times };
  } catch (e) { return null; }
}

async function main() {
  const master = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
  const avail = JSON.parse(fs.readFileSync(AVAIL_FILE, 'utf8'));

  // Load progress if resuming
  let progress = {};
  if (fs.existsSync(PROGRESS_FILE)) {
    progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  }

  // Find broken resy entries
  const broken = [];
  for (const [name, entry] of Object.entries(master)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.platform !== 'resy') continue;
    if (avail[name]) continue;
    if (progress[name]) continue; // already processed
    broken.push({ name, url: entry.url, lat: entry.lat, lng: entry.lng });
  }

  console.log(`\n🔧 Fixing remaining Resy entries`);
  console.log(`   Already processed: ${Object.keys(progress).length}`);
  console.log(`   Remaining: ${broken.length}`);
  console.log(`   Delay: 2s between requests\n`);

  let fixed = 0, dead = 0, slugOk = 0;
  const stats = { slug_valid: 0, search_found: 0, dead: 0, error: 0 };

  for (let i = 0; i < broken.length; i++) {
    const { name, url, lat, lng } = broken[i];
    const slug = extractSlug(url);
    process.stdout.write(`  [${String(i + 1).padStart(4)}/${broken.length}] ${name.substring(0, 35).padEnd(35)} `);

    // Step 1: Check if current slug works
    if (slug) {
      const venue = await verifySlug(slug);
      await sleep(2000);

      if (venue) {
        // Slug works! Check availability
        const avResult = await checkAvailability(venue.id);
        await sleep(2000);

        if (avResult) {
          avail[name] = { name, url, slug, ...avResult, last_checked: TODAY, platform: 'resy' };
          progress[name] = { status: 'slug_valid', venue_name: venue.name, venue_id: venue.id };
          stats.slug_valid++;
          const emoji = { open: '🟢', limited: '🟡', booked: '🔴' }[avResult.tier];
          console.log(`${emoji} slug OK → ${avResult.tier} (${avResult.dinner_slots} slots)`);
          continue;
        }
      }
    }

    // Step 2: Search Resy for correct slug
    const hits = await searchResy(name, lat, lng);
    await sleep(2000);

    let bestMatch = null, bestConf = null;
    for (const hit of hits) {
      const conf = namesMatch(name, hit.name);
      if (conf) { bestMatch = hit; bestConf = conf; break; }
    }

    if (bestMatch) {
      // Verify the found slug
      const venue = await verifySlug(bestMatch.slug);
      await sleep(2000);

      if (venue) {
        fixed++;
        stats.search_found++;
        progress[name] = { status: 'fixable', old_slug: slug, new_slug: bestMatch.slug, new_url: `https://resy.com/cities/ny/${bestMatch.slug}`, venue_name: venue.name, venue_id: venue.id, confidence: bestConf };
        console.log(`✅ fixable → ${bestMatch.slug} (${bestConf})`);
        continue;
      }
    }

    // Step 3: Dead — not on Resy
    progress[name] = { status: 'dead', reason: hits.length ? 'no_match' : 'not_found', search_results: hits.map(h => h.name).slice(0, 3) };
    stats.dead++;
    dead++;
    console.log(`💀 dead${hits.length ? ' (no match: ' + hits[0]?.name + ')' : ' (not found)'}`);

    // Save progress every 25
    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
      console.log(`  💾 Saved progress (${i + 1}/${broken.length})`);
    }
  }

  // Final save
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
  fs.writeFileSync(AVAIL_FILE, JSON.stringify(avail, null, 2));
  fs.writeFileSync(MASTER_FILE, JSON.stringify(master, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 RESULTS:`);
  console.log(`   ✅ Slug already valid: ${stats.slug_valid}`);
  console.log(`   🔧 Fixed via search:   ${stats.search_found}`);
  console.log(`   💀 Dead / not on Resy: ${stats.dead}`);
  console.log(`\n💾 All saved.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
