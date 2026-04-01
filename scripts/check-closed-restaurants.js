/**
 * check-closed-restaurants.js
 *
 * Checks Google Places API for business_status on restaurants with dead OT links.
 * Identifies which are permanently closed vs still open.
 *
 * RUN:   node scripts/check-closed-restaurants.js
 * OPTIONS:
 *   --quick     First 30 only
 *   --resume    Skip already checked
 *
 * OUTPUT: data/closed_check.json
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const RESUME = args.includes('--resume');

const GOOGLE_KEY = 'AIzaSyDrtbSIA_BvJIzq1_-3pfQ_RgP2DiM_TKo';
const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const OT_CHECK_FILE = path.join(__dirname, '..', 'data', 'ot_link_check.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'closed_check.json');

const MASTER = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
const OT_CHECK = JSON.parse(fs.readFileSync(OT_CHECK_FILE, 'utf8'));

let previous = {};
if (RESUME) {
  try {
    previous = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    console.log(`📂 Loaded ${Object.keys(previous.results || {}).length} previous results`);
  } catch (e) {}
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function checkPlaceStatus(placeId) {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,business_status&key=${GOOGLE_KEY}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.status !== 'OK') return { status: 'error', error: data.status };
    return {
      status: data.result.business_status || 'UNKNOWN',
      google_name: data.result.name
    };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
}

async function main() {
  const toCheck = [];
  for (const [name, v] of Object.entries(OT_CHECK.results || {})) {
    if (v.valid) continue;
    if (RESUME && previous.results && previous.results[name]) continue;
    const m = MASTER[name];
    if (!m?.place_id) continue;
    toCheck.push({ name, place_id: m.place_id });
  }

  let checkList = QUICK ? toCheck.slice(0, 30) : toCheck;

  console.log(`\n🏢 Restaurant Status Checker (Google Places)`);
  console.log(`🎯 Checking: ${checkList.length}`);
  console.log(`⏱️  Est: ~${Math.round(checkList.length * 0.5 / 60)} minutes\n`);

  const results = previous.results || {};
  const counts = { OPERATIONAL: 0, CLOSED_PERMANENTLY: 0, CLOSED_TEMPORARILY: 0, UNKNOWN: 0, error: 0 };

  // Count previous
  for (const v of Object.values(results)) {
    counts[v.status] = (counts[v.status] || 0) + 1;
  }

  for (let i = 0; i < checkList.length; i++) {
    const { name, place_id } = checkList[i];
    process.stdout.write(`  [${String(i + 1).padStart(4)}/${checkList.length}] ${name.substring(0, 38).padEnd(38)} `);

    const result = await checkPlaceStatus(place_id);
    results[name] = { place_id, ...result };
    counts[result.status] = (counts[result.status] || 0) + 1;

    const emoji = {
      'OPERATIONAL': '✅',
      'CLOSED_PERMANENTLY': '💀',
      'CLOSED_TEMPORARILY': '⏸️ ',
      'UNKNOWN': '❓',
      'error': '⚠️ '
    }[result.status] || '❓';
    console.log(`${emoji} ${result.status}`);

    // Save every 100
    if ((i + 1) % 100 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ _meta: { ...counts, total: Object.keys(results).length, last_run: new Date().toISOString() }, results }, null, 2));
      process.stdout.write(`  💾 Saved progress\n`);
    }

    await sleep(200); // Google allows ~50 QPS, but be safe
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ _meta: { ...counts, total: Object.keys(results).length, last_run: new Date().toISOString() }, results }, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 RESULTS:`);
  console.log(`   ✅ Still open:           ${counts.OPERATIONAL}`);
  console.log(`   💀 Permanently closed:   ${counts.CLOSED_PERMANENTLY}`);
  console.log(`   ⏸️  Temporarily closed:   ${counts.CLOSED_TEMPORARILY}`);
  console.log(`   ❓ Unknown:              ${counts.UNKNOWN || 0}`);
  console.log(`   ⚠️  Errors:               ${counts.error || 0}`);
  console.log(`\n💾 Saved to: ${OUTPUT_FILE}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
