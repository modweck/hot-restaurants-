/**
 * concierge-scheduler.js — Step 1: Read pending requests, calculate when each should fire
 *
 * NO SNIPING YET. Just prints the schedule so we can verify the timing math.
 *
 * RUN: node scripts/concierge-scheduler.js
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://zdsolubfxzvrqiqvwjev.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpkc29sdWJmeHp2cnFpcXZ3amV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMzMwODksImV4cCI6MjA5MDcwOTA4OX0.XOuZOh4yaYGf1bUJpIDl48F0MV-kjct-_nWtgs6MJPM';

// Load restaurant drop windows from shared config file
const CONFIG_FILE = path.join(__dirname, '..', 'data', 'concierge-restaurants.json');
const _config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const RESTAURANTS = {};
for (const r of _config.restaurants) RESTAURANTS[r.name] = r;

// Time pref → target hour (24h)
const TIME_PREF_HOUR = { early: 17, prime: 22, late: 22, any: 22 };

function calculateFireTime(targetDateStr, drop_days, drop_hour) {
  // Fire time = target date minus drop_days days, at drop_hour:00 local time
  const target = new Date(targetDateStr + 'T00:00:00');
  const fireTime = new Date(target);
  fireTime.setDate(fireTime.getDate() - drop_days);
  fireTime.setHours(drop_hour, 0, 0, 0);
  return fireTime;
}

async function main() {
  // Fetch all pending booking requests
  const resp = await fetch(SUPABASE_URL + '/rest/v1/booking_requests?status=eq.pending&order=created_at.desc&limit=100', {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  });
  const requests = await resp.json();

  if (!requests.length) {
    console.log('No pending requests.');
    return;
  }

  console.log(`Found ${requests.length} pending request(s):\n`);

  const now = new Date();
  for (const r of requests) {
    const cfg = RESTAURANTS[r.restaurant];
    if (!cfg) {
      console.log(`❌ ${r.id} → ${r.restaurant}: NO drop config for this restaurant`);
      continue;
    }

    const targetHour = TIME_PREF_HOUR[r.time_pref] ?? TIME_PREF_HOUR.any;
    const dates = r.target_dates || [];

    console.log(`📋 ${r.id} → ${r.restaurant} (party of ${r.party_size}, target ${targetHour}:00)`);
    console.log(`   Customer: ${r.name} <${r.contact}>`);
    console.log(`   Token: ${r.resy_token ? r.resy_token.slice(0, 30) + '...' : 'MISSING'}`);
    console.log(`   Drop config: ${cfg.drop_days} days out at ${cfg.drop_hour}:00`);

    if (!dates.length) {
      console.log(`   ⚠️  No target_dates`);
      continue;
    }

    for (let i = 0; i < dates.length; i++) {
      const fireTime = calculateFireTime(dates[i], cfg.drop_days, cfg.drop_hour);
      const status = fireTime < now ? '⌛ PAST' : '⏰ UPCOMING';
      const minsAway = Math.round((fireTime - now) / 60000);
      console.log(`   ${status} Date #${i + 1} (${dates[i]}) → fire at ${fireTime.toLocaleString()} (${minsAway >= 0 ? minsAway + ' min away' : Math.abs(minsAway) + ' min ago'})`);
    }
    console.log();
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
