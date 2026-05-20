/**
 * snapshot-4charles-v2.js — Better 4 Charles drop snapshot
 *
 * Fixes from v1:
 * - Calculates target date AT fire time (not script start) so it's always "today + 20"
 * - Polls BOTH party-of-2 and party-of-4 to see if either releases
 * - Sequential polls every 200ms for 5 seconds to catch slots that disappear fast
 * - Uses API key only (no user token, no soft-block on account)
 */

const HEADERS = {
  'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Origin': 'https://resy.com', 'Referer': 'https://resy.com/',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
function log(m) { const d = new Date(); console.log('[' + d.toLocaleTimeString('en-US',{hour12:false}) + '.' + String(d.getMilliseconds()).padStart(3,'0') + ']', m); }

async function check(party, date) {
  const t0 = Date.now();
  try {
    const r = await fetch(`https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${date}&party_size=${party}&venue_id=834`, { headers: HEADERS });
    const status = r.status;
    const body = await r.text();
    let d = {};
    try { d = JSON.parse(body); } catch {
      return { party, status, slots: 0, times: [], ms: Date.now() - t0, err: 'non-JSON: ' + body.slice(0, 80) };
    }
    const slots = d?.results?.venues?.[0]?.slots || [];
    return { party, status, slots: slots.length, times: slots.map(s => (s.date?.start||'').match(/\d{2}:\d{2}/)?.[0]).filter(Boolean), ms: Date.now() - t0 };
  } catch (e) {
    return { party, status: 'ERR', slots: 0, times: [], ms: Date.now() - t0, err: e.message };
  }
}

(async () => {
  log('4 CHARLES SNAPSHOT v2 — party 2 + party 4 (parallel for 5 sec)');
  const drop = new Date(); drop.setHours(9, 0, 0, 0);
  if (drop <= new Date()) drop.setDate(drop.getDate() + 1);

  log('Waiting until ' + drop.toLocaleString() + '...');
  while (Date.now() < drop.getTime() - 50) {
    const rem = drop.getTime() - Date.now();
    if (rem > 60000) await sleep(15000);
    else if (rem > 5000) await sleep(1000);
    else await sleep(20);
  }
  while (Date.now() < drop.getTime()) {}

  // Calculate target date NOW (today + 20 days = drop date for 4 Charles)
  const target = new Date(drop);
  target.setDate(target.getDate() + 20);
  const TARGET_DATE = target.toISOString().split('T')[0];
  log(`🔥 DROP TIME — targeting ${TARGET_DATE}`);

  // Poll in tight loop for 5 sec, parties 2 and 4 in parallel
  let p2Found = false, p4Found = false;
  for (let i = 0; i < 15; i++) {
    if (p2Found && p4Found) break;
    const calls = [];
    if (!p2Found) calls.push(check(2, TARGET_DATE));
    if (!p4Found) calls.push(check(4, TARGET_DATE));
    const results = await Promise.all(calls);
    for (const r of results) {
      const elapsed = Date.now() - drop.getTime();
      if (r.err) {
        log(`⚠️ poll ${i+1} party=${r.party}: ${r.err} (${r.ms}ms, +${elapsed}ms)`);
      } else if (r.slots > 0) {
        log(`🟢 poll ${i+1} party=${r.party}: ${r.slots} SLOTS — ${r.times.join(', ')} (+${elapsed}ms from drop)`);
        if (r.party === 2) p2Found = true;
        if (r.party === 4) p4Found = true;
      } else {
        log(`⚫ poll ${i+1} party=${r.party}: 0 slots (HTTP ${r.status}, ${r.ms}ms, +${elapsed}ms)`);
      }
    }
    if (i < 14) await sleep(200);
  }
  log('Snapshot done.');
})();
