/**
 * snapshot-4charles-party4.js — Test if 4 Charles publicly drops party-of-4 slots at 9am
 * Fires at 9am, captures whatever appears for the date 20 days out.
 * Anonymous (API key only), tight burst.
 */

const HEADERS = {
  'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Origin': 'https://resy.com', 'Referer': 'https://resy.com/',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
function log(m) { const d = new Date(); console.log('[' + d.toLocaleTimeString('en-US',{hour12:false}) + '.' + String(d.getMilliseconds()).padStart(3,'0') + ']', m); }

// 4 Charles = 20 days out; figure tomorrow's drop date
const today = new Date();
today.setDate(today.getDate() + 20);
const TARGET_DATE = today.toISOString().split('T')[0];

async function check(label) {
  const t0 = Date.now();
  try {
    const r = await fetch(`https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${TARGET_DATE}&party_size=4&venue_id=834`, { headers: HEADERS });
    const status = r.status;
    let body = '';
    try { body = await r.text(); } catch {}
    let d = {};
    try { d = JSON.parse(body); } catch {
      return { label, status, slots: 0, times: [], ms: Date.now() - t0, err: 'non-JSON body: ' + body.slice(0, 80) };
    }
    const slots = d?.results?.venues?.[0]?.slots || [];
    return { label, status, slots: slots.length, times: slots.map(s => (s.date?.start||'').match(/\d{2}:\d{2}/)?.[0]).filter(Boolean), ms: Date.now() - t0 };
  } catch (e) {
    return { label, status: 'ERR', slots: 0, times: [], ms: Date.now() - t0, err: e.message };
  }
}

(async () => {
  log('4 CHARLES SNAPSHOT — date ' + TARGET_DATE + ', party 4 (API key only)');
  const drop = new Date(); drop.setHours(9, 0, 0, 0);
  if (drop <= new Date()) drop.setDate(drop.getDate() + 1);
  log('Waiting until 9:00:00 (' + drop.toLocaleString() + ')...');
  while (Date.now() < drop.getTime() - 50) {
    const rem = drop.getTime() - Date.now();
    if (rem > 60000) await sleep(15000);
    else if (rem > 5000) await sleep(1000);
    else await sleep(20);
  }
  while (Date.now() < drop.getTime()) {}

  log('🔥 FIRING 5 PARALLEL requests NOW');
  const results = await Promise.all([check('R1'), check('R2'), check('R3'), check('R4'), check('R5')]);
  for (const r of results) {
    if (r.err) log('⚠️  ' + r.label + ': HTTP ' + r.status + ' — ' + r.err);
    else if (r.slots > 0) log('🟢 ' + r.label + ': ' + r.slots + ' SLOTS (' + r.ms + 'ms): ' + r.times.join(', '));
    else log('⚫ ' + r.label + ': 0 slots (HTTP ' + r.status + ', ' + r.ms + 'ms)');
  }

  log('First-burst complete. Sleeping 2s, then 3 follow-up polls to catch late drops...');
  for (let i = 0; i < 3; i++) {
    await sleep(2000);
    const r = await check('Follow-up ' + (i+1));
    if (r.err) log('⚠️  ' + r.label + ': ' + r.err);
    else if (r.slots > 0) log('🟢 ' + r.label + ': ' + r.slots + ' SLOTS: ' + r.times.join(', '));
    else log('⚫ ' + r.label + ': 0 slots');
  }
  log('Snapshot done.');
})();
