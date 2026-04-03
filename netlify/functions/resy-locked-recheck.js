/**
 * resy-locked-recheck.js — Distinguish truly booked vs not-really-bookable
 *
 * Strategy: Try /4/venue/calendar API first (fastest, most reliable).
 * If calendar API is down (500s), falls back to checking /4/find at
 * far-future dates (+30, +45, +60 days). Truly bookable restaurants
 * will have slots on distant dates. Not-bookable ones (walk-in only)
 * will have 0 slots on every date.
 *
 * Results:
 *   - 0 scheduled days / 0 slots on all dates → not_bookable (walk-in/events only)
 *   - All days "sold-out" / 0 tonight slots → truly_booked
 *   - Has available days / future slots → has_availability (fixes fully_locked)
 *
 * RUN: node netlify/functions/resy-locked-recheck.js [--quick] [--all]
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const CHECK_ALL = args.includes('--all');
const PARTY_SIZE = 2;
const TODAY = new Date().toISOString().split('T')[0];

const MASTER_FILE = path.join(__dirname, 'BOOKING_MASTER.json');
const AVAIL_FILE = path.join(__dirname, 'tonight_availability.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Resy API ──
const RESY_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const RESY_TOKENS = [
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3NzkxMTA0NjksInVpZCI6Mzk4MTc5NDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxMzE1NzU1OTh9fQ.AK_C_mXAuYxUAm5STNjxiTG6bPatlyULTR2iGo0ksCXi3tuWwRp73sTp3CvWlajPxVqCUQY_NnVPrMrx3DTjs07oAd-R_2DzIYrGzQuRq2dsfhShfP1MH6OOiLsDADOe0dV0XsVoY5MeqlAQy57QffAKtQcGmyR8VKx4i7kWbQGlxreV',
];
let tokenIdx = 0;

function getHeaders() {
  const token = RESY_TOKENS[tokenIdx % RESY_TOKENS.length];
  tokenIdx++;
  return {
    'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
    'X-Resy-Auth-Token': token,
    'X-Resy-Universal-Auth': token,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'Origin': 'https://resy.com',
    'Referer': 'https://resy.com/',
    'Accept': 'application/json',
  };
}

function futureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function extractResySlug(url) {
  if (!url) return null;
  const m1 = url.match(/resy\.com\/cities\/[a-z-]+\/([a-z0-9_-]+)\/?$/i);
  if (m1) return m1[1].toLowerCase();
  const m2 = url.match(/venues\/([a-z0-9_-]+)\/?$/i);
  if (m2) return m2[1].toLowerCase();
  return null;
}

// ── Load data ──
const master = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
const avail = JSON.parse(fs.readFileSync(AVAIL_FILE, 'utf8'));

// Build list of fully_locked / booked Resy restaurants
const toCheck = [];
for (const [name, info] of Object.entries(master)) {
  if (info.platform !== 'resy' || !info.url) continue;
  const key = name.toLowerCase();
  const av = avail[key];
  if (!av) continue;
  if (!av.fully_locked && av.tier !== 'booked') continue;
  if (!CHECK_ALL && av._recheck_result) continue;
  const slug = extractResySlug(info.url);
  if (!slug) continue;
  toCheck.push({ name, key, slug, url: info.url, venueId: info.venue_id });
}

if (QUICK) toCheck.length = Math.min(toCheck.length, 20);

console.log(`\n🔍 Rechecking ${toCheck.length} fully locked Resy restaurants`);
console.log(`   0 slots on all future dates = not bookable | has future slots = truly booked\n`);

// ── Resolve venue ID from slug ──
async function resolveVenueId(slug) {
  try {
    const resp = await fetch(`https://api.resy.com/3/venue?url_slug=${slug}&location=ny`, {
      headers: getHeaders(),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.id?.resy || null;
  } catch {
    return null;
  }
}

// ── Try calendar API (fast path) ──
let calendarWorking = null; // null = unknown, true/false after first attempt

async function checkCalendar(venueId) {
  if (calendarWorking === false) return null;
  try {
    const resp = await fetch(
      `https://api.resy.com/4/venue/calendar?venue_id=${venueId}&num_seats=${PARTY_SIZE}&start_date=${futureDate(0)}&end_date=${futureDate(60)}`,
      { headers: getHeaders(), signal: AbortSignal.timeout(10000) }
    );
    if (resp.status === 500) {
      if (calendarWorking === null) {
        calendarWorking = false;
        console.log(`  ⚠️  Calendar API returning 500s — falling back to /4/find\n`);
      }
      return null;
    }
    if (!resp.ok) return null;
    calendarWorking = true;
    const data = await resp.json();
    const scheduled = data?.scheduled || [];

    if (scheduled.length === 0) return { status: 'not_bookable', scheduledDays: 0 };

    const available = scheduled.filter(d => d.inventory?.reservation === 'available');
    const soldOut = scheduled.filter(d => d.inventory?.reservation === 'sold-out');

    if (available.length > 0) {
      return { status: 'has_availability', scheduledDays: scheduled.length, availableDays: available.length, firstAvailable: available[0].date };
    }

    return { status: 'truly_booked', scheduledDays: scheduled.length, soldOutDays: soldOut.length };
  } catch {
    return null;
  }
}

// ── Fallback: check /4/find at far-future dates ──
async function checkFutureSlots(venueId) {
  // Check dates far enough out that truly bookable restaurants should have availability
  const OFFSETS = [30, 45, 60];
  let anySlots = false;
  let anyResponse = false;

  for (const offset of OFFSETS) {
    const date = futureDate(offset);
    try {
      const resp = await fetch('https://api.resy.com/4/find', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ venue_id: venueId, day: date, party_size: PARTY_SIZE, lat: 0, long: 0 }),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const slots = data?.results?.venues?.[0]?.slots || [];
      anyResponse = true;
      if (slots.length > 0) {
        anySlots = true;
        break; // found slots, no need to check more dates
      }
    } catch {}
    await sleep(1500);
  }

  if (!anyResponse) return { status: 'error' };
  if (anySlots) return { status: 'has_availability' };

  // 0 slots on all far-future dates — but is it not-bookable or just truly booked far out?
  // Check: truly booked restaurants typically have a reasonable ticket price
  // Not-bookable restaurants often have $1 or $0 ticket price
  return { status: 'no_future_slots' };
}

// ── Combine: use venue info to distinguish no_future_slots ──
async function getVenueInfo(venueId) {
  try {
    const resp = await fetch(`https://api.resy.com/3/venue?id=${venueId}`, {
      headers: getHeaders(),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      ticketAvg: data?.ticket?.average || 0,
      reopenDate: data?.reopen?.date || null,
      content: JSON.stringify(data?.content || {}),
    };
  } catch {
    return null;
  }
}

// ── Main ──
async function main() {
  const counts = { truly_booked: 0, not_bookable: 0, has_availability: 0, error: 0 };

  for (let i = 0; i < toCheck.length; i++) {
    const r = toCheck[i];

    // Resolve venue ID if we don't have one
    let venueId = r.venueId;
    if (!venueId) {
      venueId = await resolveVenueId(r.slug);
      if (!venueId) {
        console.log(`  ❌ [${i + 1}/${toCheck.length}] ${r.name}: can't resolve venue ID`);
        counts.error++;
        await sleep(1000);
        continue;
      }
      await sleep(500);
    }

    // Try calendar first, then fallback
    let result = await checkCalendar(venueId);

    if (!result) {
      // Calendar unavailable — use /4/find fallback
      result = await checkFutureSlots(venueId);

      // If no slots on any future date, check venue info to distinguish
      if (result.status === 'no_future_slots') {
        const info = await getVenueInfo(venueId);
        if (info) {
          const walkInHint = info.content.toLowerCase().includes('walk-in') ||
                             info.content.toLowerCase().includes('walk in') ||
                             info.content.toLowerCase().includes('no reservations');
          const lowTicket = info.ticketAvg <= 1;
          const neverReopened = !info.reopenDate;

          // Walk-in hints, $1 ticket, or never reopened = not bookable
          if (walkInHint || (lowTicket && neverReopened)) {
            result = { status: 'not_bookable', reason: walkInHint ? 'walk-in text' : 'low ticket + no reopen' };
          } else {
            result = { status: 'truly_booked', reason: 'no future slots but looks like real restaurant' };
          }
        } else {
          result = { status: 'truly_booked', reason: 'no future slots, assuming booked' };
        }
      }
    }

    const icon = {
      truly_booked: '🔴', not_bookable: '⚪', has_availability: '🟢', error: '❌'
    }[result.status] || '❓';

    let detail = '';
    if (result.status === 'not_bookable') detail = result.reason ? ` (${result.reason})` : ' (0 scheduled days)';
    else if (result.status === 'truly_booked') detail = result.scheduledDays ? ` (${result.scheduledDays} days, all sold-out)` : result.reason ? ` (${result.reason})` : '';
    else if (result.status === 'has_availability') detail = result.firstAvailable ? ` (first: ${result.firstAvailable})` : ' (has future slots)';

    console.log(`  ${icon} [${i + 1}/${toCheck.length}] ${r.name}: ${result.status}${detail}`);
    counts[result.status]++;

    // Update avail data
    const key = r.key;
    if (result.status === 'not_bookable') {
      avail[key]._recheck_result = 'not_bookable';
      avail[key].not_bookable = true;
    } else if (result.status === 'truly_booked') {
      avail[key]._recheck_result = 'truly_booked';
    } else if (result.status === 'has_availability') {
      avail[key]._recheck_result = 'has_availability';
      avail[key].fully_locked = false;
      if (result.firstAvailable) avail[key].opens_in = result.firstAvailable;
    }

    // Save every 50
    if ((i + 1) % 50 === 0) {
      fs.writeFileSync(AVAIL_FILE, JSON.stringify(avail, null, 2));
      console.log(`    💾 Progress saved`);
    }

    await sleep(4000 + Math.floor(Math.random() * 3000));
  }

  // Final save
  fs.writeFileSync(AVAIL_FILE, JSON.stringify(avail, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 Results:`);
  console.log(`   🔴 Truly booked:     ${counts.truly_booked}`);
  console.log(`   ⚪ Not bookable:     ${counts.not_bookable}`);
  console.log(`   🟢 Has availability: ${counts.has_availability}`);
  console.log(`   ❌ Error:            ${counts.error}`);
  console.log(`\n💾 Saved → ${AVAIL_FILE}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
