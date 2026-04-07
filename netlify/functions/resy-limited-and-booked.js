/**
 * resy-limited-and-booked.js
 *
 * Phase 1: Re-check tonight's availability for limited/booked Resy restaurants
 *          (some may have opened up since last check)
 * Phase 2: Check future availability (+3/+7/+14 days) for still-booked ones
 *
 * Reads from tonight_availability.json, writes back into it.
 *
 * RUN:   node netlify/functions/resy-limited-and-booked.js
 *
 * OPTIONS:
 *   --party 2            Party size (default: 2)
 *   --quick              Only check first 20
 *   --all                Re-check even ones already checked
 */

const fs = require('fs');
const path = require('path');

const fetch = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args);
  try { return require('node-fetch')(...args); }
  catch (e) { throw new Error('fetch not available. Use Node 18+ or add node-fetch.'); }
};

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}
const QUICK_MODE = args.includes('--quick');
const CHECK_ALL  = args.includes('--all');
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);
const TODAY      = new Date().toISOString().split('T')[0];

// ── Files ─────────────────────────────────────────────────────────────────────
const MASTER_FILE   = path.join(__dirname, 'BOOKING_MASTER.json');
const BOOKING_FILE  = path.join(__dirname, 'booking_lookup.json');
const OUTPUT_FILE   = path.join(__dirname, 'tonight_availability.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Auto-sync booking_lookup from BOOKING_MASTER ─────────────────────────────
try {
  const master = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
  const old = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));
  const synced = {};
  for (const [name, v] of Object.entries(master)) {
    if (!v.platform || !v.url) continue;
    const k = name.toLowerCase();
    synced[k] = { platform: v.platform, url: v.url };
    if (v.lat) synced[k].lat = v.lat;
    if (v.lng) synced[k].lng = v.lng;
    if (v.website) synced[k].website = v.website;
    if (v.venue_id) synced[k].venue_id = v.venue_id;
    if (v.resy_venue_id) synced[k].venue_id = v.resy_venue_id;
    const o = old[name] || old[k];
    if (o) for (const [k2, v2] of Object.entries(o)) if (!(k2 in synced[k])) synced[k][k2] = v2;
  }
  fs.writeFileSync(BOOKING_FILE, JSON.stringify(synced, null, 2));
  console.log(`🔄 booking_lookup synced: ${Object.keys(synced).length} entries`);
} catch (e) { console.log('⚠️ booking_lookup sync skipped:', e.message); }

// ── Resy URL → slug ───────────────────────────────────────────────────────────
function extractResySlug(url) {
  if (!url) return null;
  const m1 = url.match(/resy\.com\/cities\/[a-z-]+\/([a-z0-9_-]+)\/?$/i);
  if (m1) return m1[1].toLowerCase();
  const m2 = url.match(/venues\/([a-z0-9_-]+)\/?$/i);
  if (m2) return m2[1].toLowerCase();
  return null;
}

// ── Time parsing ──────────────────────────────────────────────────────────────
function slotToHour(timeStr) {
  if (!timeStr) return null;
  const iso = timeStr.match(/\d{4}-\d{2}-\d{2}\s+(\d{1,2}):(\d{2})/);
  if (iso) return parseInt(iso[1]) + parseInt(iso[2]) / 60;
  const hm = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) return parseInt(hm[1]) + parseInt(hm[2]) / 60;
  const ampm = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const min = parseInt(ampm[2]);
    if (/pm/i.test(ampm[3]) && h !== 12) h += 12;
    if (/am/i.test(ampm[3]) && h === 12) h = 0;
    return h + min / 60;
  }
  return null;
}

function buildTimeFlags(slots) {
  let early = 0, prime = 0, late = 0;
  for (const slot of (slots || [])) {
    const hour = slotToHour(slot.time);
    if (hour === null) continue;
    if (hour >= 17.0 && hour < 18.5) early++;
    if (hour >= 18.5 && hour < 20.5) prime++;
    if (hour >= 20.5 && hour < 24.0) late++;
  }
  function windowStatus(count) {
    if (count <= 1) return 'booked';
    if (count <= 3) return 'limited';
    return 'available';
  }
  return { early: windowStatus(early), prime: windowStatus(prime), late: windowStatus(late) };
}

// ── Resy tokens ──────────────────────────────────────────────────────────────
const RESY_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const RESY_TOKENS = [
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzg4NjcyMTgsInVpZCI6NjQ2NDA0MzcsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTMyNTg0MDZ9fQ.AbIb4_1fzODDTl7V4f7jpGRLurhHJ4dmYrDJY5VNqfonj8fGXTGDvm6QFD2DK8woHToIGR7esllXerxRL0x9cuQNAf2C7KrBseDuAQc0U-J-Hf2xub26Fh-CYRsF1ZQ-bc2TqylKGkhtrdImXz6qLy1sXiyH938NbR1nIJTNzT-_CYdv',
];
let tokenIdx = 0;
function getHeaders() {
  const token = RESY_TOKENS[tokenIdx % RESY_TOKENS.length];
  tokenIdx++;
  return {
    'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
    'X-Resy-Auth-Token': token,
    'X-Resy-Universal-Auth': token,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'Origin': 'https://resy.com',
    'Referer': 'https://resy.com/',
    'Accept': 'application/json, text/plain, */*'
  };
}

// ── Fetch slots via API ───────────────────────────────────────────────────────
async function fetchSlots(venueId, slug, date, partySize) {
  // Try POST first
  try {
    const body = { lat: 0, long: 0, day: date, party_size: partySize };
    if (venueId) body.venue_id = venueId;
    else if (slug) { body.slug = slug; body.location = 'ny'; }
    const resp = await fetch('https://api.resy.com/4/find', {
      method: 'POST',
      headers: { ...getHeaders(), 'Content-Type': 'application/json', 'X-Origin': 'https://resy.com' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
    if (resp.ok) {
      const data = await resp.json();
      const slots = data?.results?.venues?.[0]?.slots || [];
      return slots.map(s => ({ time: s.date?.start || s.date?.end || '', type: s.config?.type || 'dining_room' }));
    }
  } catch {}

  // Try GET fallback
  try {
    const qs = venueId ? `venue_id=${venueId}` : `slug=${slug}&location=ny`;
    const url = `https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${date}&party_size=${partySize}&${qs}`;
    const resp = await fetch(url, { headers: getHeaders(), signal: AbortSignal.timeout(10000) });
    if (resp.ok) {
      const data = await resp.json();
      const slots = data?.results?.venues?.[0]?.slots || [];
      return slots.map(s => ({ time: s.date?.start || s.date?.end || '', type: s.config?.type || 'dining_room' }));
    }
  } catch {}

  return null;
}

// ── Resolve venue ID ──────────────────────────────────────────────────────────
const venueCache = {};

async function resolveVenueId(slug, lookupEntry) {
  if (venueCache[slug]) return venueCache[slug];
  if (lookupEntry?.venue_id) { venueCache[slug] = lookupEntry.venue_id; return lookupEntry.venue_id; }
  const slugsToTry = new Set([slug]);
  const short = slug.replace(/-new-york$/, '');
  if (short !== slug) slugsToTry.add(short);
  for (const suffix of ['-chelsea','-soho','-nyc','-brooklyn','-les','-williamsburg','-west-village','-east-village','-flatiron','-midtown','-uws','-ues','-nolita','-tribeca']) {
    slugsToTry.add(short + suffix);
  }
  for (const s of slugsToTry) {
    for (const loc of ['new-york-ny', 'ny']) {
      try {
        const resp = await fetch(`https://api.resy.com/3/venue?url_slug=${s}&location=${loc}`, { headers: getHeaders(), signal: AbortSignal.timeout(10000) });
        if (!resp.ok) continue;
        const data = await resp.json();
        const id = data?.id?.resy;
        if (id) { venueCache[slug] = id; return id; }
      } catch {}
    }
  }
  return null;
}

// ── Load data ─────────────────────────────────────────────────────────────────
let BOOKING_LOOKUP = {};
try { BOOKING_LOOKUP = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8')); }
catch (e) { console.error('Cannot load booking_lookup.json'); process.exit(1); }

let output = {};
try { output = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); }
catch (e) { console.error('Cannot load tonight_availability.json'); process.exit(1); }

// ── Find limited + booked Resy restaurants ────────────────────────────────────
function getLookupEntry(name) {
  return BOOKING_LOOKUP[name] || BOOKING_LOOKUP[name.toLowerCase()] ||
    BOOKING_LOOKUP[Object.keys(BOOKING_LOOKUP).find(k => k.toLowerCase() === name.toLowerCase())];
}

const toCheck = Object.entries(output)
  .filter(([k, v]) => {
    if (k.startsWith('_')) return false;
    if (v.tier !== 'booked' && v.tier !== 'limited') return false;
    const info = getLookupEntry(k);
    if (!info || info.platform !== 'resy' || !info.url) return false;
    return true;
  })
  .map(([name]) => name);

async function main() {
  console.log(`\n🔍 RESY LIMITED & BOOKED CHECKER`);
  console.log(`📅 Date: ${TODAY}  👥 Party: ${PARTY_SIZE}`);
  console.log(`${'─'.repeat(45)}\n`);

  let list = toCheck;
  if (QUICK_MODE) list = list.slice(0, 20);
  console.log(`📊 Found ${list.length} limited/booked Resy restaurants\n`);

  // ══════════════════════════════════════════════════════════════════
  // PHASE 1: Re-check tonight's availability
  // ══════════════════════════════════════════════════════════════════
  console.log(`${'─'.repeat(45)}`);
  console.log(`🔄 Phase 1: Re-checking tonight's availability for ${list.length} restaurants\n`);

  let p1_open = 0, p1_limited = 0, p1_booked = 0, p1_fail = 0;
  const stillBooked = [];

  for (let i = 0; i < list.length; i++) {
    const name = list[i];
    const key = name.toLowerCase();
    const lookupEntry = getLookupEntry(name);
    const slug = extractResySlug(lookupEntry?.url);
    if (!slug) { p1_fail++; continue; }

    const venueId = await resolveVenueId(slug, lookupEntry);
    const slots = await fetchSlots(venueId, slug, TODAY, PARTY_SIZE);

    if (slots === null) {
      p1_fail++;
      console.log(`  ❌ [${i+1}/${list.length}] ${name}: API error`);
      await sleep(3000);
      continue;
    }

    const dinnerSlots = slots.filter(s => {
      const h = slotToHour(s.time);
      return h !== null && h >= 17 && h < 23;
    }).length;

    const primeSlots = slots.filter(s => {
      const h = slotToHour(s.time);
      return h !== null && h >= 18.5 && h < 20.5;
    }).length;

    let tier;
    if (slots.length === 0) tier = 'booked';
    else if (primeSlots === 0 && dinnerSlots <= 1) tier = 'limited';
    else if (primeSlots <= 1 && dinnerSlots <= 3) tier = 'limited';
    else tier = 'open';

    const windows = tier === 'booked'
      ? { early: 'booked', prime: 'booked', late: 'booked' }
      : buildTimeFlags(slots);

    // Update output
    output[key].tier = tier;
    output[key].dinner_slots = dinnerSlots;
    output[key].early = windows.early;
    output[key].prime = windows.prime;
    output[key].late = windows.late;
    output[key]._checked_date = TODAY;

    // Clear old future data if status changed
    if (tier === 'open') {
      delete output[key].opens_in;
      delete output[key].fully_locked;
      delete output[key].not_bookable;
    }

    const icon = tier === 'open' ? '🟢' : tier === 'limited' ? '🟡' : '⚫';
    console.log(`  ${icon} [${i+1}/${list.length}] ${name}: ${tier} (${dinnerSlots} dinner slots) [${windows.early}/${windows.prime}/${windows.late}]`);

    if (tier === 'open') p1_open++;
    else if (tier === 'limited') p1_limited++;
    else { p1_booked++; stillBooked.push(name); }

    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
      console.log(`    💾 Progress saved`);
    }

    await sleep(3000);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n📊 Phase 1 Results: 🟢 Open: ${p1_open}  🟡 Limited: ${p1_limited}  ⚫ Booked: ${p1_booked}  ❌ Failed: ${p1_fail}`);

  // ══════════════════════════════════════════════════════════════════
  // PHASE 2: Future availability for still-booked
  // ══════════════════════════════════════════════════════════════════
  const futureList = stillBooked.filter(name => {
    const key = name.toLowerCase();
    if (!CHECK_ALL && (output[key]?.opens_in || output[key]?.fully_locked)) return false;
    return true;
  });

  if (futureList.length > 0) {
    console.log(`\n${'─'.repeat(45)}`);
    console.log(`🔮 Phase 2: Checking future availability for ${futureList.length} still-booked restaurants\n`);

    const OFFSETS = [3, 7, 14];
    function futureDate(offset) {
      const d = new Date(); d.setDate(d.getDate() + offset);
      return d.toISOString().split('T')[0];
    }

    let hasFuture = 0, locked = 0, apiFailed = 0, notBookable = 0;
    let calendarWorking = null;

    for (let i = 0; i < futureList.length; i++) {
      const name = futureList[i];
      const key = name.toLowerCase();
      const lookupEntry = getLookupEntry(name);
      const slug = extractResySlug(lookupEntry?.url);
      if (!slug) { apiFailed++; continue; }

      const venueId = await resolveVenueId(slug, lookupEntry);
      if (!venueId) {
        apiFailed++;
        console.log(`  ❌ [${i+1}/${futureList.length}] ${name}: no venue ID`);
        await sleep(3000);
        continue;
      }

      let opensIn = null;

      // Try /4/venue/calendar first
      if (calendarWorking !== false) {
        try {
          const resp = await fetch(
            `https://api.resy.com/4/venue/calendar?venue_id=${venueId}&num_seats=${PARTY_SIZE}&start_date=${TODAY}&end_date=${futureDate(14)}`,
            { headers: getHeaders(), signal: AbortSignal.timeout(10000) }
          );
          if (resp.status === 500) {
            if (calendarWorking === null) { calendarWorking = false; console.log(`  ⚠️  Calendar API 500s — falling back to /4/find\n`); }
          } else if (resp.ok) {
            calendarWorking = true;
            const data = await resp.json();
            const scheduled = data?.scheduled || [];

            if (scheduled.length === 0) {
              output[key].fully_locked = true;
              output[key].not_bookable = true;
              notBookable++;
              console.log(`  ⚪ [${i+1}/${futureList.length}] ${name}: not bookable (0 scheduled days)`);
              await sleep(5000);
              continue;
            }

            const targetDates = OFFSETS.map(o => futureDate(o));
            for (let d = 0; d < targetDates.length; d++) {
              const day = scheduled.find(s => s.date === targetDates[d]);
              if (day && day.inventory?.reservation === 'available') { opensIn = OFFSETS[d]; break; }
            }
            if (!opensIn) {
              const anyAvailable = scheduled.find(s => s.inventory?.reservation === 'available');
              if (anyAvailable) {
                opensIn = Math.round((new Date(anyAvailable.date) - new Date(TODAY)) / 86400000);
              }
            }
          }
        } catch { calendarWorking = null; }
      }

      // Fallback: /4/find per date
      if (calendarWorking === false && !opensIn) {
        for (const offset of OFFSETS) {
          if (opensIn) break;
          try {
            const resp = await fetch('https://api.resy.com/4/find', {
              method: 'POST',
              headers: { ...getHeaders(), 'Content-Type': 'application/json', 'X-Origin': 'https://resy.com' },
              body: JSON.stringify({ venue_id: venueId, day: futureDate(offset), party_size: PARTY_SIZE, lat: 0, long: 0 }),
              signal: AbortSignal.timeout(10000),
            });
            if (!resp.ok) continue;
            const data = await resp.json();
            const slots = data?.results?.venues?.[0]?.slots || [];
            if (slots.filter(s => { const hm = (s.date?.start||'').match(/(\d{2}):(\d{2})/); return hm && parseInt(hm[1]) >= 17; }).length > 0) opensIn = offset;
          } catch {}
          await sleep(5000);
        }
      }

      if (opensIn) {
        output[key].opens_in = opensIn;
        hasFuture++;
        console.log(`  🟢 [${i+1}/${futureList.length}] ${name}: opens in +${opensIn}d`);
      } else {
        output[key].fully_locked = true;
        locked++;
        console.log(`  🔒 [${i+1}/${futureList.length}] ${name}: locked`);
      }

      if ((i + 1) % 25 === 0) {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
        console.log(`    💾 Progress saved`);
      }
      await sleep(5000);
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`\n📊 Phase 2 Results: 🟢 Has future: ${hasFuture}  🔒 Locked: ${locked}  ⚪ Not bookable: ${notBookable}  ❌ Failed: ${apiFailed}`);
  }

  console.log(`\n${'═'.repeat(45)}`);
  console.log(`✅ Done!`);
  console.log(`💾 Saved → ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
