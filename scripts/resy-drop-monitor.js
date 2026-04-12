/**
 * resy-drop-monitor.js — Monitor what slots actually drop at release times
 *
 * Fires all checks in parallel at the exact drop moment.
 * Logs every slot that appears for each restaurant.
 * Run via cron at midnight, 8am, 9am, 10am, 11am, noon.
 *
 * RUN: node scripts/resy-drop-monitor.js --time midnight
 *      node scripts/resy-drop-monitor.js --time 8am
 *      node scripts/resy-drop-monitor.js --time 9am
 *      node scripts/resy-drop-monitor.js --time 10am
 *      node scripts/resy-drop-monitor.js --time 11am
 *      node scripts/resy-drop-monitor.js --time noon
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'data', 'drop-monitor');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const TODAY = new Date().toISOString().split('T')[0];
const LOG_FILE = path.join(LOG_DIR, `drops-${TODAY}.log`);
const DATA_FILE = path.join(LOG_DIR, `drops-${TODAY}.json`);

const RESY_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const RESY_TOKENS = [
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzk0NjM1NjEsInVpZCI6NjQ3MzQ1NTgsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTM1MTEzMDV9fQ.AI8EyMqEKGkOg1AqUpzTW1P-6k-Dn7mHn05rGOg3rTy_yzav2Lz83Vg0KBEi6p8bO4q6u9oftlCg4Lo1JCLz9pGeAb6ySt8iHsg2XMXD_NdlTNrGREs08gUjf5kl7iQaux3aUtExwzZZwT7WbnCpctLhf3Xmhw8vd7MClbdYX0oUrkzn',
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzk0NjMzOTQsInVpZCI6Mzk4MTc5NDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxMzE1NzU1OTh9fQ.AWsdZutVGRr9OO7HxYfN_KbcjDMNh2zh7OYR1PbBmiOvTGONv8COVN-Nw7ZO93Bhkyw3bHjVuQMVkR6W9Lh3vSefAcqSpock4cViKL4Enf5JD-se2u6VtYUlMOQIJIW6EoGKp6AirSJNUs5DwetuOWob-OLojNA-J8foq-aYs9kZe-kt',
];
let tokenIdx = 0;

function log(msg) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false }) + '.' + String(new Date().getMilliseconds()).padStart(3, '0');
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function getHeaders() {
  const token = RESY_TOKENS[tokenIdx % RESY_TOKENS.length];
  tokenIdx++;
  return {
    'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
    'X-Resy-Auth-Token': token,
    'X-Resy-Universal-Auth': token,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Origin': 'https://resy.com',
    'Referer': 'https://resy.com/',
    'Accept': 'application/json, text/plain, */*',
  };
}

// Resolve venue ID from slug via /3/venue
const venueCache = {};
async function resolveVenueId(slug) {
  if (venueCache[slug]) return venueCache[slug];
  for (const loc of ['new-york-ny', 'ny']) {
    try {
      const resp = await fetch(`https://api.resy.com/3/venue?url_slug=${slug}&location=${loc}`, {
        headers: getHeaders(), signal: AbortSignal.timeout(10000)
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const id = data?.id?.resy;
      if (id) { venueCache[slug] = id; return id; }
    } catch {}
  }
  return null;
}

function futureDate(daysOut) {
  const d = new Date(); d.setDate(d.getDate() + daysOut);
  return d.toISOString().split('T')[0];
}

// ── RESTAURANT DROP CONFIG ──
// Each entry: { name, venue_id, slug, drop_time, window_days }
const DROPS = {
  midnight: [
    { name: 'Bong', venue_id: 86413, slug: 'bong', window: 19 }, // Apr 30
    { name: 'Jeju Noodle Bar', venue_id: 1543, slug: 'jeju-noodle-bar', window: 44 }, // May 25
    { name: 'Red Hook Tavern', venue_id: 3289, slug: 'red-hook-tavern', window: 13 },
    { name: 'FREE RANGE at Double Chicken Please', venue_id: 70330, slug: 'free-range-at-double-chicken-please', window: 6 }, // Apr 17
    { name: 'Ambassadors Clubhouse', venue_id: null, slug: 'ambassadors-clubhouse-new-york', window: 14 },
    { name: 'Golden Diner', venue_id: 52361, slug: 'golden-diner', window: 30 },
    { name: 'Le Café Louis Vuitton', venue_id: null, slug: 'le-cafe-louis-vuitton', window: 28 },
    { name: 'Rubirosa', venue_id: null, slug: 'rubirosa', window: 7 },
    { name: 'Meju', venue_id: null, slug: 'meju', window: 14 },
    { name: 'Hori', venue_id: null, slug: 'hori', window: 14 },
    // Unknown drop times — check at midnight to see
    { name: 'Kimika', venue_id: null, slug: 'kimika', window: 21 },
    { name: 'Fini Williamsburg', venue_id: null, slug: 'fini-williamsburg', window: 14 },
    { name: 'Nura', venue_id: null, slug: 'nura', window: 21 },
    { name: 'Okdongsik', venue_id: null, slug: 'okdongsik', window: 14 },
    { name: 'Dashi Okume Brooklyn', venue_id: null, slug: 'dashi-okume-brooklyn', window: 14 },
    { name: '69 Leonard Street', venue_id: null, slug: '69leonardstreet', window: 29 }, // May 10
    { name: 'Baretto at Fasano', venue_id: null, slug: 'baretto-at-fasano', window: 30 },
    { name: 'Sidecar at PJ Clarkes', venue_id: null, slug: 'sidecar-pj-clarkes', window: 14 },
  ],
  '8am': [
    { name: 'I Cavallini', venue_id: 90079, slug: 'i-cavallini', window: 14 },
  ],
  '9am': [
    { name: '4 Charles Prime Rib', venue_id: 834, slug: '4-charles-prime-rib', window: 21 },
    { name: 'Monkey Bar', venue_id: 60058, slug: 'monkey-bar-nyc', window: 21 },
    { name: 'Theodora', venue_id: null, slug: 'theodora', window: 30 },
    { name: 'Ramen by Ra', venue_id: null, slug: 'ramen-by-ra', window: 30 },
    { name: 'Lei', venue_id: null, slug: 'lei', window: 14 },
  ],
  '10am': [
    { name: 'Torrisi', venue_id: 64593, slug: 'torrisi', window: 30 },
    { name: 'Via Carota', venue_id: 326, slug: 'via-carota', window: 30 },
    { name: 'Bar Primi Bowery', venue_id: null, slug: 'bar-primi-bowery', window: 13 }, // Apr 24
    { name: 'Lilia', venue_id: 2492, slug: 'lilia', window: 28 },
    // Unknown — check at 10am to see
    { name: 'Fulton by Jean-Georges', venue_id: null, slug: 'the-fulton-by-jean-georges', window: 30 },
    { name: 'Izakaya Mew', venue_id: null, slug: 'izakaya-mew', window: 14 },
    { name: 'Gertie', venue_id: null, slug: 'gertie', window: 14 },
  ],
  '11am': [
    { name: 'Bungalow', venue_id: 71822, slug: 'bungalow-ny', window: 20 }, // May 1
  ],
  noon: [
    { name: 'Kappo Sono', venue_id: null, slug: 'kappo-sono', window: 21 },
    { name: 'Tatiana', venue_id: null, slug: 'tatiana-by-kwame-onwuachi', window: 28 },
    { name: 'Carbone', venue_id: null, slug: 'carbone', window: 30 },
    { name: 'I Sodi', venue_id: null, slug: 'i-sodi', window: 30 },
    { name: 'Rezdora', venue_id: null, slug: 'rezdora', window: 30 },
    { name: "Ha's Snack Bar", venue_id: null, slug: 'has-snack-bar', window: 19 }, // Apr 30
  ],
};

async function checkOne(restaurant) {
  const targetDate = futureDate(restaurant.window);
  const t0 = Date.now();
  try {
    // Use pre-resolved venue ID (resolved before parallel blast)
    const vid = venueCache[restaurant.slug];
    if (!vid) return { name: restaurant.name, date: targetDate, error: 'no_venue_id', ms: Date.now() - t0 };
    const url = `https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${targetDate}&party_size=2&venue_id=${vid}`;
    const resp = await fetch(url, { headers: getHeaders(), signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return { name: restaurant.name, date: targetDate, error: resp.status, ms: Date.now() - t0 };
    const data = await resp.json();
    const slots = data?.results?.venues?.[0]?.slots || [];
    const times = slots.map(s => {
      const m = (s.date?.start || '').match(/(\d{2}:\d{2})/);
      return m ? m[1] : null;
    }).filter(Boolean);
    return { name: restaurant.name, date: targetDate, window: restaurant.window, slots: times.length, times, venueId: vid, ms: Date.now() - t0 };
  } catch (e) {
    return { name: restaurant.name, date: targetDate, error: e.message, ms: Date.now() - t0 };
  }
}

async function main() {
  const timeArg = process.argv.find(a => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1]) ||
    process.argv[process.argv.indexOf('--time') + 1] || 'all';

  const timesToCheck = timeArg === 'all' ? Object.keys(DROPS) : [timeArg];

  log('═══════════════════════════════════════════════════');
  log(`RESY DROP MONITOR — ${timesToCheck.join(', ')}`);
  log(`Date: ${TODAY}`);
  log('═══════════════════════════════════════════════════\n');

  // Load existing data
  let allData = {};
  try { allData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}

  // Pre-resolve all venue IDs before the parallel blast
  const allRestaurants = timesToCheck.flatMap(t => DROPS[t] || []);
  log(`Pre-resolving ${allRestaurants.length} venue IDs...\n`);
  for (const r of allRestaurants) {
    const vid = await resolveVenueId(r.slug);
    if (vid) log(`  ✅ ${r.name}: ${vid}`);
    else log(`  ❌ ${r.name}: could not resolve (${r.slug})`);
  }
  log('');

  // ── Wait until drop time if --wait flag is set ──
  const WAIT = process.argv.includes('--wait');
  if (WAIT && timesToCheck.length === 1) {
    const dropHours = { midnight: 0, '8am': 8, '9am': 9, '10am': 10, '11am': 11, noon: 12 };
    const dropH = dropHours[timesToCheck[0]];
    if (dropH !== undefined) {
      const now = new Date();
      const drop = new Date(now);
      drop.setHours(dropH, 0, 0, 0);
      if (drop <= now) drop.setDate(drop.getDate() + 1);
      const waitMs = drop.getTime() - Date.now();
      if (waitMs > 0) {
        log(`Waiting ${Math.round(waitMs / 60000)} minutes until ${timesToCheck[0]} drop...`);
        while (Date.now() < drop.getTime() - 5000) {
          const rem = drop.getTime() - Date.now();
          if (rem > 60000) { log(`   ${Math.round(rem / 60000)} min...`); await new Promise(r => setTimeout(r, 30000)); }
          else { log(`   ${Math.round(rem / 1000)}s...`); await new Promise(r => setTimeout(r, 5000)); }
        }
        // Final countdown - tight loop
        while (Date.now() < drop.getTime() - 500) await new Promise(r => setTimeout(r, 100));
        log('DROP TIME — firing now!');
      }
    }
  }

  for (const time of timesToCheck) {
    const restaurants = DROPS[time];
    if (!restaurants || !restaurants.length) { log(`No restaurants for ${time}`); continue; }

    log(`────── ${time.toUpperCase()} DROP (${restaurants.length} restaurants) ──────`);
    log(`Firing all ${restaurants.length} checks in parallel...\n`);

    const t0 = Date.now();
    const results = await Promise.all(restaurants.map(r => checkOne(r)));
    const totalMs = Date.now() - t0;

    let dropped = 0, empty = 0, errors = 0;

    for (const r of results) {
      if (r.error) {
        errors++;
        log(`  ❌ ${r.name} → ${r.date}: ERROR ${r.error} (${r.ms}ms)`);
      } else if (r.slots === 0) {
        empty++;
        log(`  ⚫ ${r.name} → ${r.date}: 0 slots (${r.ms}ms)`);
      } else {
        dropped++;
        log(`  🟢 ${r.name} → ${r.date}: ${r.slots} slots! (${r.ms}ms)`);
        log(`     TIMES: ${r.times.join(', ')}`);
      }

      // Save to data
      if (!allData[r.name]) allData[r.name] = {};
      allData[r.name][time] = {
        date_checked: r.date,
        window: r.window,
        slots: r.slots || 0,
        times: r.times || [],
        error: r.error || null,
        checked_at: new Date().toISOString(),
      };
    }

    log(`\n  ⚡ All ${restaurants.length} checked in ${totalMs}ms — 🟢 ${dropped} dropped | ⚫ ${empty} empty | ❌ ${errors} errors\n`);
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(allData, null, 2));
  log(`Saved → ${DATA_FILE}`);
  log('═══════════════════════════════════════════════════');
}

main().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
