/**
 * resy-sniper.mjs
 *
 * Snipes a Resy reservation the moment slots drop.
 *
 * HOW IT WORKS:
 *   1. Starts polling ~2 seconds before drop time (default 10:00 AM)
 *   2. As soon as slots appear for the target date + party size + time window,
 *      it grabs the config_id for the best matching slot
 *   3. Calls /3/details to get the book_token
 *   4. Calls /3/book to lock the reservation
 *
 * USAGE:
 *   node scripts/resy-sniper.mjs --venue torisi --date 2026-04-23 --party 2
 *   node scripts/resy-sniper.mjs --venue torisi --date 2026-04-23 --party 2 --drop-time "10:00"
 *   node scripts/resy-sniper.mjs --venue-id 12345 --date 2026-04-23 --party 2
 *   node scripts/resy-sniper.mjs --slug torisi-italian-specialties --date 2026-04-23 --party 2
 *
 * OPTIONS:
 *   --venue <name>       Restaurant name (looks up in BOOKING_MASTER)
 *   --venue-id <id>      Resy venue ID (skip lookup)
 *   --slug <slug>        Resy URL slug (skip lookup)
 *   --date <YYYY-MM-DD>  Target reservation date
 *   --party <n>          Party size (default: 2)
 *   --earliest <HH:MM>   Earliest acceptable time (default: 17:00)
 *   --latest <HH:MM>     Latest acceptable time (default: 22:00)
 *   --drop-time <HH:MM>  When reservations drop (default: 10:00)
 *   --type <type>        Seat type preference: "dining_room", "bar", "patio" etc
 *   --dry-run            Find slot + get token but don't actually book
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Parse CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const DRY_RUN = args.includes('--dry-run');

const VENUE_NAME = getArg('venue', null);
const VENUE_ID = getArg('venue-id', null);
const SLUG = getArg('slug', null);
const TARGET_DATE = getArg('date', null);
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);
const EARLIEST = getArg('earliest', '17:00');
const LATEST = getArg('latest', '22:00');
const DROP_TIME = getArg('drop-time', '10:00');
const SEAT_TYPE = getArg('type', null);

if (!TARGET_DATE) {
  console.error('❌ --date is required (e.g. --date 2026-04-23)');
  process.exit(1);
}
if (!VENUE_NAME && !VENUE_ID && !SLUG) {
  console.error('❌ Need one of: --venue <name>, --venue-id <id>, or --slug <slug>');
  process.exit(1);
}

// ── Resy auth ───────────────────────────────────────────────────────────────
const RESY_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const RESY_AUTH_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3NzgyNDgwNDUsInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.ALJ6I2NlbwJgN-vRIPd1Pw6CS8CWz9Pec34WwxNoDIFku1ycNsUOEbs9Ejbg2qZznEW4Dqcmw39o2hGmAr7FGW0IAJBTi587PJjzKz8DaqQDpQm6UhGdbo2gSGqOnJXKJRhxrJtN4EsMa2cSGWf0Zl3gt0ZhnwOW5zxy4apWuU9JiT5k';

// Headers WITHOUT auth token — for read-only endpoints (find, venue, calendar)
const HEADERS_PUBLIC = {
  'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  'Origin': 'https://resy.com',
  'Referer': 'https://resy.com/',
  'Accept': 'application/json, text/plain, */*',
};

// Headers WITH auth token — for authenticated endpoints (details, book, user)
const HEADERS_AUTH = {
  ...HEADERS_PUBLIC,
  'X-Resy-Auth-Token': RESY_AUTH_TOKEN,
  'X-Resy-Universal-Auth': RESY_AUTH_TOKEN,
  'Content-Type': 'application/x-www-form-urlencoded',
};

// Alias for backward compat
const HEADERS = HEADERS_AUTH;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function timeToDecimal(t) {
  const [h, m] = t.split(':').map(Number);
  return h + (m || 0) / 60;
}

const EARLIEST_DEC = timeToDecimal(EARLIEST);
const LATEST_DEC = timeToDecimal(LATEST);

// ── Step 0: Resolve venue ID ────────────────────────────────────────────────
async function resolveVenue() {
  if (VENUE_ID) return { venueId: parseInt(VENUE_ID), slug: SLUG };

  let slug = SLUG;

  // Look up from BOOKING_MASTER by name
  if (!slug && VENUE_NAME) {
    const bmPath = resolve(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
    const bm = JSON.parse(readFileSync(bmPath, 'utf8'));

    const searchName = VENUE_NAME.toLowerCase();
    let match = null;
    for (const [k, v] of Object.entries(bm)) {
      if (k.toLowerCase().includes(searchName) && v.platform === 'resy' && v.url) {
        match = v;
        console.log(`📍 Found: "${k}" → ${v.url}`);
        break;
      }
    }

    if (!match) {
      console.error(`❌ "${VENUE_NAME}" not found in BOOKING_MASTER as a Resy restaurant`);
      process.exit(1);
    }

    const m = match.url.match(/\/venues\/([a-z0-9-]+)/i) || match.url.match(/\/cities\/[a-z-]+\/([a-z0-9-]+)\/?$/i);
    slug = m ? m[1] : null;
    if (!slug) {
      console.error(`❌ Could not extract slug from ${match.url}`);
      process.exit(1);
    }
  }

  // Resolve slug → venue ID
  console.log(`🔍 Resolving slug: ${slug}`);
  for (const loc of ['new-york-ny', 'ny']) {
    const resp = await fetch(`https://api.resy.com/3/venue?url_slug=${slug}&location=${loc}`, { headers: HEADERS_PUBLIC });
    if (resp.ok) {
      const data = await resp.json();
      const venueId = data?.id?.resy;
      if (venueId) {
        console.log(`✅ Venue: ${data.name} (ID: ${venueId})`);
        return { venueId, slug, venueName: data.name };
      }
    }
  }

  console.error(`❌ Could not resolve venue ID for slug: ${slug}`);
  process.exit(1);
}

// ── Step 1: Find available slots ────────────────────────────────────────────
async function findSlots(venueId, slug) {
  // Try multiple endpoint formats — Resy sometimes changes which ones work
  const urls = [
    `https://api.resy.com/4/find?venue_id=${venueId}&day=${TARGET_DATE}&party_size=${PARTY_SIZE}&lat=40.7128&long=-74.006`,
    `https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${TARGET_DATE}&party_size=${PARTY_SIZE}&venue_id=${venueId}`,
  ];
  if (slug) {
    urls.push(`https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${TARGET_DATE}&party_size=${PARTY_SIZE}&slug=${slug}&location=new-york-ny`);
  }

  for (const url of urls) {
    try {
      const resp = await fetch(url, { headers: HEADERS_PUBLIC });
      if (!resp.ok) continue;

      const data = await resp.json();
      if (data?.error) continue;

      const venue = data?.results?.venues?.[0];
      if (!venue?.slots?.length) continue;

      return venue.slots.map(s => ({
        configId: s.config?.id,
        token: s.config?.token,
        type: s.config?.type || 'dining_room',
        timeStart: s.date?.start,
        timeEnd: s.date?.end,
        payment: s.payment?.config || null,
        shiftId: s.shift?.id,
      }));
    } catch {}
  }

  return [];
}

// ── Step 2: Filter slots by time window and type ────────────────────────────
function filterSlots(slots) {
  return slots.filter(s => {
    const m = s.timeStart?.match(/(\d{1,2}):(\d{2})/);
    if (!m) return false;
    const dec = parseInt(m[1]) + parseInt(m[2]) / 60;
    if (dec < EARLIEST_DEC || dec > LATEST_DEC) return false;
    if (SEAT_TYPE && !s.type.toLowerCase().includes(SEAT_TYPE.toLowerCase())) return false;
    return true;
  });
}

// Rank slots: prefer prime time (7-8:30 PM), then earlier over later
function rankSlots(slots) {
  return slots.sort((a, b) => {
    const getHour = s => {
      const m = s.timeStart?.match(/(\d{1,2}):(\d{2})/);
      return m ? parseInt(m[1]) + parseInt(m[2]) / 60 : 0;
    };
    const ha = getHour(a), hb = getHour(b);
    // Prime time (19-20.5) gets priority
    const primeA = ha >= 19 && ha <= 20.5 ? 0 : 1;
    const primeB = hb >= 19 && hb <= 20.5 ? 0 : 1;
    if (primeA !== primeB) return primeA - primeB;
    // Then prefer earlier times
    return ha - hb;
  });
}

// ── Step 3: Get booking details (book_token) ────────────────────────────────
async function getDetails(configToken, date, partySize) {
  const body = JSON.stringify({ config_id: configToken, day: date, party_size: partySize });

  const resp = await fetch('https://api.resy.com/3/details', {
    method: 'POST',
    headers: { ...HEADERS_AUTH, 'Content-Type': 'application/json' },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`❌ /3/details failed (${resp.status}): ${text.slice(0, 200)}`);
    return null;
  }

  const data = await resp.json();
  return {
    bookToken: data?.book_token?.value,
    paymentMethodId: data?.user?.payment_methods?.[0]?.id,
    cancellationPolicy: data?.cancellation?.policy,
    depositAmount: data?.payment?.deposit?.amount,
  };
}

// ── Step 4: Book the reservation ────────────────────────────────────────────
async function bookReservation(bookToken, paymentMethodId) {
  const params = new URLSearchParams();
  params.append('book_token', bookToken);
  params.append('struct_payment_method', JSON.stringify({ id: paymentMethodId }));
  params.append('source_id', 'resy.com-venue-details');

  const resp = await fetch('https://api.resy.com/3/book', {
    method: 'POST',
    headers: { ...HEADERS_AUTH, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`❌ /3/book failed (${resp.status}): ${text.slice(0, 300)}`);
    return null;
  }

  return await resp.json();
}

// ── Sniper loop ─────────────────────────────────────────────────────────────
async function snipe(venueId, venueName, slug) {
  const [dropH, dropM] = DROP_TIME.split(':').map(Number);

  // Calculate ms until drop
  const now = new Date();
  const drop = new Date(now);
  drop.setHours(dropH, dropM, 0, 0);

  if (drop <= now) {
    console.log(`⚡ Drop time already passed — checking immediately`);
  } else {
    const msUntil = drop - now;
    const minsUntil = Math.ceil(msUntil / 60000);
    console.log(`\n⏰ Drop time: ${DROP_TIME}`);
    console.log(`⏳ Waiting ${minsUntil} minutes (${(msUntil / 1000).toFixed(0)}s)...`);
    console.log(`   Will start polling 2s before drop\n`);

    // Wait until 2 seconds before drop
    const waitMs = msUntil - 2000;
    if (waitMs > 0) {
      // Show countdown every 30 seconds
      const interval = setInterval(() => {
        const remaining = drop - new Date();
        if (remaining > 0) {
          const m = Math.floor(remaining / 60000);
          const s = Math.floor((remaining % 60000) / 1000);
          process.stdout.write(`\r   ⏳ ${m}m ${s}s remaining...     `);
        }
      }, 30000);

      await sleep(waitMs);
      clearInterval(interval);
    }
  }

  // ── RAPID POLLING ─────────────────────────────────────────────────────────
  console.log(`\n🚀 POLLING STARTED at ${new Date().toISOString()}`);
  console.log(`   Looking for: ${venueName || venueId}`);
  console.log(`   Date: ${TARGET_DATE} | Party: ${PARTY_SIZE} | Time: ${EARLIEST}-${LATEST}`);
  console.log(`   ${DRY_RUN ? '🧪 DRY RUN — will not actually book' : '🔴 LIVE — will book if slot found'}\n`);

  const MAX_ATTEMPTS = 60;       // Max poll attempts
  const POLL_INTERVAL_MS = 500;  // 500ms between polls (fast but not insane)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const t0 = Date.now();
    process.stdout.write(`  [${attempt}/${MAX_ATTEMPTS}] ${new Date().toISOString().split('T')[1].slice(0, 12)} `);

    try {
      const allSlots = await findSlots(venueId, slug);

      if (allSlots.length === 0) {
        console.log(`— no slots yet`);
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      console.log(`🎯 ${allSlots.length} total slots found!`);

      // Filter and rank
      const matching = filterSlots(allSlots);
      if (matching.length === 0) {
        console.log(`     ⚠️ ${allSlots.length} slots but none in ${EARLIEST}-${LATEST} window`);
        // Show what times ARE available
        for (const s of allSlots.slice(0, 5)) {
          console.log(`        ${s.timeStart} (${s.type})`);
        }
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const ranked = rankSlots(matching);
      const best = ranked[0];

      console.log(`\n  ✨ FOUND MATCHING SLOT!`);
      console.log(`     Time: ${best.timeStart}`);
      console.log(`     Type: ${best.type}`);
      console.log(`     Config ID: ${best.configId}`);

      // Show all matching options
      if (ranked.length > 1) {
        console.log(`     (${ranked.length - 1} other options: ${ranked.slice(1, 4).map(s => s.timeStart?.match(/\d{2}:\d{2}/)?.[0]).join(', ')})`);
      }

      // ── GET DETAILS ───────────────────────────────────────────────────
      console.log(`\n  📋 Getting booking details...`);
      const details = await getDetails(best.token, TARGET_DATE, PARTY_SIZE);

      if (!details?.bookToken) {
        console.error(`  ❌ Failed to get book token — trying next slot`);
        // Try next slot
        for (let j = 1; j < ranked.length; j++) {
          console.log(`  🔄 Trying slot #${j + 1}: ${ranked[j].timeStart}`);
          const alt = await getDetails(ranked[j].token, TARGET_DATE, PARTY_SIZE);
          if (alt?.bookToken) {
            Object.assign(details, alt);
            break;
          }
        }
        if (!details?.bookToken) {
          console.error(`  ❌ Could not get book token for any slot`);
          continue;
        }
      }

      console.log(`     Book token: ${details.bookToken?.slice(0, 40)}...`);
      console.log(`     Payment method: ${details.paymentMethodId}`);
      if (details.depositAmount) {
        console.log(`     ⚠️ Deposit required: $${details.depositAmount}`);
      }
      if (details.cancellationPolicy) {
        console.log(`     📜 Cancellation: ${JSON.stringify(details.cancellationPolicy).slice(0, 100)}`);
      }

      // ── BOOK IT ───────────────────────────────────────────────────────
      if (DRY_RUN) {
        console.log(`\n  🧪 DRY RUN — would book now. Exiting.`);
        console.log(`     To book for real, remove --dry-run`);
        process.exit(0);
      }

      if (!details.paymentMethodId) {
        console.error(`\n  ❌ No payment method on file — cannot book`);
        console.log(`     Add a payment method at resy.com/account then try again`);
        process.exit(1);
      }

      console.log(`\n  🔥 BOOKING...`);
      const result = await bookReservation(details.bookToken, details.paymentMethodId);

      if (result) {
        console.log(`\n  ${'🎉'.repeat(5)}`);
        console.log(`  ✅ RESERVATION BOOKED!`);
        console.log(`     Confirmation: ${result.resy_token || JSON.stringify(result).slice(0, 200)}`);
        console.log(`     ${venueName || 'Restaurant'}`);
        console.log(`     ${TARGET_DATE} at ${best.timeStart?.match(/\d{2}:\d{2}/)?.[0]}`);
        console.log(`     Party of ${PARTY_SIZE}`);
        console.log(`  ${'🎉'.repeat(5)}\n`);
        process.exit(0);
      } else {
        console.error(`  ❌ Booking call returned null — slot may have been taken`);
        console.log(`     Continuing to try other slots...`);
      }

    } catch (err) {
      console.log(`❌ Error: ${err.message?.slice(0, 80)}`);
    }

    const elapsed = Date.now() - t0;
    const wait = Math.max(0, POLL_INTERVAL_MS - elapsed);
    if (wait > 0) await sleep(wait);
  }

  console.log(`\n😔 Max attempts reached. No reservation booked.`);
  console.log(`   Tip: Make sure the drop time is correct and your auth token is valid.`);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  🎯 RESY RESERVATION SNIPER`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`  Date:      ${TARGET_DATE}`);
  console.log(`  Party:     ${PARTY_SIZE}`);
  console.log(`  Window:    ${EARLIEST} - ${LATEST}`);
  console.log(`  Drop time: ${DROP_TIME}`);
  console.log(`  Mode:      ${DRY_RUN ? '🧪 DRY RUN' : '🔴 LIVE'}`);
  console.log(`${'═'.repeat(50)}\n`);

  const { venueId, slug, venueName } = await resolveVenue();

  // Verify auth token is still valid
  console.log(`\n🔑 Verifying auth token...`);
  try {
    const resp = await fetch('https://api.resy.com/2/user', { headers: HEADERS });
    if (resp.ok) {
      const user = await resp.json();
      console.log(`✅ Authenticated as: ${user.first_name} ${user.last_name} (${user.em_address})`);
    } else {
      console.error(`⚠️ Auth check returned ${resp.status} — token may be expired`);
      console.log(`   Get a fresh token: log into resy.com, open DevTools > Network, find any API call, copy the auth token`);
      if (!DRY_RUN) {
        console.error(`   Cannot proceed in LIVE mode with expired token`);
        process.exit(1);
      }
    }
  } catch (e) {
    console.error(`⚠️ Auth check failed: ${e.message}`);
  }

  await snipe(venueId, venueName, slug);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
