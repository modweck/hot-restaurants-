/**
 * fix-resy-slugs-and-check.js
 *
 * 1. Finds correct Resy slugs for the 317 failed entries via search API
 * 2. Updates BOOKING_MASTER with correct slugs
 * 3. Runs availability check on the fixed ones
 */

const fs = require('fs');
const path = require('path');

const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const AVAIL_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'tonight_availability.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'resy_slug_fixes.json');

const MASTER = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
const AVAIL = JSON.parse(fs.readFileSync(AVAIL_FILE, 'utf8'));

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

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

async function searchResy(name, lat, lng) {
  try {
    const resp = await fetch('https://api.resy.com/3/venuesearch/search', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ query: name, geo: { latitude: lat || 40.7128, longitude: lng || -74.006 }, types: ['venue'], per_page: 5 })
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
    return { id: data.id.resy, name: data.name, lat: data.location?.geo?.lat, lng: data.location?.geo?.lon };
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

function getHour(timeStr) {
  if (!timeStr) return null;
  const full = timeStr.match(/\d{4}-\d{2}-\d{2} (\d{2}):(\d{2})/);
  if (full) return parseInt(full[1]);
  const bare = timeStr.match(/^(\d{2}):(\d{2})/);
  if (bare) return parseInt(bare[1]);
  return null;
}

function getMinute(timeStr) {
  if (!timeStr) return '00';
  const full = timeStr.match(/\d{4}-\d{2}-\d{2} \d{2}:(\d{2})/);
  if (full) return full[1];
  const bare = timeStr.match(/^\d{2}:(\d{2})/);
  if (bare) return bare[1];
  return '00';
}

function formatTime(timeStr) {
  const h24 = getHour(timeStr);
  if (h24 === null) return null;
  const min = getMinute(timeStr);
  const h12 = h24 > 12 ? h24 - 12 : (h24 === 0 ? 12 : h24);
  const ampm = h24 >= 12 ? 'pm' : 'am';
  return `${h12}:${min}${ampm}`;
}

async function checkAvailability(venueId, date) {
  try {
    const resp = await fetch(`https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${date}&party_size=2&venue_id=${venueId}`, { headers: HEADERS });
    if (!resp.ok) return null;
    const data = await resp.json();
    const slots = (data?.results?.venues?.[0]?.slots || []).map(s => ({
      time: s.date?.start || '', type: s.config?.type || 'dining_room'
    }));

    const dinnerSlots = slots.filter(s => { const h = getHour(s.time); return h !== null && h >= 17 && h < 23; });
    const earlySlots = slots.filter(s => { const h = getHour(s.time); const m = parseInt(getMinute(s.time)||'0'); const t = h*60+m; return t >= 1020 && t < 1110; });
    const primeSlots = slots.filter(s => { const h = getHour(s.time); const m = parseInt(getMinute(s.time)||'0'); const t = h*60+m; return t >= 1125 && t < 1230; });
    const lateSlots = slots.filter(s => { const h = getHour(s.time); const m = parseInt(getMinute(s.time)||'0'); const t = h*60+m; return t >= 1245; });

    const allDinnerCount = dinnerSlots.length + earlySlots.length + lateSlots.length;
    let tier;
    if (slots.length === 0) tier = 'booked';
    else if (allDinnerCount === 0) tier = 'booked';
    else if (allDinnerCount >= 8) tier = 'open';
    else tier = 'limited';

    const dinnerTimes = [...earlySlots, ...dinnerSlots, ...lateSlots].map(s => formatTime(s.time)).filter(Boolean).slice(0, 5);

    return {
      tier, total_slots: slots.length, dinner_slots: allDinnerCount, prime_slots: primeSlots.length,
      sample_times: dinnerTimes, has_early: earlySlots.length > 0, has_prime: primeSlots.length > 0,
      has_late: lateSlots.length > 0, checked_date: date, party_size: 2, platform: 'resy'
    };
  } catch (e) { return null; }
}

async function main() {
  // Step 1: Find the 317 failed resy entries
  const failed = [];
  for (const [name, entry] of Object.entries(MASTER)) {
    if (entry.platform !== 'resy') continue;
    if (AVAIL[name]) continue;
    failed.push({ name, lat: entry.lat, lng: entry.lng, oldUrl: entry.url });
  }

  console.log(`\n🔍 PHASE 1: Fix Resy Slugs (triple verified)`);
  console.log(`📊 Failed Resy entries: ${failed.length}`);
  console.log(`⏱️  Est: ~${Math.round(failed.length * 8 / 60)} minutes\n`);

  const fixes = {};
  let found = 0, notFound = 0;

  for (let i = 0; i < failed.length; i++) {
    const { name, lat, lng } = failed[i];
    process.stdout.write(`  [${String(i + 1).padStart(4)}/${failed.length}] ${name.substring(0, 35).padEnd(35)} `);

    // Search
    const hits = await searchResy(name, lat, lng);
    await sleep(1500);

    if (!hits.length) {
      fixes[name] = { match: null, reason: 'no_results' };
      notFound++;
      console.log('❌ no results');
      continue;
    }

    // Name + location match
    let bestMatch = null, bestConf = null, rejectReason = null;
    for (const hit of hits) {
      const nc = namesMatch(name, hit.name);
      if (!nc.match) continue;
      if (lat && lng && hit.lat && hit.lng) {
        const dist = haversineMiles(lat, lng, hit.lat, hit.lng);
        if (dist > 0.3) { rejectReason = `${dist.toFixed(1)}mi_away`; continue; }
      }
      bestMatch = hit; bestConf = nc.confidence; break;
    }

    if (!bestMatch) {
      fixes[name] = { match: null, reason: rejectReason || 'no_name_match', got: hits.map(h => h.name).slice(0, 2) };
      notFound++;
      console.log(`❌ ${rejectReason || 'no match'}`);
      continue;
    }

    process.stdout.write('[1✓] ');

    // Verify slug
    const venue = await verifySlug(bestMatch.slug);
    await sleep(1500);
    if (!venue) {
      fixes[name] = { match: null, reason: 'slug_inactive' };
      notFound++;
      console.log('[2✗] inactive');
      continue;
    }

    const venueNameCheck = namesMatch(name, venue.name);
    if (!venueNameCheck.match) {
      fixes[name] = { match: null, reason: 'venue_name_mismatch', expected: name, got: venue.name };
      notFound++;
      console.log(`[2✗] mismatch: ${venue.name}`);
      continue;
    }

    process.stdout.write('[2✓] ');

    // Verify bookable
    const bookable = await verifyBookable(venue.id);
    await sleep(1500);
    if (!bookable) {
      fixes[name] = { match: null, reason: 'not_bookable' };
      notFound++;
      console.log('[3✗] not bookable');
      continue;
    }

    fixes[name] = {
      match: { name: venue.name, slug: bestMatch.slug, id: venue.id, confidence: bestConf,
        url: `https://resy.com/cities/ny/${bestMatch.slug}` }
    };
    found++;
    console.log(`[3✓] ✅ ${venue.name} → ${bestMatch.slug}`);

    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ _meta: { found, not_found: notFound }, fixes }, null, 2));
      process.stdout.write('  💾 Saved\n');
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ _meta: { found, not_found: notFound }, fixes }, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 PHASE 1 RESULTS:`);
  console.log(`   ✅ Fixed: ${found}`);
  console.log(`   ❌ No match: ${notFound}\n`);

  // Apply fixes to BOOKING_MASTER
  const freshMaster = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
  let applied = 0;
  for (const [name, fix] of Object.entries(fixes)) {
    if (!fix.match) continue;
    if (!freshMaster[name]) continue;
    freshMaster[name].url = fix.match.url;
    freshMaster[name].resy_url = fix.match.url;
    applied++;
  }
  fs.writeFileSync(MASTER_FILE, JSON.stringify(freshMaster, null, 2));
  console.log(`✅ Applied ${applied} slug fixes to BOOKING_MASTER\n`);

  // Phase 2: Run availability for fixed ones
  const fixedNames = Object.entries(fixes).filter(([_, f]) => f.match).map(([name, f]) => ({ name, venueId: f.match.id, slug: f.match.slug }));

  if (fixedNames.length === 0) {
    console.log('No fixes to check availability for.');
    return;
  }

  console.log(`🍽️  PHASE 2: Check Availability for ${fixedNames.length} fixed restaurants\n`);

  const availOutput = JSON.parse(fs.readFileSync(AVAIL_FILE, 'utf8'));
  let open = 0, limited = 0, booked = 0, failedAvail = 0;

  for (let i = 0; i < fixedNames.length; i++) {
    const { name, venueId, slug } = fixedNames[i];
    process.stdout.write(`  [${String(i + 1).padStart(4)}/${fixedNames.length}] ${name.substring(0, 38).padEnd(38)} `);

    const result = await checkAvailability(venueId, TODAY);

    if (!result) {
      failedAvail++;
      console.log('❌ failed');
      await sleep(3000);
      continue;
    }

    availOutput[name] = { name, url: `https://resy.com/cities/ny/${slug}`, slug, ...result, last_checked: TODAY };

    const emoji = { open: '🟢', limited: '🟡', booked: '🔴' }[result.tier] || '❌';
    const times = result.sample_times?.length ? `  ${result.sample_times.join(', ')}` : '';
    console.log(`${emoji} ${result.tier} (${result.dinner_slots} slots)${times}`);

    if (result.tier === 'open') open++;
    else if (result.tier === 'limited') limited++;
    else booked++;

    await sleep(3000);
  }

  fs.writeFileSync(AVAIL_FILE, JSON.stringify(availOutput, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 PHASE 2 RESULTS:`);
  console.log(`   🟢 Open: ${open}`);
  console.log(`   🟡 Limited: ${limited}`);
  console.log(`   🔴 Booked: ${booked}`);
  console.log(`   ❌ Failed: ${failedAvail}`);
  console.log(`\n💾 Saved availability to tonight_availability.json`);
  console.log('✅ All done!');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
