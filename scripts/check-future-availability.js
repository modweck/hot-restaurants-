/**
 * check-future-availability.js
 *
 * Checks Resy availability for currently-booked restaurants
 * at +3, +5, +7, +14, +21 days out.
 *
 * RUN: node scripts/check-future-availability.js
 */

const fs = require('fs');
const path = require('path');

const fetch = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args);
  try { return require('node-fetch')(...args); }
  catch (e) { throw new Error("fetch not available. Use Node 18+ or add node-fetch."); }
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const TONIGHT_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'tonight_availability.json');
const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const tonight = JSON.parse(fs.readFileSync(TONIGHT_FILE, 'utf8'));
const master = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));

function extractResySlug(url) {
  if (!url) return null;
  const m = url.match(/resy\.com\/cities\/[a-z-]+\/([a-z0-9-]+)\/?/i);
  return m ? m[1] : null;
}

// Get booked restaurants, pulling slugs from BOOKING_MASTER
const booked = Object.entries(tonight)
  .filter(([k, v]) => !k.startsWith('_') && (v.tier === 'booked' || v.tier === 'fully_booked'))
  .map(([name, v]) => {
    const m = master[name];
    const url = m?.url || v.url || '';
    const slug = extractResySlug(url);
    return { name, slug, url };
  })
  .filter(r => r.slug);

console.log(`\n🔍 Checking ${booked.length} booked restaurants for future availability`);

// Date offsets to check
const OFFSETS = [3, 5, 7, 14, 21];
const today = new Date();

function getDateStr(offset) {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

const dates = OFFSETS.map(o => ({ offset: o, date: getDateStr(o) }));
console.log(`📅 Dates: ${dates.map(d => `+${d.offset} (${d.date})`).join(', ')}`);
console.log(`📊 Total API calls: ${booked.length * dates.length}\n`);

const headers = {
  'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
  'X-Resy-Auth-Token': 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzc5MDk0MTQsInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.AWCYkK7wyE0h-KnU7IMnRzUTPpPPh_B7t2ZsXPKg3Pj4uTvQvtGRLLUwG1TYB7yulCfq2U3iD6UdtQgyR4ashAnHAAcrbXK3jAr0BT6YPjHWHadcdlT8KUpeSv2Dixv-PlrW0gfm1eKtocNFz7qn-p14iVgI2YnLZU_KwoUsB3fW0Co1',
  'X-Resy-Universal-Auth': 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzc5MDk0MTQsInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.AWCYkK7wyE0h-KnU7IMnRzUTPpPPh_B7t2ZsXPKg3Pj4uTvQvtGRLLUwG1TYB7yulCfq2U3iD6UdtQgyR4ashAnHAAcrbXK3jAr0BT6YPjHWHadcdlT8KUpeSv2Dixv-PlrW0gfm1eKtocNFz7qn-p14iVgI2YnLZU_KwoUsB3fW0Co1',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Origin': 'https://resy.com',
  'Referer': 'https://resy.com/',
  'Accept': 'application/json'
};

// Cache venue IDs to avoid re-fetching
const venueIdCache = {};

async function getVenueId(slug, retries = 0) {
  if (venueIdCache[slug]) return venueIdCache[slug];

  try {
    const resp = await fetch(`https://api.resy.com/3/venue?url_slug=${slug}&location=ny`, { headers });
    if (resp.status === 429 || resp.status === 503) {
      if (retries < 3) {
        await sleep((retries + 1) * 10000);
        return getVenueId(slug, retries + 1);
      }
      return null;
    }
    if (!resp.ok) return null;
    const data = await resp.json();
    const id = data?.id?.resy;
    if (id) venueIdCache[slug] = id;
    return id;
  } catch (e) {
    if (retries < 2) { await sleep(5000); return getVenueId(slug, retries + 1); }
    return null;
  }
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

async function checkAvailability(venueId, date, partySize = 2, retries = 0) {
  try {
    const resp = await fetch(
      `https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${date}&party_size=${partySize}&venue_id=${venueId}`,
      { headers }
    );
    if (resp.status === 429 || resp.status === 503) {
      if (retries < 3) {
        process.stdout.write('⏳');
        await sleep((retries + 1) * 10000);
        return checkAvailability(venueId, date, partySize, retries + 1);
      }
      return { error: 'rate_limited', slots: [] };
    }
    if (!resp.ok) return { error: `http_${resp.status}`, slots: [] };
    const data = await resp.json();
    const slots = (data?.results?.venues?.[0]?.slots || []).map(s => ({
      time: s.date?.start || '',
      type: s.config?.type || 'dining_room'
    }));
    return { slots, error: null };
  } catch (e) {
    if (retries < 2) { await sleep(5000); return checkAvailability(venueId, date, partySize, retries + 1); }
    return { error: e.message, slots: [] };
  }
}

function classifySlots(slots) {
  const dinnerSlots = slots.filter(s => {
    const h = getHour(s.time);
    return h !== null && h >= 17 && h < 23;
  });

  const times = dinnerSlots.map(s => formatTime(s.time)).filter(Boolean);

  if (dinnerSlots.length === 0) return { status: '🔴', count: 0, times: [] };
  if (dinnerSlots.length >= 8) return { status: '🟢', count: dinnerSlots.length, times: times.slice(0, 5) };
  return { status: '🟡', count: dinnerSlots.length, times: times.slice(0, 5) };
}

async function main() {
  const results = {};
  let greenFinds = [];
  let apiCalls = 0;

  for (let i = 0; i < booked.length; i++) {
    const r = booked[i];
    process.stdout.write(`[${String(i+1).padStart(3)}/${booked.length}] ${r.name.substring(0, 35).padEnd(35)} `);

    const venueId = await getVenueId(r.slug);
    if (!venueId) {
      console.log('❌ no venue ID');
      await sleep(1500);
      continue;
    }
    apiCalls++;

    const dateResults = {};
    for (const d of dates) {
      await sleep(1500);
      const avail = await checkAvailability(venueId, d.date);
      apiCalls++;
      const classified = classifySlots(avail.slots || []);
      dateResults[`+${d.offset}`] = classified;

      if (classified.status === '🟢' || classified.status === '🟡') {
        greenFinds.push({
          name: r.name,
          slug: r.slug,
          date: d.date,
          offset: d.offset,
          status: classified.status,
          count: classified.count,
          times: classified.times
        });
      }
    }

    results[r.name] = dateResults;

    // Print compact row
    const row = dates.map(d => {
      const dr = dateResults[`+${d.offset}`];
      return `+${d.offset}:${dr.status}${dr.count}`;
    }).join(' ');
    console.log(row);
  }

  // Summary
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📊 FUTURE AVAILABILITY SUMMARY`);
  console.log(`   API calls made: ${apiCalls}`);
  console.log(`${'═'.repeat(70)}\n`);

  if (greenFinds.length === 0) {
    console.log('❌ No availability found for any booked restaurant on any future date.\n');
  } else {
    // Group by status
    const green = greenFinds.filter(f => f.status === '🟢');
    const yellow = greenFinds.filter(f => f.status === '🟡');

    if (green.length > 0) {
      console.log(`🟢 WIDE OPEN (8+ dinner slots):`);
      console.log('─'.repeat(70));
      for (const f of green) {
        console.log(`  ${f.name.padEnd(35)} +${String(f.offset).padEnd(3)} ${f.date}  ${f.count} slots  ${f.times.join(', ')}`);
      }
      console.log();
    }

    if (yellow.length > 0) {
      console.log(`🟡 LIMITED (1-7 dinner slots):`);
      console.log('─'.repeat(70));
      for (const f of yellow) {
        console.log(`  ${f.name.padEnd(35)} +${String(f.offset).padEnd(3)} ${f.date}  ${f.count} slots  ${f.times.join(', ')}`);
      }
      console.log();
    }
  }

  // Per-restaurant grid
  console.log(`\n📋 FULL GRID:`);
  console.log('─'.repeat(70));
  const header = 'Restaurant'.padEnd(36) + dates.map(d => `+${d.offset}`.padStart(8)).join('');
  console.log(header);
  console.log('─'.repeat(70));

  for (const [name, dr] of Object.entries(results)) {
    const row = dates.map(d => {
      const r = dr[`+${d.offset}`];
      return `${r.status}${String(r.count).padStart(2)}`.padStart(8);
    }).join('');
    console.log(`${name.substring(0, 35).padEnd(36)}${row}`);
  }

  console.log('\n✅ Done!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
