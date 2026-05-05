const fs = require('fs');
const path = require('path');
const LOG_DIR = path.join(__dirname, 'data', 'drop-monitor');
const LOG_FILE = path.join(LOG_DIR, 'rezdora-midnight.log');
const DATA_FILE = path.join(LOG_DIR, 'rezdora-midnight.json');
const API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3ODE4NzcwMDEsInVpZCI6NjQ3MzQ1NTgsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTM1MTEzMDV9fQ.AOlKh4ANqfmn4d15NBxgPMa6jLS7lgXTJ_9e-3uRMkUUl_SZi_5nI6bA4qBvXO-FgM8HMJXEYokbe0cP9lAim5LSAbxkhpiKzC1JpPV4PCUTJ7TKc2BuAyFdLxOHh7BvGLjprkYkeyQYCqxmCK6m0DIEG5ueF4l6CyzVbjMvlmu584lY';

function log(msg) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false }) + '.' + String(new Date().getMilliseconds()).padStart(3, '0');
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function getHeaders() {
  return {
    'Authorization': `ResyAPI api_key="${API_KEY}"`,
    'X-Resy-Auth-Token': TOKEN,
    'X-Resy-Universal-Auth': TOKEN,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Origin': 'https://resy.com',
    'Referer': 'https://resy.com/',
    'Accept': 'application/json, text/plain, */*',
  };
}

async function main() {
  log('REZDORA MIDNIGHT MONITOR — checking Apr 18');
  
  // Wait until midnight
  const now = new Date();
  const drop = new Date(now);
  drop.setHours(0, 0, 0, 0);
  drop.setDate(drop.getDate() + 1); // tomorrow midnight
  log(`Waiting ${Math.round((drop - now) / 60000)} minutes until midnight...`);
  
  while (Date.now() < drop.getTime() - 5000) {
    const rem = drop.getTime() - Date.now();
    if (rem > 60000) { log(`   ${Math.round(rem / 60000)} min...`); await new Promise(r => setTimeout(r, 30000)); }
    else { log(`   ${Math.round(rem / 1000)}s...`); await new Promise(r => setTimeout(r, 5000)); }
  }
  while (Date.now() < drop.getTime() - 500) await new Promise(r => setTimeout(r, 100));
  
  log('DROP TIME — firing now!');
  
  const t0 = Date.now();
  try {
    const resp = await fetch('https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=2026-04-18&party_size=2&venue_id=5771', { headers: getHeaders(), signal: AbortSignal.timeout(5000) });
    if (!resp.ok) { log('ERROR: HTTP ' + resp.status); return; }
    const data = await resp.json();
    if (data?.error) { log('API ERROR: ' + data.error.message); return; }
    const slots = data?.results?.venues?.[0]?.slots || [];
    const times = slots.map(s => (s.date?.start || '').match(/(\d{2}:\d{2})/)?.[1]).filter(Boolean);
    if (slots.length > 0) {
      log('🟢 Rezdora → 2026-04-18: ' + slots.length + ' slots! (' + (Date.now() - t0) + 'ms)');
      log('   TIMES: ' + times.join(', '));
    } else {
      log('⚫ Rezdora → 2026-04-18: 0 slots (' + (Date.now() - t0) + 'ms)');
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify({ name: 'Rezdora', date: '2026-04-18', slots: slots.length, times, checked_at: new Date().toISOString() }, null, 2));
    log('Saved → ' + DATA_FILE);
  } catch (e) {
    log('FATAL: ' + e.message);
  }
}

main();
