/**
 * google-reserve-node.js
 *
 * Checks Google Reserve availability for all Google Reserve restaurants.
 * Runs as Node script — no browser needed.
 *
 * RUN:   node scripts/google-reserve-node.js
 * OPTIONS:
 *   --quick    First 20 only
 *   --resume   Skip already checked today
 *
 * OUTPUT: netlify/functions/tonight_availability_google.json
 */

const fs = require('fs');
const path = require('path');

const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'tonight_availability_google.json');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const RESUME = args.includes('--resume');
const PARTY_SIZE = 2;
const TODAY = new Date().toISOString().split('T')[0];
const DATE_COMPACT = TODAY.replace(/-/g, '');
const TIMES = ['T173000', 'T193000', 'T210000'];
const BATCH = 5;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Load master — get all google_reserve restaurants with reserve_id
const master = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
const entries = [];
for (const [name, info] of Object.entries(master)) {
  if (info.platform !== 'google_reserve') continue;
  const rid = info.reserve_id || info.google_reserve_id;
  if (!rid) continue;
  entries.push([name, rid]);
}

console.log(`🔍 Google Reserve: ${entries.length} restaurants`);
console.log(`📅 Date: ${TODAY} | Party: ${PARTY_SIZE}\n`);

// Load existing
let existing = {};
try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}

function parseSlots(html) {
  const raw = html.match(/\d{1,2}:\d{2}[\s\u202f]*[AP]M/gi) || [];
  const unique = [...new Set(raw.map(t => t.replace(/\u202f/g, ' ')))];
  const dinner = [];
  for (const t of unique) {
    const m = t.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
    if (!m) continue;
    let h = parseInt(m[1]);
    if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
    const hour = h + parseInt(m[2]) / 60;
    if (hour >= 17 && hour <= 23) dinner.push(t);
  }
  return dinner;
}

async function checkRestaurant(name, rid) {
  const allTimes = new Set();

  for (const timeCode of TIMES) {
    const url = `https://www.google.com/maps/reserve/v/dine/c/${rid}?hl=en-US&ps=${PARTY_SIZE}&ld=${DATE_COMPACT}${timeCode}`;
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
      });
      if (!resp.ok) continue;
      const html = await resp.text();
      parseSlots(html).forEach(t => allTimes.add(t));
    } catch {}
  }

  const parsed = [...allTimes];
  let early = 0, prime = 0, late = 0;
  const dinnerTimes = [];

  for (const t of parsed) {
    const m = t.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
    if (!m) continue;
    let h = parseInt(m[1]);
    if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
    const hour = h + parseInt(m[2]) / 60;
    if (hour < 17) continue;
    dinnerTimes.push(t);
    if (hour < 18.75) early++;
    else if (hour >= 19.0 && hour < 20.5) prime++;
    else if (hour >= 20.5) late++;
  }

  function ws(c) { return c === 0 ? 'booked' : c <= 2 ? 'limited' : 'available'; }
  const e = ws(early), p = ws(prime), l = ws(late);
  let tier;
  if (e === 'available' && p === 'available' && l === 'available') tier = 'open';
  else if (e === 'booked' && p === 'booked' && l === 'booked') tier = 'booked';
  else tier = 'limited';

  return {
    tier, early: e, prime: p, late: l,
    has_early: early > 0, has_prime: prime > 0, has_late: late > 0,
    dinner_slots: dinnerTimes.length,
    sample_times: dinnerTimes.slice(0, 12),
    platform: 'google_reserve',
    checked_date: new Date().toISOString()
  };
}

async function main() {
  let list = [...entries];
  if (RESUME) {
    list = list.filter(([name]) => {
      const e = existing[name.toLowerCase()];
      return !e || !e.checked_date || !e.checked_date.startsWith(TODAY);
    });
    console.log(`⏭️  Resuming: ${list.length} remaining`);
  }
  if (QUICK) list = list.slice(0, 20);

  console.log(`🔍 Checking ${list.length} restaurants...\n`);

  const results = { ...existing };
  let checked = 0, open = 0, limited = 0, booked = 0;

  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    const promises = batch.map(([name, rid]) => checkRestaurant(name, rid).then(r => ({ name, result: r })));
    const batchResults = await Promise.all(promises);

    for (const { name, result } of batchResults) {
      results[name.toLowerCase()] = result;
      checked++;
      if (result.tier === 'open') open++;
      else if (result.tier === 'limited') limited++;
      else booked++;

      const icon = result.tier === 'open' ? '🟢' : result.tier === 'limited' ? '🟡' : '🔴';
      console.log(`  ${icon} [${checked}/${list.length}] ${name}: E=${result.early} P=${result.prime} L=${result.late} (${result.dinner_slots} slots)`);
    }

    // Save every 25
    if (checked % 25 === 0 || checked === list.length) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    }

    await sleep(500);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Done! Checked ${checked} Google Reserve restaurants`);
  console.log(`   🟢 Open: ${open}  🟡 Limited: ${limited}  🔴 Booked: ${booked}`);
  console.log(`   Output: ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
