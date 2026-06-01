#!/usr/bin/env node
// Backfill `closed_days` on every restaurant in BOOKING_MASTER.json using the
// Google Places Details API. Each restaurant already has a `place_id`; we ask
// Google for `opening_hours.periods` and translate the missing weekdays into a
// `closed_days: ['sunday', 'monday', ...]` array. The frontend can then render
// a "Closed Sun" badge from that field.
//
//   Dry run:     node scripts/backfill-restaurant-hours.js
//   Test 50:     node scripts/backfill-restaurant-hours.js --limit=50
//   Apply all:   node scripts/backfill-restaurant-hours.js --apply
//   Refresh:     node scripts/backfill-restaurant-hours.js --force
//
// Requires: GOOGLE_PLACES_API_KEY env var with the Places Details API enabled.
//   GOOGLE_PLACES_API_KEY=AIzaSyXXX... node scripts/backfill-restaurant-hours.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MASTER_PATH = path.join(ROOT, 'netlify/functions/BOOKING_MASTER.json');
const LOG_PATH = path.join(ROOT, 'scripts/backfill-restaurant-hours.last-run.log');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const VERBOSE = args.includes('--verbose');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.slice(8), 10) : 0;
const concArg = args.find(a => a.startsWith('--concurrency='));
const CONCURRENCY = concArg ? Math.max(1, parseInt(concArg.slice(14), 10)) : 10;

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) {
  console.error('ERROR: GOOGLE_PLACES_API_KEY env var not set.');
  console.error('Run with:  GOOGLE_PLACES_API_KEY=AIzaSyXXX... node scripts/backfill-restaurant-hours.js');
  process.exit(1);
}
// Defensive: handle comma-mashed key value the same way get-maps-key.js does
const KEY = (API_KEY.split(',').map(s => s.trim()).find(k => /^AIzaSy[\w-]{30,}$/.test(k))) || API_KEY;

const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
// Google's weekday_text starts on Monday — this maps its index → our day name.
const WEEKDAY_TEXT_DAY = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

// Translate Google's opening_hours object into both:
//   weekly_hours: { sunday: 'Closed' | '11:00 AM – 10:00 PM', monday: ..., ... }
//   closed_days:  ['sunday', 'monday', ...]  (derived from weekly_hours)
// Returns:
//   { weekly_hours, closed_days, always_open: bool }  on success
//   null                                              if no hours info available
function parseHours(openingHours) {
  if (!openingHours) return null;

  // 24/7 case: Google sets a single period {open:{day:0,time:'0000'}} with no close
  const periods = openingHours.periods || [];
  const is247 = periods.length === 1
                && periods[0].open?.day === 0
                && periods[0].open?.time === '0000'
                && !periods[0].close;
  if (is247) {
    const wh = {};
    for (const d of DAY_NAMES) wh[d] = 'Open 24 hours';
    return { weekly_hours: wh, closed_days: [], always_open: true };
  }

  // Build weekly_hours from weekday_text (starts Monday in Google's response).
  // Format: "Monday: 11:00 AM – 10:00 PM" or "Sunday: Closed"
  const wt = Array.isArray(openingHours.weekday_text) ? openingHours.weekday_text : null;
  const weekly_hours = {};
  if (wt && wt.length === 7) {
    for (let i = 0; i < 7; i++) {
      const m = wt[i].match(/^[^:]+:\s*(.+)$/);
      weekly_hours[WEEKDAY_TEXT_DAY[i]] = m ? m[1].trim() : 'Unknown';
    }
  } else if (periods.length) {
    // Fallback: build from periods (less pretty formatting, but salvageable)
    const dayPeriods = {};
    for (let d = 0; d < 7; d++) dayPeriods[d] = [];
    for (const p of periods) if (typeof p.open?.day === 'number') dayPeriods[p.open.day].push(p);
    const fmt = t => {
      if (!t || t.length !== 4) return '?';
      const h = parseInt(t.slice(0, 2), 10);
      const m = t.slice(2);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = ((h + 11) % 12) + 1;
      return `${h12}:${m} ${ampm}`;
    };
    for (let d = 0; d < 7; d++) {
      const ps = dayPeriods[d];
      if (!ps.length) weekly_hours[DAY_NAMES[d]] = 'Closed';
      else weekly_hours[DAY_NAMES[d]] = ps.map(p => `${fmt(p.open?.time)} – ${fmt(p.close?.time)}`).join(', ');
    }
  } else {
    return null;
  }

  const closed_days = DAY_NAMES.filter(d => /^closed$/i.test(weekly_hours[d] || ''));
  return { weekly_hours, closed_days, always_open: false };
}

async function fetchHours(placeId, timeout = 12000) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=opening_hours&key=${KEY}`;
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeout);
  try {
    const res = await fetch(url, { signal: c.signal });
    if (!res.ok) return { status: `HTTP_${res.status}` };
    const data = await res.json();
    if (data.status !== 'OK') return { status: data.status, error: data.error_message };
    return { status: 'OK', opening_hours: data.result?.opening_hours };
  } catch (e) { return { status: e.name === 'AbortError' ? 'TIMEOUT' : 'FETCH_ERROR', error: e.message }; }
  finally { clearTimeout(t); }
}

async function pLimit(concurrency, items, worker) {
  const results = new Array(items.length);
  let i = 0;
  async function runOne() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, runOne));
  return results;
}

(async () => {
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'));
  const entries = Object.entries(master);

  // Targets: have place_id, and (no existing closed_days OR --force)
  const targets = entries.filter(([_, r]) => {
    if (!r.place_id) return false;
    if (FORCE) return true;
    return !Array.isArray(r.closed_days);
  });

  const slice = LIMIT > 0 ? targets.slice(0, LIMIT) : targets;
  console.error(`Restaurants in master: ${entries.length}`);
  console.error(`Have place_id:         ${entries.filter(([_,r]) => r.place_id).length}`);
  console.error(`Targets:               ${targets.length}${FORCE ? ' (--force)' : ''}`);
  console.error(`Processing now:        ${slice.length}${LIMIT > 0 ? ` (--limit=${LIMIT})` : ''}`);
  console.error(`Concurrency:           ${CONCURRENCY}`);
  console.error(`Estimated cost:        ~$${(slice.length * 0.003).toFixed(2)} (Place Details @ $3/1000)`);
  console.error('');

  if (!slice.length) { console.error('Nothing to do.'); return; }

  const summary = {
    parsed_ok: 0,
    found_always_open: 0,
    no_hours_data: 0,
    api_errors: 0,
    by_error: {},
    items: [],
  };
  const t0 = Date.now();
  let done = 0;

  await pLimit(CONCURRENCY, slice, async ([name, r]) => {
    const result = await fetchHours(r.place_id);
    done++;
    if (done % 100 === 0 || done === slice.length) {
      const rate = done / ((Date.now() - t0) / 1000);
      const eta = Math.round((slice.length - done) / rate);
      console.error(`  ${done}/${slice.length}  (${rate.toFixed(1)}/s, eta ${eta}s)`);
    }
    if (result.status !== 'OK') {
      summary.api_errors++;
      summary.by_error[result.status] = (summary.by_error[result.status] || 0) + 1;
      summary.items.push({ name, place_id: r.place_id, status: result.status, error: result.error });
      return;
    }
    const parsed = parseHours(result.opening_hours);
    if (!parsed) {
      summary.no_hours_data++;
      summary.items.push({ name, place_id: r.place_id, status: 'NO_HOURS' });
      return;
    }
    summary.parsed_ok++;
    if (parsed.always_open) summary.found_always_open++;
    summary.items.push({
      name, place_id: r.place_id, status: 'OK',
      weekly_hours: parsed.weekly_hours,
      closed_days: parsed.closed_days,
      always_open: parsed.always_open,
    });
  });

  // Stats
  console.error('');
  // Derive: how many had at least one fully-closed day vs open every day
  const closedAtLeastOneDay = summary.items.filter(x => x.status === 'OK' && x.closed_days?.length > 0).length;
  console.error('Results:');
  console.error(`  hours parsed:       ${summary.parsed_ok}`);
  console.error(`    closed ≥1 day:    ${closedAtLeastOneDay}`);
  console.error(`    always open 24/7: ${summary.found_always_open}`);
  console.error(`  no hours data:      ${summary.no_hours_data}`);
  console.error(`  api errors:         ${summary.api_errors}`);
  if (summary.api_errors) {
    for (const [code, n] of Object.entries(summary.by_error)) console.error(`    ${code}: ${n}`);
  }

  // Sample log
  const lines = [];
  const found = summary.items.filter(x => x.status === 'OK');
  const closedSomeday = found.filter(x => x.closed_days && x.closed_days.length > 0);
  const errored = summary.items.filter(x => x.status !== 'OK' && x.status !== 'NO_HOURS');

  lines.push(`# Hours backfill — ${new Date().toISOString()}`);
  lines.push(`# Processed: ${slice.length}, with closed_days: ${closedSomeday.length}, errors: ${errored.length}`);
  lines.push('');
  lines.push('# --- Full week sample (first 12 with hours) ---');
  for (const x of found.slice(0, 12)) {
    lines.push(`\n  ${x.name}`);
    if (x.always_open) { lines.push('    open 24/7'); continue; }
    for (const d of DAY_NAMES) lines.push(`    ${d.padEnd(10)} ${x.weekly_hours[d] || '?'}`);
    if (x.closed_days.length) lines.push(`    closed_days: [${x.closed_days.join(', ')}]`);
  }
  if (errored.length) {
    lines.push('');
    lines.push('# --- Sample errors ---');
    for (const x of errored.slice(0, 20)) lines.push(`  ${x.name}  [${x.status}] ${x.error || ''}`);
  }
  fs.writeFileSync(LOG_PATH, lines.join('\n') + '\n');
  console.error(`\nSample log: ${path.relative(ROOT, LOG_PATH)}`);

  if (!APPLY) {
    console.error('\nDRY RUN — pass --apply to write closed_days into BOOKING_MASTER.json');
    return;
  }

  // Apply
  let written = 0;
  for (const x of summary.items) {
    if (x.status !== 'OK') continue;
    const r = master[x.name];
    if (!r) continue;
    r.closed_days = x.closed_days;
    r.weekly_hours = x.weekly_hours;
    written++;
  }
  fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2));
  console.error(`Wrote closed_days + weekly_hours to ${written} restaurants.`);
  console.error(`Updated ${path.relative(ROOT, MASTER_PATH)}`);
})();
