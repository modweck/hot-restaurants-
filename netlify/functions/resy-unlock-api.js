/**
 * resy-unlock-api.js — API-only recheck of locked Resy restaurants for future dates
 * No Puppeteer. Cached venue IDs where possible. Gentle spacing.
 *
 * RUN: node netlify/functions/resy-unlock-api.js
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

function extractResySlug(url) {
  if (!url) return null;
  const m1 = url.match(/resy\.com\/cities\/[a-z-]+\/([a-z0-9_-]+)\/?$/i);
  if (m1) return m1[1].toLowerCase();
  const m2 = url.match(/venues\/([a-z0-9_-]+)\/?$/i);
  if (m2) return m2[1].toLowerCase();
  return null;
}

// Venue ID cache
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

async function checkFutureDate(venueId, slug, date) {
  try {
    let resp;
    if (venueId) {
      resp = await fetch(`https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${date}&party_size=2&venue_id=${venueId}`, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    } else {
      resp = await fetch('https://api.resy.com/4/find', {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json', 'X-Origin': 'https://resy.com' },
        body: JSON.stringify({ lat: 0, long: 0, day: date, party_size: 2, slug: slug, location: 'ny' }),
        signal: AbortSignal.timeout(10000)
      });
    }
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

  // Build list of locked resy restaurants
  const locked = [];
  for (const [k, v] of Object.entries(output)) {
    if (k.startsWith('_')) continue;
    if (!v.fully_locked) continue;
    const info = bl[k];
    if (!info || info.platform !== 'resy') continue;
    const slug = extractResySlug(info.url);
    if (!slug) continue;
    const cachedVid = info.venue_id || v.venue_id || null;
    locked.push({ name: k, slug, cachedVid });
  }

  // Pre-load venue cache
  let preloaded = 0;
  for (const r of locked) {
    if (r.cachedVid) { venueCache[r.slug] = r.cachedVid; preloaded++; }
  }

  console.log(`🔓 Resy unlock — ${locked.length} locked restaurants`);
  console.log(`   Cached venue IDs: ${preloaded} | Need lookup: ${locked.length - preloaded}`);
  console.log(`   Dates: +3, +7 | Spacing: 5s between dates, 10s between restaurants`);
  console.log(`   API only, no Puppeteer\n`);

  const OFFSETS = [3, 7];
  let unlocked = 0, stillLocked = 0, apiFail = 0;
  let consecutiveFails = 0;

  for (let i = 0; i < locked.length; i++) {
    const r = locked[i];

    // Use cached venue ID if available, otherwise POST with slug
    let venueId = venueCache[r.slug] || null;

    // Check future dates
    let opensIn = null;
    for (const offset of OFFSETS) {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + offset);
      const date = futureDate.toISOString().split('T')[0];

      const dinnerSlots = await checkFutureDate(venueId, r.slug, date);
      if (dinnerSlots === null) {
        apiFail++;
        consecutiveFails++;
        if (consecutiveFails >= 5) {
          console.log(`     ⏸️ ${consecutiveFails} consecutive fails — backing off 30s`);
          await sleep(30000);
          consecutiveFails = 0;
        }
        break;
      }
      consecutiveFails = 0;
      if (dinnerSlots > 0) { opensIn = offset; break; }
      await sleep(5000); // 5s between date checks
    }

    if (opensIn) {
      delete output[r.name].fully_locked;
      output[r.name].opens_in = opensIn;
      unlocked++;
      console.log(`  🟢 [${i+1}/${locked.length}] ${r.name}: opens in +${opensIn}d`);
    } else if (consecutiveFails === 0) {
      stillLocked++;
      console.log(`  🔒 [${i+1}/${locked.length}] ${r.name}: still locked`);
    }

    // Save every 25
    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
      console.log(`    💾 Saved (${unlocked} unlocked, ${stillLocked} locked, ${apiFail} failed)`);
    }

    await sleep(10000); // 10s between restaurants
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n✅ Done: ${unlocked} unlocked, ${stillLocked} still locked, ${apiFail} API failures`);
})();
