/**
 * resy-future-cleanup.js — Gentle API pass to recheck locked Resy restaurants for future dates
 * 5-8s delays. Only checks future dates (+3/+7/+14) for restaurants marked fully_locked.
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'tonight_availability.json');
const BOOKING_FILE = path.join(__dirname, 'booking_lookup.json');

const API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const AUTH_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzg4OTg1MTMsInVpZCI6NjQ2NDA0MzcsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTMyNTg0MDZ9fQ.AOMbosBxAd5CvHh8g-YD8NfkXQahDSrZ0asmRrU1CaOb5muBMcw44ujG_W1LWRbiw285t1Kv3BaFyjj2xQ-n-HGbAX1GTaB-pd6wSoNvTdT5so9pAeAIsoRDrbrPQEPx_qqZtDVlkJokmDFEsZc_TlwKTnQlIlsHWAIrnE7v4hfn8n5s';

const HEADERS = {
  'Authorization': `ResyAPI api_key="${API_KEY}"`,
  'X-Resy-Auth-Token': AUTH_TOKEN,
  'X-Resy-Universal-Auth': AUTH_TOKEN,
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Origin': 'https://resy.com',
  'Referer': 'https://resy.com/',
  'Accept': 'application/json, text/plain, */*',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
function gentleDelay() { return 15000 + Math.floor(Math.random() * 5000); } // 15-20s

function extractResySlug(url) {
  if (!url) return null;
  const m1 = url.match(/resy\.com\/cities\/[a-z-]+\/([a-z0-9_-]+)\/?$/i);
  if (m1) return m1[1].toLowerCase();
  const m2 = url.match(/venues\/([a-z0-9_-]+)\/?$/i);
  if (m2) return m2[1].toLowerCase();
  return null;
}

// Cache venue IDs to avoid double lookups
const venueCache = {};

async function getVenueId(slug) {
  if (venueCache[slug]) return venueCache[slug];
  try {
    const resp = await fetch(`https://api.resy.com/3/venue?url_slug=${slug}&location=ny`, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    const id = data?.id?.resy;
    if (id) venueCache[slug] = id;
    return id;
  } catch { return null; }
}

async function checkDate(venueId, date) {
  try {
    const resp = await fetch(`https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${date}&party_size=2&venue_id=${venueId}`, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    const slots = data?.results?.venues?.[0]?.slots || [];
    const dinnerSlots = slots.filter(s => {
      const t = s.date?.start || '';
      const hm = t.match(/(\d{2}):(\d{2})/);
      return hm && parseInt(hm[1]) >= 17;
    }).length;
    return dinnerSlots;
  } catch { return null; }
}

(async () => {
  const bl = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));
  const output = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));

  // Find locked resy restaurants
  const locked = [];
  for (const [k, v] of Object.entries(output)) {
    if (k.startsWith('_')) continue;
    if (!v.fully_locked) continue;
    const info = bl[k];
    if (!info || info.platform !== 'resy') continue;
    const slug = extractResySlug(info.url);
    if (slug) locked.push({ name: k, slug });
  }

  console.log(`🔮 Resy future cleanup — ${locked.length} locked restaurants to recheck`);
  console.log(`   Delays: 5-8s | Dates: +3, +7, +14 days\n`);

  const OFFSETS = [3, 7, 14];
  let unlocked = 0, stillLocked = 0, apiFail = 0;

  for (let i = 0; i < locked.length; i++) {
    const r = locked[i];
    const venueId = await getVenueId(r.slug);

    if (!venueId) {
      console.log(`  ❌ [${i+1}/${locked.length}] ${r.name}: venue lookup failed`);
      apiFail++;
      await sleep(gentleDelay());
      continue;
    }

    let opensIn = null;
    for (const offset of OFFSETS) {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + offset);
      const date = futureDate.toISOString().split('T')[0];

      const dinnerSlots = await checkDate(venueId, date);
      if (dinnerSlots === null) { apiFail++; break; }
      if (dinnerSlots > 0) { opensIn = offset; break; }
      await sleep(2000); // small delay between date checks
    }

    if (opensIn) {
      delete output[r.name].fully_locked;
      output[r.name].opens_in = opensIn;
      unlocked++;
      console.log(`  🟢 [${i+1}/${locked.length}] ${r.name}: opens in +${opensIn}d`);
    } else {
      stillLocked++;
      console.log(`  🔒 [${i+1}/${locked.length}] ${r.name}: still locked`);
    }

    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
      console.log(`    💾 Saved (${unlocked} unlocked so far)`);
    }
    await sleep(gentleDelay());
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n✅ Done: ${unlocked} unlocked, ${stillLocked} still locked, ${apiFail} API failures`);
})();
