/**
 * concierge-tick.js — Runs every ~5 min via launchd. Fires snipers for any pending
 * requests whose drop time is approaching (next 10 min).
 *
 * Logic per request:
 *   - For each target_date in the request:
 *     - Compute drop_time = target_date - drop_days days, at drop_hour
 *     - If drop_time is within the next 10 minutes (and we haven't already fired):
 *         - Launch concierge-fire.js for that date_index in the background
 *         - Mark in Supabase that we fired it (so we don't double-fire)
 *   - If the request is already 'booked', stop firing more dates
 *   - If the request is 'failed' on a date, the next date can still fire on its drop day
 *
 * RUN:    node scripts/concierge-tick.js
 * LOOP:   wired to launchd, fires every 5 minutes
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SUPABASE_URL = 'https://zdsolubfxzvrqiqvwjev.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpkc29sdWJmeHp2cnFpcXZ3amV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMzMwODksImV4cCI6MjA5MDcwOTA4OX0.XOuZOh4yaYGf1bUJpIDl48F0MV-kjct-_nWtgs6MJPM';

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'concierge-restaurants.json');
const _config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const RESTAURANTS = {};
for (const r of _config.restaurants) RESTAURANTS[r.name] = r;

// How early before drop_time we should launch the sniper (gives it time to open Chrome + solve captchas)
const LAUNCH_LEAD_MINUTES = 8;
// How wide a window we consider (so we don't miss drops if tick runs slightly late)
const LAUNCH_WINDOW_MINUTES = 10;

function calculateFireTime(targetDateStr, drop_days, drop_hour) {
  const target = new Date(targetDateStr + 'T00:00:00');
  const fireTime = new Date(target);
  fireTime.setDate(fireTime.getDate() - drop_days);
  fireTime.setHours(drop_hour, 0, 0, 0);
  return fireTime;
}

function logLine(...args) {
  const ts = new Date().toLocaleString();
  console.log(`[${ts}]`, ...args);
}

async function fetchPending() {
  // Status not equal to 'booked' (still actionable)
  const resp = await fetch(SUPABASE_URL + '/rest/v1/booking_requests?status=in.(pending,sniping,failed)&order=created_at.asc&limit=200', {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  });
  return await resp.json();
}

async function markFired(requestId, dateIndex, targetDate) {
  // Track which date_indices we've fired by storing in notes as JSON
  const resp = await fetch(SUPABASE_URL + `/rest/v1/booking_requests?id=eq.${requestId}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  });
  const list = await resp.json();
  if (!list.length) return;
  const r = list[0];

  let fired = [];
  try {
    if (r.notes && r.notes.startsWith('{')) { fired = JSON.parse(r.notes).fired || []; }
  } catch {}
  if (!fired.includes(dateIndex)) fired.push(dateIndex);

  const notes = JSON.stringify({ fired, last_fire: `idx=${dateIndex} date=${targetDate} at=${new Date().toISOString()}` });

  await fetch(SUPABASE_URL + `/rest/v1/booking_requests?id=eq.${requestId}`, {
    method: 'PATCH',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ notes, status: 'sniping', updated_at: new Date().toISOString() })
  });
}

function getFiredIndices(r) {
  try {
    if (r.notes && r.notes.startsWith('{')) return JSON.parse(r.notes).fired || [];
  } catch {}
  return [];
}

async function main() {
  const now = new Date();
  const requests = await fetchPending();
  logLine(`Tick — ${requests.length} pending request(s)`);

  for (const r of requests) {
    const cfg = RESTAURANTS[r.restaurant];
    if (!cfg) continue;
    if (r.status === 'booked') continue;
    if (!r.resy_token) continue;

    const fired = getFiredIndices(r);
    const dates = r.target_dates || [];

    for (let i = 0; i < dates.length; i++) {
      if (fired.includes(i)) continue;

      const fireTime = calculateFireTime(dates[i], cfg.drop_days, cfg.drop_hour);
      const launchAt = new Date(fireTime.getTime() - LAUNCH_LEAD_MINUTES * 60 * 1000);
      const minsUntilLaunch = (launchAt - now) / 60000;

      // Fire if we're in the window: 0 to -LAUNCH_WINDOW_MINUTES (i.e. it's time)
      if (minsUntilLaunch <= 0 && minsUntilLaunch >= -LAUNCH_WINDOW_MINUTES) {
        logLine(`🎯 FIRING: ${r.id} → ${r.restaurant} for ${dates[i]} (drop at ${fireTime.toLocaleString()})`);
        await markFired(r.id, i, dates[i]);

        // Spawn the fire script detached so this tick can finish
        const child = spawn('node', [path.join(__dirname, 'concierge-fire.js'), r.id, String(i)], {
          detached: true,
          stdio: ['ignore', fs.openSync(`/tmp/concierge-${r.id}-${i}.log`, 'a'), fs.openSync(`/tmp/concierge-${r.id}-${i}.log`, 'a')]
        });
        child.unref();
        logLine(`   → spawned PID ${child.pid}, log: /tmp/concierge-${r.id}-${i}.log`);
      } else if (minsUntilLaunch > 0) {
        const hrs = (minsUntilLaunch / 60).toFixed(1);
        logLine(`   ⏳ ${r.restaurant} #${i + 1} (${dates[i]}): drop in ${hrs}h (launch ${launchAt.toLocaleString()})`);
      } else {
        logLine(`   ⏭️  ${r.restaurant} #${i + 1} (${dates[i]}): drop time PASSED (${Math.round(-minsUntilLaunch)} min ago) — not firing`);
      }
    }
  }
}

main().catch(e => { console.error('tick error:', e.message); process.exit(1); });
