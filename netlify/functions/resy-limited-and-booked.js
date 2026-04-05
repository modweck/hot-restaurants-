/**
 * resy-limited-and-booked.js
 *
 * Checks ONLY limited and booked Resy restaurants from tonight_availability.json.
 * Skips the full Phase 1 availability check — just does future availability.
 * Writes results back into tonight_availability.json.
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
const BOOKING_FILE  = path.join(__dirname, 'booking_lookup.json');
const OUTPUT_FILE   = path.join(__dirname, 'tonight_availability.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Resy URL → slug ───────────────────────────────────────────────────────────
function extractResySlug(url) {
  if (!url) return null;
  const m1 = url.match(/resy\.com\/cities\/[a-z-]+\/([a-z0-9_-]+)\/?$/i);
  if (m1) return m1[1].toLowerCase();
  const m2 = url.match(/venues\/([a-z0-9_-]+)\/?$/i);
  if (m2) return m2[1].toLowerCase();
  return null;
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

// ── Load data ─────────────────────────────────────────────────────────────────
let BOOKING_LOOKUP = {};
try { BOOKING_LOOKUP = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8')); }
catch (e) { console.error('Cannot load booking_lookup.json'); process.exit(1); }

let output = {};
try { output = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); }
catch (e) { console.error('Cannot load tonight_availability.json'); process.exit(1); }

// ── Find limited + booked Resy restaurants ────────────────────────────────────
const toCheck = Object.entries(output)
  .filter(([k, v]) => {
    if (k.startsWith('_')) return false;
    if (v.tier !== 'booked' && v.tier !== 'limited') return false;
    // Must be a Resy restaurant
    const info = BOOKING_LOOKUP[k] || BOOKING_LOOKUP[Object.keys(BOOKING_LOOKUP).find(bk => bk.toLowerCase() === k.toLowerCase())];
    if (!info || info.platform !== 'resy' || !info.url) return false;
    // Skip already checked unless --all
    if (!CHECK_ALL && (v.opens_in || v.fully_locked)) return false;
    return true;
  })
  .map(([name]) => name);

async function main() {
  console.log(`\n🔍 RESY LIMITED & BOOKED CHECKER`);
  console.log(`📅 Date: ${TODAY}  👥 Party: ${PARTY_SIZE}`);
  console.log(`${'─'.repeat(45)}\n`);
  console.log(`📊 Found ${toCheck.length} limited/booked Resy restaurants to check\n`);

  let list = toCheck;
  if (QUICK_MODE) list = list.slice(0, 20);

  const OFFSETS = [3, 7, 14];
  function futureDate(offset) {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return d.toISOString().split('T')[0];
  }

  // Venue ID cache
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

  let hasFuture = 0, locked = 0, apiFailed = 0, noSlugCount = 0, notBookable = 0;
  let consecutiveFails = 0;
  let calendarWorking = null;

  for (let i = 0; i < list.length; i++) {
    const name = list[i];
    const key = name.toLowerCase();
    const lookupEntry = BOOKING_LOOKUP[name] || BOOKING_LOOKUP[key] || BOOKING_LOOKUP[Object.keys(BOOKING_LOOKUP).find(k => k.toLowerCase() === key)];
    const slug = extractResySlug(lookupEntry?.url);
    if (!slug) { noSlugCount++; console.log(`  🔒 [${i+1}/${list.length}] ${name}: no slug`); continue; }

    // Resolve venue ID
    const venueId = await resolveVenueId(slug, lookupEntry);
    if (!venueId) {
      apiFailed++;
      consecutiveFails++;
      console.log(`  ❌ [${i+1}/${list.length}] ${name}: no venue ID`);
      if (consecutiveFails >= 5) {
        console.log(`     ⏸️ ${consecutiveFails} consecutive fails — backing off 30s`);
        await sleep(30000);
        consecutiveFails = 0;
      }
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
          if (calendarWorking === null) {
            calendarWorking = false;
            console.log(`  ⚠️  Calendar API returning 500s — falling back to /4/find\n`);
          }
        } else if (resp.ok) {
          calendarWorking = true;
          consecutiveFails = 0;
          const data = await resp.json();
          const scheduled = data?.scheduled || [];

          if (scheduled.length === 0) {
            output[key].fully_locked = true;
            output[key].not_bookable = true;
            notBookable++;
            console.log(`  ⚪ [${i+1}/${list.length}] ${name}: not bookable (0 scheduled days)`);
            await sleep(5000);
            continue;
          }

          // Check target dates
          const targetDates = OFFSETS.map(o => futureDate(o));
          for (let d = 0; d < targetDates.length; d++) {
            const day = scheduled.find(s => s.date === targetDates[d]);
            if (day && day.inventory?.reservation === 'available') {
              opensIn = OFFSETS[d];
              break;
            }
          }

          // Check ANY future date
          if (!opensIn) {
            const anyAvailable = scheduled.find(s => s.inventory?.reservation === 'available');
            if (anyAvailable) {
              const diffMs = new Date(anyAvailable.date) - new Date(TODAY);
              opensIn = Math.round(diffMs / 86400000);
            }
          }
        } else {
          calendarWorking = null;
        }
      } catch {
        calendarWorking = null;
      }
    }

    // Fallback: /4/find per date
    if (calendarWorking === false && !opensIn) {
      for (const offset of OFFSETS) {
        if (opensIn) break;
        const date = futureDate(offset);
        try {
          const resp = await fetch('https://api.resy.com/4/find', {
            method: 'POST',
            headers: { ...getHeaders(), 'Content-Type': 'application/json', 'X-Origin': 'https://resy.com' },
            body: JSON.stringify({ venue_id: venueId, day: date, party_size: PARTY_SIZE, lat: 0, long: 0 }),
            signal: AbortSignal.timeout(10000),
          });
          if (!resp.ok) { apiFailed++; continue; }
          consecutiveFails = 0;
          const data = await resp.json();
          const slots = data?.results?.venues?.[0]?.slots || [];
          const dinnerSlots = slots.filter(s => {
            const t = s.date?.start || '';
            const hm = t.match(/(\d{2}):(\d{2})/);
            return hm && parseInt(hm[1]) >= 17;
          }).length;
          if (dinnerSlots > 0) opensIn = offset;
        } catch {}
        await sleep(5000);
      }
    }

    if (opensIn) {
      output[key].opens_in = opensIn;
      hasFuture++;
      console.log(`  🟢 [${i+1}/${list.length}] ${name}: opens in +${opensIn}d`);
    } else {
      output[key].fully_locked = true;
      locked++;
      console.log(`  🔒 [${i+1}/${list.length}] ${name}: locked`);
    }

    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
      console.log(`    💾 Progress saved`);
    }

    await sleep(5000);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`\n${'═'.repeat(45)}`);
  console.log(`✅ Done! Checked ${list.length} limited/booked Resy restaurants`);
  console.log(`   🟢 Has future: ${hasFuture}  🔒 Locked: ${locked}  ⚪ Not bookable: ${notBookable}  ❌ API failed: ${apiFailed}  🔒 No slug: ${noSlugCount}`);
  console.log(`💾 Saved → ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
