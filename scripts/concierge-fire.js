/**
 * concierge-fire.js — Fire a sniper for one Supabase booking request.
 *
 * Reads the request from Supabase, looks up restaurant config, spawns sniper-generic.js
 * with the right env vars.
 *
 * USAGE:
 *   node scripts/concierge-fire.js <request_id> <date_index> [--dry-run]
 *     request_id  — Supabase booking_requests.id
 *     date_index  — 0 / 1 / 2 (which of the 3 target_dates to try)
 *     --dry-run   — log what would happen, don't actually run the sniper
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

// Special restaurants: customer's "early"/"late" maps to extreme times
const SPECIAL_SLUGS = new Set(['monkey-bar-nyc', 'torrisi']);

// Returns { target_hour, direction } based on venue + customer's time preference.
// direction: 'up' = only target hour or later, 'down' = only target or earlier, 'closest' = any 5pm+ closest match.
function pickTarget(slug, time_pref) {
  const pref = time_pref || 'any';
  if (SPECIAL_SLUGS.has(slug)) {
    if (pref === 'early') return { target_hour: 17, direction: 'up' };    // 5pm and later
    if (pref === 'late')  return { target_hour: 22, direction: 'down' };  // 10pm and earlier
    return { target_hour: 19, direction: 'closest' };
  }
  // Other restaurants: target prime (7pm), fall back in user's chosen direction
  if (pref === 'early') return { target_hour: 19, direction: 'down' };
  if (pref === 'late')  return { target_hour: 19, direction: 'up' };
  return { target_hour: 19, direction: 'closest' };
}

async function main() {
  const args = process.argv.slice(2);
  const requestId = args[0];
  const dateIndex = parseInt(args[1] || '0', 10);
  const dryRun = args.includes('--dry-run');

  if (!requestId) {
    console.error('Usage: node scripts/concierge-fire.js <request_id> <date_index> [--dry-run]');
    process.exit(1);
  }

  // Fetch the request
  const resp = await fetch(SUPABASE_URL + `/rest/v1/booking_requests?id=eq.${requestId}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  });
  const list = await resp.json();
  if (!list.length) { console.error(`Request ${requestId} not found`); process.exit(1); }
  const r = list[0];

  // Look up restaurant config
  const cfg = RESTAURANTS[r.restaurant];
  if (!cfg) { console.error(`No drop config for ${r.restaurant}`); process.exit(1); }

  const targetDate = (r.target_dates || [])[dateIndex];
  if (!targetDate) { console.error(`No target_dates[${dateIndex}]`); process.exit(1); }

  const { target_hour: targetHour, direction: targetDirection } = pickTarget(cfg.slug, r.time_pref);

  // Load CAPTCHA_KEY from .env if not in process.env
  if (!process.env.CAPTCHA_KEY) {
    try {
      const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
      const m = envFile.match(/CAPTCHA_KEY=(\S+)/);
      if (m) process.env.CAPTCHA_KEY = m[1];
    } catch {}
  }

  // Build env for the sniper
  const env = {
    ...process.env,
    REQUEST_ID: r.id,
    VENUE_SLUG: cfg.slug,
    VENUE_ID: String(cfg.venue_id),
    TARGET_DATE: targetDate,
    PARTY_SIZE: String(r.party_size || 2),
    DROP_HOUR: String(cfg.drop_hour),
    DROP_MINUTE: '0',
    TARGET_HOUR: String(targetHour),
    TARGET_MIN: '0',
    TARGET_DIRECTION: targetDirection,
    AUTH_TOKEN: r.resy_token || '',
    PAYMENT_METHOD_ID: String(r.resy_payment_id || ''),
    DRY_RUN: dryRun ? '1' : '0',
  };

  console.log('═══════════════════════════════════════════════════');
  console.log(`Firing sniper for request ${r.id}`);
  console.log(`  Customer: ${r.name} <${r.contact}>`);
  console.log(`  Restaurant: ${r.restaurant} (${cfg.slug}, venue ${cfg.venue_id})`);
  console.log(`  Date: ${targetDate} (index ${dateIndex} of ${(r.target_dates||[]).length})`);
  console.log(`  Party: ${r.party_size}, Target time: ${targetHour}:00 (dir=${targetDirection}), Drop: ${cfg.drop_hour}:00`);
  console.log(`  Token: ${r.resy_token ? r.resy_token.slice(0,30)+'...' : 'MISSING'}`);
  console.log(`  Payment ID: ${r.resy_payment_id || 'MISSING'}`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('═══════════════════════════════════════════════════');

  if (!r.resy_token) { console.error('ERROR: No Resy token in request'); process.exit(1); }
  if (!r.resy_payment_id && !dryRun) { console.error('ERROR: No payment ID — sniper would fail at booking'); process.exit(1); }

  // Spawn the sniper
  const scriptPath = path.join(__dirname, 'sniper-generic.js');
  const child = spawn('node', [scriptPath], { env, stdio: 'inherit' });
  child.on('exit', code => process.exit(code));
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
