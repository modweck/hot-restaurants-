/**
 * my-drops-monitor-today.js — One-off monitors for today's tests
 *
 * 9am: 69 Leonard (14d) + Rezdora (29d)
 * 10am: Bar Primi (28d)
 *
 * RUN:
 *   node scripts/my-drops-monitor-today.js --time 9am --wait
 *   node scripts/my-drops-monitor-today.js --time 10am --wait
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'data', 'drop-monitor');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const TODAY = new Date().toISOString().split('T')[0];
const LOG_FILE = path.join(LOG_DIR, `today-drops-${TODAY}.log`);
const DATA_FILE = path.join(LOG_DIR, `today-drops-${TODAY}.json`);

const RESY_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const RESY_TOKENS = [
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3ODE4NzcwMDEsInVpZCI6NjQ3MzQ1NTgsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTM1MTEzMDV9fQ.AOlKh4ANqfmn4d15NBxgPMa6jLS7lgXTJ_9e-3uRMkUUl_SZi_5nI6bA4qBvXO-FgM8HMJXEYokbe0cP9lAim5LSAbxkhpiKzC1JpPV4PCUTJ7TKc2BuAyFdLxOHh7BvGLjprkYkeyQYCqxmCK6m0DIEG5ueF4l6CyzVbjMvlmu584lY',
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

const DROPS = {
  '9am': [
    { name: '69 Leonard Street', venue_id: null, slug: '69leonardstreet', window: 14 },
    { name: 'Rezdora', venue_id: 5771, slug: 'rezdora', window: 29 },
  ],
  '10am': [
    { name: 'Bar Primi Bowery', venue_id: 52614, slug: 'bar-primi-bowery', window: 28 },
  ],
};

async function checkOne(restaurant) {
  const targetDate = futureDate(restaurant.window);
  const t0 = Date.now();
  try {
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
  const timeArg = process.argv[process.argv.indexOf('--time') + 1] || 'all';
  const WAIT = process.argv.includes('--wait');
  const timesToCheck = timeArg === 'all' ? Object.keys(DROPS) : [timeArg];

  log('═══════════════════════════════════════════════════');
  log(`TODAY'S DROP TEST — ${timesToCheck.join(', ')}`);
  log(`Date: ${TODAY}`);
  log('═══════════════════════════════════════════════════\n');

  let allData = {};
  try { allData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}

  const allRestaurants = timesToCheck.flatMap(t => DROPS[t] || []);
  log(`Pre-resolving ${allRestaurants.length} venue IDs...\n`);
  for (const r of allRestaurants) {
    const vid = await resolveVenueId(r.slug);
    if (vid) log(`  ✅ ${r.name}: ${vid}`);
    else log(`  ❌ ${r.name}: could not resolve (${r.slug})`);
  }
  log('');

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
        while (Date.now() < drop.getTime() - 500) await new Promise(r => setTimeout(r, 100));
        log('DROP TIME — firing now!');
      }
    }
  }

  for (const time of timesToCheck) {
    const restaurants = DROPS[time];
    if (!restaurants || !restaurants.length) continue;
    log(`────── ${time.toUpperCase()} DROP (${restaurants.length} restaurants) ──────`);
    log(`Firing all ${restaurants.length} checks in parallel...\n`);
    const t0 = Date.now();
    const results = await Promise.all(restaurants.map(r => checkOne(r)));
    const totalMs = Date.now() - t0;
    let dropped = 0, empty = 0, errors = 0;
    for (const r of results) {
      if (r.error) { errors++; log(`  ❌ ${r.name} → ${r.date}: ERROR ${r.error} (${r.ms}ms)`); }
      else if (r.slots === 0) { empty++; log(`  ⚫ ${r.name} → ${r.date}: 0 slots (${r.ms}ms)`); }
      else { dropped++; log(`  🟢 ${r.name} → ${r.date}: ${r.slots} slots! (${r.ms}ms)`); log(`     TIMES: ${r.times.join(', ')}`); }
      if (!allData[r.name]) allData[r.name] = {};
      allData[r.name][time] = { date_checked: r.date, window: r.window, slots: r.slots || 0, times: r.times || [], error: r.error || null, checked_at: new Date().toISOString() };
    }
    log(`\n  ⚡ All ${restaurants.length} checked in ${totalMs}ms — 🟢 ${dropped} dropped | ⚫ ${empty} empty | ❌ ${errors} errors\n`);
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(allData, null, 2));
  log(`Saved → ${DATA_FILE}`);
  log('═══════════════════════════════════════════════════');
}

main().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
