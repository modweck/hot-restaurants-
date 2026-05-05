/**
 * google-reserve-scraper.js
 *
 * Two-phase scraper for Google Reserve restaurant availability:
 *   Phase 1: Collects Google Reserve IDs from Google Maps place pages
 *   Phase 2: Scrapes availability (time slots) from Reserve pages
 *
 * RUN:
 *   node google-reserve-scraper.js                    # Full run (both phases)
 *   node google-reserve-scraper.js --phase1           # Only collect reserve IDs
 *   node google-reserve-scraper.js --phase2           # Only scrape availability (needs IDs)
 *   node google-reserve-scraper.js --quick            # Test with first 15
 *   node google-reserve-scraper.js --batch 100        # Limit to N restaurants
 *   node google-reserve-scraper.js --date 2026-04-05  # Specific date (default: tomorrow)
 *   node google-reserve-scraper.js --party 2          # Party size (default: 2)
 *   node google-reserve-scraper.js --debug            # Verbose output
 *   node google-reserve-scraper.js --all              # Re-check already checked
 *
 * OUTPUT:
 *   data/google_reserve_ids.json           — Reserve IDs mapped to place_ids
 *   tonight_availability_google.json       — Availability data
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// ── CLI args ──
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}
const PHASE1_ONLY = args.includes('--phase1');
const PHASE2_ONLY = args.includes('--phase2');
const QUICK_MODE  = args.includes('--quick');
const CHECK_ALL   = args.includes('--all');
const DEBUG       = args.includes('--debug');
const PARTY_SIZE  = parseInt(getArg('party', '2'), 10);
const BATCH_LIMIT = parseInt(getArg('batch', '0'), 10);
const BROWSER_RESTART_EVERY = 30;

let CHECK_DATE = getArg('date', null);
if (!CHECK_DATE) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  CHECK_DATE = tomorrow.toISOString().split('T')[0];
}
const CHECK_DATE_COMPACT = CHECK_DATE.replace(/-/g, ''); // YYYYMMDD
const TODAY = new Date().toISOString().split('T')[0];

const MASTER_FILE    = path.join(__dirname, 'BOOKING_MASTER.json');
const RESERVE_ID_FILE = path.join(__dirname, '..', '..', 'data', 'google_reserve_ids.json');
const OUTPUT_FILE    = path.join(__dirname, 'tonight_availability_google.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function randomDelay(min = 3000, max = 6000) { return min + Math.floor(Math.random() * (max - min)); }

// ── Load BOOKING_MASTER ──
let BOOKING_MASTER = {};
try {
  BOOKING_MASTER = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
  console.log(`✅ Loaded BOOKING_MASTER: ${Object.keys(BOOKING_MASTER).length} restaurants`);
} catch (e) {
  console.error('❌ Cannot load BOOKING_MASTER.json');
  process.exit(1);
}

// Get google_reserve restaurants with place_ids
const GR_RESTAURANTS = Object.entries(BOOKING_MASTER)
  .filter(([_, v]) => v.platform === 'google_reserve' && v.place_id)
  .map(([name, info]) => ({ name, place_id: info.place_id }));

console.log(`🍽️  Found ${GR_RESTAURANTS.length} Google Reserve restaurants`);

// ── Puppeteer helpers ──
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
];

async function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1280,800']
  });
}

async function setupPage(browser) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  const vp = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
  await page.setViewport(vp);
  return page;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1: Collect Google Reserve IDs from Google Maps
// ═══════════════════════════════════════════════════════════════════════════════

async function getReserveId(page, placeId, name) {
  const url = `https://www.google.com/maps/place/?q=place_id:${placeId}`;
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
    await sleep(1500);

    // Click "Reserve a table" or "Find a table" and capture the reserve URL
    const reserveLink = await page.evaluate(() => {
      const els = document.querySelectorAll('a[href*="reserve"], a[href*="dine"]');
      for (const el of els) {
        if (el.href.includes('maps/reserve')) return el.href;
      }
      // Try clicking the button to trigger link generation
      const buttons = document.querySelectorAll('a, button, [role="link"], [role="button"]');
      for (const b of buttons) {
        const t = b.textContent.trim();
        if (t === 'Reserve a table' || t === 'Find a table') {
          if (b.href && b.href.includes('reserve')) return b.href;
        }
      }
      return null;
    });

    if (reserveLink) {
      const match = reserveLink.match(/\/dine\/c\/([A-Za-z0-9_-]+)/);
      if (match) return { reserveId: match[1], url: reserveLink };
    }

    // If no link found, try clicking the button and waiting
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('a, button, [role="link"], [role="button"]');
      for (const b of buttons) {
        const t = b.textContent.trim();
        if (t === 'Reserve a table' || t === 'Find a table') { b.click(); return; }
      }
    });
    await sleep(3000);

    // Check again after click
    const reserveLink2 = await page.evaluate(() => {
      const els = document.querySelectorAll('a[href*="reserve"], a[href*="dine"]');
      for (const el of els) {
        if (el.href.includes('maps/reserve')) return el.href;
      }
      return null;
    });

    if (reserveLink2) {
      const match = reserveLink2.match(/\/dine\/c\/([A-Za-z0-9_-]+)/);
      if (match) return { reserveId: match[1], url: reserveLink2 };
    }

    // Check if "Reserve a table" text exists at all
    const hasReserve = await page.evaluate(() => {
      return document.body.innerText.includes('Reserve a table') || document.body.innerText.includes('Find a table');
    });

    if (!hasReserve) {
      if (DEBUG) console.log(`    ⚪ ${name}: no reservation option on Maps`);
      return { reserveId: null, noReserve: true };
    }

    if (DEBUG) console.log(`    ⚠️  ${name}: has Reserve but couldn't extract ID`);
    return { reserveId: null, hasReserve: true };

  } catch (e) {
    if (DEBUG) console.error(`    ❌ ${name}: ${e.message?.slice(0, 60)}`);
    return { reserveId: null, error: e.message?.slice(0, 60) };
  }
}

async function phase1() {
  console.log(`\n═══ PHASE 1: Collecting Google Reserve IDs ═══\n`);

  // Load existing IDs
  let reserveIds = {};
  try { reserveIds = JSON.parse(fs.readFileSync(RESERVE_ID_FILE, 'utf8')); } catch {}
  const existingCount = Object.keys(reserveIds).filter(k => !k.startsWith('_')).length;
  console.log(`📂 Existing reserve IDs: ${existingCount}`);

  let toCheck = GR_RESTAURANTS;

  if (!CHECK_ALL) {
    toCheck = toCheck.filter(r => !reserveIds[r.place_id]);
    console.log(`⏭️  Skipping ${GR_RESTAURANTS.length - toCheck.length} already have IDs`);
  }

  if (QUICK_MODE) toCheck = toCheck.slice(0, 15);
  if (BATCH_LIMIT > 0) toCheck = toCheck.slice(0, BATCH_LIMIT);

  console.log(`🔍 Checking ${toCheck.length} restaurants...\n`);

  let browser = await launchBrowser();
  let page = await setupPage(browser);
  let found = 0, noReserve = 0, errors = 0;

  for (let i = 0; i < toCheck.length; i++) {
    const r = toCheck[i];

    if (i > 0 && i % BROWSER_RESTART_EVERY === 0) {
      console.log(`\n  🔄 Restarting browser (${i}/${toCheck.length})...\n`);
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
      await sleep(2000);
      browser = await launchBrowser();
      page = await setupPage(browser);
    }

    const result = await getReserveId(page, r.place_id, r.name);

    if (result.reserveId) {
      reserveIds[r.place_id] = { reserveId: result.reserveId, name: r.name };
      found++;
      console.log(`  🟢 ${i + 1}/${toCheck.length} ${r.name} → ${result.reserveId}`);
    } else if (result.noReserve) {
      reserveIds[r.place_id] = { reserveId: null, noReserve: true, name: r.name };
      noReserve++;
      console.log(`  ⚪ ${i + 1}/${toCheck.length} ${r.name} — no reservations`);
    } else {
      errors++;
      console.log(`  ❓ ${i + 1}/${toCheck.length} ${r.name} — failed`);
    }

    // Save every 20
    if ((i + 1) % 20 === 0) {
      reserveIds._meta = { last_updated: new Date().toISOString(), total_found: found };
      fs.writeFileSync(RESERVE_ID_FILE, JSON.stringify(reserveIds, null, 2));
    }

    await sleep(randomDelay(5000, 10000));
  }

  // Final save
  reserveIds._meta = { last_updated: new Date().toISOString(), total_found: found + existingCount };
  fs.writeFileSync(RESERVE_ID_FILE, JSON.stringify(reserveIds, null, 2));

  await page.close().catch(() => {});
  await browser.close().catch(() => {});

  console.log(`\n✅ Phase 1 done! Found: ${found} | No reserve: ${noReserve} | Errors: ${errors}`);
  console.log(`📁 Saved to ${RESERVE_ID_FILE}`);

  return reserveIds;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: Scrape availability from Google Reserve pages
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapeAvailability(page, reserveId, name) {
  // Check 3 time windows to get full availability
  const TIME_CHECKS = ['T173000', 'T193000', 'T210000']; // 5:30pm, 7:30pm, 9:00pm
  let allTimeSlots = new Set();
  let lastData = null;

  for (const timeCode of TIME_CHECKS) {
    const url = `https://www.google.com/maps/reserve/v/dine/c/${reserveId}?hl=en-US&ps=${PARTY_SIZE}&ld=${CHECK_DATE_COMPACT}${timeCode}`;
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
      await sleep(1500);

      const windowData = await page.evaluate(() => {
        const text = document.body.innerText;
        const timeSlots = [];
        const allEls = document.querySelectorAll('button, a, [role="option"], [role="button"]');
        for (const el of allEls) {
          const t = el.textContent.trim();
          const m = t.match(/^(\d{1,2}:\d{2}\s*[AP]M)$/i);
          if (m && !el.disabled) timeSlots.push(m[1]);
        }
        const textTimes = text.match(/\d{1,2}:\d{2}\s*[AP]M/gi) || [];
        return [...new Set([...timeSlots, ...textTimes])];
      });

      windowData.forEach(t => allTimeSlots.add(t));
    } catch {}
  }

  // Now do the full evaluation with all collected times
  const url = `https://www.google.com/maps/reserve/v/dine/c/${reserveId}?hl=en-US&ps=${PARTY_SIZE}&ld=${CHECK_DATE_COMPACT}T193000`;

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
    await sleep(2000);

    const data = await page.evaluate(() => {
      const text = document.body.innerText;

      // Get restaurant name
      const headings = document.querySelectorAll('h1, h2, h3, [role="heading"]');
      let restaurantName = '';
      for (const h of headings) {
        const t = h.textContent.trim();
        if (t && t.length > 2 && t.length < 80 && !t.includes('Sign in') && !t.includes('Reserve')) {
          restaurantName = t;
          break;
        }
      }

      // Find provider (Resy, OpenTable, etc.)
      const providerMatch = text.match(/partnership with\s+(\w+)/i) || text.match(/provided by\s+(\w+)/i);
      const provider = providerMatch ? providerMatch[1] : '';

      // Find all time slots — buttons/links with time format
      const timeSlots = [];
      const allEls = document.querySelectorAll('button, a, [role="option"], [role="button"]');
      for (const el of allEls) {
        const t = el.textContent.trim();
        const m = t.match(/^(\d{1,2}:\d{2}\s*[AP]M)$/i);
        if (m && !el.disabled) timeSlots.push(m[1]);
      }

      // Also try regex on full text for times that might not be in buttons
      const textTimes = text.match(/\d{1,2}:\d{2}\s*[AP]M/gi) || [];
      // Filter out duplicates and non-slot times (like opening hours)
      const uniqueSlots = [...new Set([...timeSlots, ...textTimes])];

      // Check for no availability
      const noAvail = text.includes('No availability') || text.includes('no tables') ||
                      text.includes('fully booked') || text.includes('No times available') ||
                      text.includes('not available');

      // Check for sections (Dining Room, Bar, Patio, etc.)
      const sections = [];
      for (const h of headings) {
        const t = h.textContent.trim();
        if (t.match(/dining|bar|patio|terrace|lounge|garden|rooftop|counter|omakase|tasting/i)) {
          sections.push(t);
        }
      }

      // Payment required?
      const paymentRequired = text.includes('Payment may be required') || text.includes('deposit');

      return { restaurantName, provider, timeSlots: uniqueSlots, noAvail, sections, paymentRequired };
    });

    // Merge all time slots from 3 windows + this page
    data.timeSlots.forEach(t => allTimeSlots.add(t));
    const mergedSlots = [...allTimeSlots];

    // Parse time slots into early/prime/late
    let early = 0, prime = 0, late = 0;
    const parsedTimes = [];

    for (const timeStr of mergedSlots) {
      const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!m) continue;
      let h = parseInt(m[1]);
      const min = parseInt(m[2]);
      const ampm = m[3].toUpperCase();
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      const hour = h + min / 60;

      // Only count dinner times (5pm+)
      if (hour < 17) continue;

      parsedTimes.push(timeStr.trim());
      if (hour >= 17.0 && hour < 18.75) early++;              // 5:00-6:30pm
      else if (hour >= 19.0 && hour < 20.5) prime++;          // 7:00-8:30pm
      else if (hour >= 20.5 && hour < 24.0) late++;           // 8:30pm+
    }

    // Sort times chronologically
    parsedTimes.sort((a, b) => {
      const pa = a.match(/(\d+):(\d+)\s*([APap][Mm])/);
      const pb = b.match(/(\d+):(\d+)\s*([APap][Mm])/);
      if (!pa || !pb) return 0;
      let ha = parseInt(pa[1]); if (pa[3].toUpperCase() === 'PM' && ha !== 12) ha += 12; if (pa[3].toUpperCase() === 'AM' && ha === 12) ha = 0;
      let hb = parseInt(pb[1]); if (pb[3].toUpperCase() === 'PM' && hb !== 12) hb += 12; if (pb[3].toUpperCase() === 'AM' && hb === 12) hb = 0;
      return (ha + parseInt(pa[2])/60) - (hb + parseInt(pb[2])/60);
    });

    const total = parsedTimes.length;
    // 0=booked, 1-2=limited, 3+=available
    function windowStatus(count) {
      if (count === 0) return 'booked';
      if (count <= 2) return 'limited';
      return 'available';
    }
    const earlyStatus = windowStatus(early);
    const primeStatus = windowStatus(prime);
    const lateStatus = windowStatus(late);

    let tier;
    if (earlyStatus === 'available' && primeStatus === 'available' && lateStatus === 'available') tier = 'fully_open';
    else if (earlyStatus === 'booked' && primeStatus === 'booked' && lateStatus === 'booked') tier = 'booked_tonight';
    else tier = 'limited';

    return {
      tier,
      dinner_slots: total,
      early: earlyStatus,
      prime: primeStatus,
      late: lateStatus,
      has_early: earlyStatus !== 'booked',
      has_prime: primeStatus !== 'booked',
      has_late: lateStatus !== 'booked',
      sample_times: parsedTimes.slice(0, 8),
      platform: 'google_reserve',
      underlying_platform: data.provider || null,
      sections: data.sections.length ? data.sections : undefined,
      payment_required: data.paymentRequired || false,
      checked_date: new Date().toISOString(),
      matched_name: data.restaurantName,
      reserve_id: reserveId,
    };
  } catch (e) {
    if (DEBUG) console.error(`  ⚠️  ${name}: ${e.message?.slice(0, 60)}`);
    return {
      tier: 'unknown', dinner_slots: 0,
      early: 'booked', prime: 'booked', late: 'booked',
      sample_times: [], platform: 'google_reserve',
      checked_date: new Date().toISOString(), error: e.message?.slice(0, 80)
    };
  }
}

// ── Verify OT/Resy booking links ──
function slugify(name) {
  return name.toLowerCase()
    .replace(/&/g, 'and')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function verifyBookingLink(page, name, provider) {
  const slug = slugify(name);
  const locations = ['new-york', 'new-york-2', 'new-york-3', 'nyc', 'brooklyn', 'manhattan'];

  if (provider === 'OpenTable') {
    // Try common OT URL patterns
    for (const loc of locations) {
      const otUrl = `https://www.opentable.com/r/${slug}-${loc}`;
      try {
        const resp = await page.goto(otUrl, { waitUntil: 'networkidle2', timeout: 15000 });
        const status = resp?.status() || 0;

        if (status === 200) {
          // Verify it's a real restaurant page, not a search/error page
          const isReal = await page.evaluate(() => {
            const text = document.body.innerText;
            const hasBookBtn = text.includes('Make a reservation') || text.includes('Find a time') || text.includes('Find next available');
            const isError = text.includes('page you requested cannot be found') || text.includes('404');
            return hasBookBtn && !isError;
          });

          if (isReal) {
            if (DEBUG) console.log(`    ✅ OT verified: ${otUrl}`);
            return { platform: 'opentable', url: otUrl, verified: true };
          }
        }
      } catch (e) {
        // timeout or navigation error — skip this URL
      }
      await sleep(500);
    }

    // Also try without location suffix
    try {
      const otUrl = `https://www.opentable.com/r/${slug}`;
      const resp = await page.goto(otUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      if (resp?.status() === 200) {
        const isReal = await page.evaluate(() => {
          const text = document.body.innerText;
          return (text.includes('Make a reservation') || text.includes('Find a time')) && !text.includes('cannot be found');
        });
        if (isReal) {
          if (DEBUG) console.log(`    ✅ OT verified: ${otUrl}`);
          return { platform: 'opentable', url: otUrl, verified: true };
        }
      }
    } catch (e) {}

    if (DEBUG) console.log(`    ❌ OT link not found for: ${name}`);
    return null;

  } else if (provider === 'Resy') {
    // Try multiple slug variations
    const slugVariations = [
      slug,
      slug + '-new-york',
      slug.replace(/-restaurant$/, ''),
      slug.replace(/-nyc$/, ''),
    ];
    const tried = new Set();

    for (const s of slugVariations) {
      if (tried.has(s)) continue;
      tried.add(s);
      const resyUrl = `https://resy.com/cities/ny/${s}`;
      try {
        const resp = await page.goto(resyUrl, { waitUntil: 'networkidle2', timeout: 15000 });
        await sleep(1500);
        const status = resp?.status() || 0;

        // Resy returns 200 even for 404s — must check page content carefully
        const isReal = await page.evaluate(() => {
          const text = document.body.innerText;
          const url = window.location.href;
          // Bad signs: redirected to homepage, 404 page, empty, or "not found"
          if (url === 'https://resy.com/' || url === 'https://resy.com') return false;
          if (text.includes('Page not found') || text.includes('404') || text.includes('page you were looking for')) return false;
          if (text.includes("doesn't exist") || text.includes('no longer available')) return false;
          if (text.length < 200) return false;
          // Good signs: has Reserve/Notify/Book AND a restaurant-specific element
          const hasBooking = text.includes('Reserve') || text.includes('Notify') || text.includes('Book Now') || text.includes('Join Waitlist');
          const hasVenue = document.querySelector('[class*="VenuePage"], [class*="venue"], [data-test*="venue"]') !== null;
          const hasAddress = text.includes('New York') || text.includes('Brooklyn') || text.includes('NY');
          return hasBooking && (hasVenue || hasAddress);
        });

        if (isReal) {
          // Final check: make sure we're on a real venue page
          const finalUrl = page.url();
          // Clean the URL — remove date/seats params for the booking link
          const cleanUrl = finalUrl.split('?')[0];
          if (cleanUrl.includes('/cities/') && cleanUrl.includes('/venues/')) {
            if (DEBUG) console.log(`    ✅ Resy verified: ${cleanUrl}`);
            return { platform: 'resy', url: cleanUrl, verified: true };
          }
        }
      } catch (e) {}
      await sleep(500);
    }

    if (DEBUG) console.log(`    ❌ Resy link not found for: ${name}`);
    return null;
  }

  return null;
}

async function phase2(reserveIds) {
  console.log(`\n═══ PHASE 2: Scraping availability + verifying booking links ═══\n`);

  // Load reserve IDs if not passed
  if (!reserveIds) {
    try { reserveIds = JSON.parse(fs.readFileSync(RESERVE_ID_FILE, 'utf8')); } catch {
      console.error('❌ No reserve IDs found. Run --phase1 first.');
      process.exit(1);
    }
  }

  // Build list of restaurants with valid reserve IDs
  const withIds = Object.entries(reserveIds)
    .filter(([k, v]) => !k.startsWith('_') && v.reserveId)
    .map(([placeId, v]) => ({ placeId, reserveId: v.reserveId, name: v.name }));

  console.log(`📂 Restaurants with reserve IDs: ${withIds.length}`);

  // Load existing availability
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}

  let toCheck = withIds;

  if (!CHECK_ALL) {
    toCheck = toCheck.filter(r => {
      const prev = existing[r.name.toLowerCase()];
      if (!prev?.checked_date) return true;
      return prev.checked_date.split('T')[0] !== TODAY;
    });
    console.log(`⏭️  Skipping ${withIds.length - toCheck.length} already checked today`);
  }

  if (QUICK_MODE) toCheck = toCheck.slice(0, 15);
  if (BATCH_LIMIT > 0) toCheck = toCheck.slice(0, BATCH_LIMIT);

  console.log(`🔍 Scraping ${toCheck.length} restaurants for ${CHECK_DATE} (party of ${PARTY_SIZE})\n`);

  let browser = await launchBrowser();
  let page = await setupPage(browser);
  let available = 0, limited = 0, booked = 0, errors = 0, masterUpdated = 0;

  for (let i = 0; i < toCheck.length; i++) {
    const r = toCheck[i];

    if (i > 0 && i % BROWSER_RESTART_EVERY === 0) {
      console.log(`\n  🔄 Restarting browser (${i}/${toCheck.length})...\n`);
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
      await sleep(2000);
      browser = await launchBrowser();
      page = await setupPage(browser);
    }

    const result = await scrapeAvailability(page, r.reserveId, r.name);

    // Verify booking link if underlying platform is OT or Resy
    let verified = null;
    if (result.underlying_platform === 'OpenTable' || result.underlying_platform === 'Resy') {
      verified = await verifyBookingLink(page, r.name, result.underlying_platform);
      if (verified) {
        result.verified_platform = verified.platform;
        result.verified_url = verified.url;
        // Update BOOKING_MASTER
        const masterKey = Object.keys(BOOKING_MASTER).find(k => k.toLowerCase() === r.name.toLowerCase());
        if (masterKey && BOOKING_MASTER[masterKey]) {
          BOOKING_MASTER[masterKey].platform = verified.platform;
          BOOKING_MASTER[masterKey].url = verified.url;
          masterUpdated++;
        }
      }
    }

    existing[r.name.toLowerCase()] = result;

    let status;
    if (result.tier === 'fully_open') { status = '🟢'; available++; }
    else if (result.tier === 'limited') { status = '🟡'; limited++; }
    else if (result.tier === 'booked_tonight') { status = '🔴'; booked++; }
    else { status = '❓'; errors++; }

    const slots = result.sample_times?.length ? ` [${result.sample_times.slice(0, 4).join(', ')}]` : '';
    const prov = result.underlying_platform ? ` (${result.underlying_platform})` : '';
    const verifiedTag = verified ? ` ✅ → ${verified.platform}` : '';
    console.log(`  ${status} ${i + 1}/${toCheck.length} ${r.name}${prov}${slots}${verifiedTag}`);

    // Save every 20
    if ((i + 1) % 20 === 0) {
      existing._meta = { last_updated: new Date().toISOString(), check_date: CHECK_DATE, party_size: PARTY_SIZE };
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));
    }

    await sleep(randomDelay());
  }

  // Final save
  existing._meta = { last_updated: new Date().toISOString(), check_date: CHECK_DATE, party_size: PARTY_SIZE, total_checked: Object.keys(existing).filter(k => !k.startsWith('_')).length };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));

  await page.close().catch(() => {});
  await browser.close().catch(() => {});

  // Save updated BOOKING_MASTER if any links were verified
  if (masterUpdated > 0) {
    fs.writeFileSync(MASTER_FILE, JSON.stringify(BOOKING_MASTER, null, 0));
    console.log(`\n📝 Updated BOOKING_MASTER: ${masterUpdated} restaurants upgraded to real platforms`);
  }

  console.log(`\n✅ Phase 2 done!`);
  console.log(`   🟢 Available: ${available}`);
  console.log(`   🟡 Limited: ${limited}`);
  console.log(`   🔴 Booked: ${booked}`);
  console.log(`   ❓ Errors: ${errors}`);
  console.log(`   📁 Saved to ${OUTPUT_FILE}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3: Check future availability for booked restaurants (+3, +7, +14 days)
// ═══════════════════════════════════════════════════════════════════════════════

const PHASE3_ONLY = args.includes('--phase3');
const FUTURE_DAYS = [3, 7, 14];

async function phase3() {
  console.log(`\n═══ PHASE 3: Future availability for booked restaurants ═══\n`);

  // Load reserve IDs
  let reserveIds = {};
  try { reserveIds = JSON.parse(fs.readFileSync(RESERVE_ID_FILE, 'utf8')); } catch {
    console.error('❌ No reserve IDs found. Run phase1 + phase2 first.');
    return;
  }

  // Load tonight's availability — find booked restaurants
  let tonight = {};
  try { tonight = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {
    console.error('❌ No tonight availability found. Run phase2 first.');
    return;
  }

  const bookedRestaurants = Object.entries(tonight)
    .filter(([k, v]) => !k.startsWith('_') && v.tier === 'booked_tonight' && v.reserve_id)
    .map(([name, v]) => ({ name, reserveId: v.reserve_id }));

  console.log(`🔴 Found ${bookedRestaurants.length} booked restaurants to check future dates`);

  if (bookedRestaurants.length === 0) {
    console.log('✅ Nothing to check!');
    return;
  }

  let browser = await launchBrowser();
  let page = await setupPage(browser);
  let foundFuture = 0;

  for (let i = 0; i < bookedRestaurants.length; i++) {
    const r = bookedRestaurants[i];

    if (i > 0 && i % BROWSER_RESTART_EVERY === 0) {
      console.log(`\n  🔄 Restarting browser (${i}/${bookedRestaurants.length})...\n`);
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
      await sleep(2000);
      browser = await launchBrowser();
      page = await setupPage(browser);
    }

    let opensIn = null;

    for (const days of FUTURE_DAYS) {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + days);
      const futureDateStr = futureDate.toISOString().split('T')[0];
      const futureDateCompact = futureDateStr.replace(/-/g, '');

      // Temporarily override the date for scraping
      const url = `https://www.google.com/maps/reserve/v/dine/c/${r.reserveId}?hl=en-US&ps=${PARTY_SIZE}&ld=${futureDateCompact}T190000`;

      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
        await sleep(2000);

        const hasSlots = await page.evaluate(() => {
          const text = document.body.innerText;
          const noAvail = text.includes('No availability') || text.includes('no tables') ||
                          text.includes('fully booked') || text.includes('No times available') ||
                          text.includes('not available');
          if (noAvail) return false;

          // Check for time slot buttons
          const allEls = document.querySelectorAll('button, a, [role="option"], [role="button"]');
          for (const el of allEls) {
            const t = el.textContent.trim();
            if (/^\d{1,2}:\d{2}\s*[AP]M$/i.test(t) && !el.disabled) return true;
          }
          return false;
        });

        if (hasSlots) {
          opensIn = days;
          break; // Found the earliest future date with availability
        }
      } catch (e) {
        if (DEBUG) console.log(`    ⚠️  ${r.name} +${days}d: ${e.message?.slice(0, 50)}`);
      }

      await sleep(randomDelay(1500, 3000));
    }

    if (opensIn) {
      tonight[r.name].opens_in = opensIn;
      foundFuture++;
      console.log(`  🟢 ${i + 1}/${bookedRestaurants.length} ${r.name} → opens in +${opensIn}d`);
    } else {
      tonight[r.name].fully_locked = true;
      console.log(`  ⚫ ${i + 1}/${bookedRestaurants.length} ${r.name} → fully booked (checked +${FUTURE_DAYS.join(', +')}d)`);
    }

    // Save every 10
    if ((i + 1) % 10 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(tonight, null, 2));
    }

    await sleep(randomDelay(2000, 4000));
  }

  // Final save
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(tonight, null, 2));

  await page.close().catch(() => {});
  await browser.close().catch(() => {});

  console.log(`\n✅ Phase 3 done!`);
  console.log(`   🟢 Opens in future: ${foundFuture}`);
  console.log(`   ⚫ Fully locked: ${bookedRestaurants.length - foundFuture}`);
  console.log(`   📁 Updated ${OUTPUT_FILE}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  if (PHASE3_ONLY) {
    await phase3();
  } else if (PHASE2_ONLY) {
    await phase2(null);
  } else if (PHASE1_ONLY) {
    await phase1();
  } else {
    const reserveIds = await phase1();
    await phase2(reserveIds);
    await phase3();
  }
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
