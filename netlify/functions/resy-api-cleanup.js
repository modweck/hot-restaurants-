/**
 * resy-api-cleanup.js — Quick API pass to recheck locked + unchecked Resy restaurants
 * Uses API only (no Puppeteer). Checks today + future dates for locked ones.
 * ONE-TIME SCRIPT.
 */

const fs = require('fs');
const path = require('path');

const TODAY = new Date().toISOString().split('T')[0];
const PARTY_SIZE = 2;
const OUTPUT_FILE = path.join(__dirname, 'tonight_availability.json');
const BOOKING_FILE = path.join(__dirname, 'booking_lookup.json');

const API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const AUTH_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3ODE4NzcwMDEsInVpZCI6NjQ3MzQ1NTgsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTM1MTEzMDV9fQ.AOlKh4ANqfmn4d15NBxgPMa6jLS7lgXTJ_9e-3uRMkUUl_SZi_5nI6bA4qBvXO-FgM8HMJXEYokbe0cP9lAim5LSAbxkhpiKzC1JpPV4PCUTJ7TKc2BuAyFdLxOHh7BvGLjprkYkeyQYCqxmCK6m0DIEG5ueF4l6CyzVbjMvlmu584lY';

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

function slotToHour(timeStr) {
  if (!timeStr) return null;
  const iso = timeStr.match(/\d{4}-\d{2}-\d{2}\s+(\d{1,2}):(\d{2})/);
  if (iso) return parseInt(iso[1]) + parseInt(iso[2]) / 60;
  const ampm = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    if (/pm/i.test(ampm[3]) && h !== 12) h += 12;
    if (/am/i.test(ampm[3]) && h === 12) h = 0;
    return h + parseInt(ampm[2]) / 60;
  }
  return null;
}

async function checkVenue(slug, date, partySize) {
  try {
    const venueResp = await fetch(`https://api.resy.com/3/venue?url_slug=${slug}&location=ny`, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!venueResp.ok) return null;
    const venueData = await venueResp.json();
    const venueId = venueData?.id?.resy;
    if (!venueId) return null;

    const resp = await fetch(`https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${date}&party_size=${partySize}&venue_id=${venueId}`, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.results?.venues?.[0]?.slots || [];
  } catch { return null; }
}

(async () => {
  const bl = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));
  const output = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));

  // Find restaurants to recheck
  const toCheck = [];
  for (const [k, info] of Object.entries(bl)) {
    if (info.platform !== 'resy' || !info.url) continue;
    const slug = extractResySlug(info.url);
    if (!slug) continue;
    const entry = output[k];
    const needsCheck = !entry || entry._checked_date !== TODAY || entry.fully_locked || !entry._checked_date;
    if (needsCheck) toCheck.push({ name: k, slug });
  }

  console.log(`🔄 Resy API cleanup — ${toCheck.length} restaurants to recheck\n`);

  let success = 0, fail = 0, updated = 0;

  for (let i = 0; i < toCheck.length; i++) {
    const r = toCheck[i];
    const slots = await checkVenue(r.slug, TODAY, PARTY_SIZE);

    if (slots !== null) {
      const dinnerSlots = slots.filter(s => { const h = slotToHour(s.date?.start); return h !== null && h >= 17 && h < 23; }).length;
      const primeSlots = slots.filter(s => { const h = slotToHour(s.date?.start); return h !== null && h >= 18.5 && h < 20.5; }).length;

      let tier;
      if (slots.length === 0) tier = 'booked';
      else if (primeSlots === 0 && dinnerSlots <= 1) tier = 'limited';
      else if (primeSlots <= 1 && dinnerSlots <= 3) tier = 'limited';
      else tier = 'open';

      function ws(count) { return count <= 1 ? 'booked' : count <= 3 ? 'limited' : 'available'; }
      const earlySlots = slots.filter(s => { const h = slotToHour(s.date?.start); return h !== null && h >= 17 && h < 18.5; }).length;
      const lateSlots = slots.filter(s => { const h = slotToHour(s.date?.start); return h !== null && h >= 20.5 && h < 24; }).length;

      const prev = output[r.name] || {};
      output[r.name] = {
        tier, dinner_slots: dinnerSlots,
        early: tier === 'booked' ? 'booked' : ws(earlySlots),
        prime: tier === 'booked' ? 'booked' : ws(primeSlots),
        late: tier === 'booked' ? 'booked' : ws(lateSlots),
        _checked_date: TODAY,
      };

      // Check future dates if booked
      if (tier === 'booked') {
        let opensIn = null;
        for (const offset of [3, 7, 14]) {
          const futureDate = new Date();
          futureDate.setDate(futureDate.getDate() + offset);
          const date = futureDate.toISOString().split('T')[0];
          const futureSlots = await checkVenue(r.slug, date, PARTY_SIZE);
          if (futureSlots && futureSlots.length > 0) {
            const futureDinner = futureSlots.filter(s => { const h = slotToHour(s.date?.start); return h !== null && h >= 17; }).length;
            if (futureDinner > 0) { opensIn = offset; break; }
          }
          await sleep(500);
        }
        if (opensIn) output[r.name].opens_in = opensIn;
        else output[r.name].fully_locked = true;
      }

      const prevTier = prev.tier || 'none';
      const changed = prevTier !== tier || (prev.fully_locked && output[r.name].opens_in);
      if (changed) updated++;

      const icon = tier === 'open' ? '🟢' : tier === 'limited' ? '🟠' : '⚫';
      const future = output[r.name].opens_in ? ` → opens +${output[r.name].opens_in}d` : output[r.name].fully_locked ? ' → locked' : '';
      const change = changed ? ` (was ${prevTier})` : '';
      console.log(`  ${icon} [${i+1}/${toCheck.length}] ${r.name}: ${tier} (${dinnerSlots} slots)${future}${change}`);
      success++;
    } else {
      console.log(`  ❌ [${i+1}/${toCheck.length}] ${r.name}: API failed`);
      fail++;
    }

    if ((i + 1) % 50 === 0) fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    await sleep(3000 + Math.floor(Math.random() * 2000));
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n✅ Done: ${success} success, ${fail} failed, ${updated} updated`);
})();
