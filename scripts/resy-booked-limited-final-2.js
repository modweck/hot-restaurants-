/**
 * resy-booked-limited-final-2.js — Multi-pass Resy availability checker (Final 2)
 *
 * Pass 1: API /4/find — all limited + booked Resy restaurants (5s between)
 * Pass 2: Puppeteer — retry failed from Pass 1 (bails after 5 consecutive failures)
 * Pass 3: Calendar API — future availability for still-booked
 * Pass 4: Puppeteer — retry calendar failures (bails after 5 consecutive failures)
 * Pass 5: API retry — anything still failed
 * Pass 6: Puppeteer confirm — verify ALL booked solid (bails after 5 consecutive failures)
 * Pass 7: Final sweep — any remaining misses
 *
 * RUN: node scripts/resy-booked-limited-final-2.js
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'tonight_availability.json');
const LOG_FILE = path.join(__dirname, '..', `resy-check-${new Date().toISOString().split('T')[0]}.log`);

const RESY_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const RESY_TOKENS = [
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzk0NjM1NjEsInVpZCI6NjQ3MzQ1NTgsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTM1MTEzMDV9fQ.AI8EyMqEKGkOg1AqUpzTW1P-6k-Dn7mHn05rGOg3rTy_yzav2Lz83Vg0KBEi6p8bO4q6u9oftlCg4Lo1JCLz9pGeAb6ySt8iHsg2XMXD_NdlTNrGREs08gUjf5kl7iQaux3aUtExwzZZwT7WbnCpctLhf3Xmhw8vd7MClbdYX0oUrkzn',
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzk0NjMzOTQsInVpZCI6Mzk4MTc5NDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxMzE1NzU1OTh9fQ.AWsdZutVGRr9OO7HxYfN_KbcjDMNh2zh7OYR1PbBmiOvTGONv8COVN-Nw7ZO93Bhkyw3bHjVuQMVkR6W9Lh3vSefAcqSpock4cViKL4Enf5JD-se2u6VtYUlMOQIJIW6EoGKp6AirSJNUs5DwetuOWob-OLojNA-J8foq-aYs9kZe-kt',
];
let tokenIdx = 0;

const TODAY = new Date().toISOString().split('T')[0];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(msg) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false }) + '.' + String(new Date().getMilliseconds()).padStart(3, '0');
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

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
    'Accept': 'application/json, text/plain, */*',
  };
}

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
  const hm = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) return parseInt(hm[1]) + parseInt(hm[2]) / 60;
  const ampm = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    if (/pm/i.test(ampm[3]) && h !== 12) h += 12;
    if (/am/i.test(ampm[3]) && h === 12) h = 0;
    return h + parseInt(ampm[2]) / 60;
  }
  return null;
}

function classifySlots(slots) {
  let early = 0, prime = 0, late = 0, dinnerSlots = 0;
  for (const s of (slots || [])) {
    const h = slotToHour(s.time || s);
    if (h === null) continue;
    if (h >= 17 && h < 23) dinnerSlots++;
    if (h >= 17.0 && h < 18.5) early++;
    if (h >= 18.5 && h < 20.5) prime++;
    if (h >= 20.5 && h < 24.0) late++;
  }
  function ws(c) { return c <= 1 ? 'booked' : c <= 3 ? 'limited' : 'available'; }
  let tier;
  if (slots.length === 0) tier = 'booked';
  else if (prime === 0 && dinnerSlots <= 1) tier = 'limited';
  else if (prime <= 1 && dinnerSlots <= 3) tier = 'limited';
  else tier = 'open';
  return { tier, dinner_slots: dinnerSlots, early: ws(early), prime: ws(prime), late: ws(late) };
}

// ── Venue ID resolution ──
const venueCache = {};

async function resolveVenueId(slug, bmEntry) {
  if (venueCache[slug]) return venueCache[slug];
  if (bmEntry?.resy_venue_id) { venueCache[slug] = bmEntry.resy_venue_id; return bmEntry.resy_venue_id; }
  if (bmEntry?.venue_id) { venueCache[slug] = bmEntry.venue_id; return bmEntry.venue_id; }
  const slugsToTry = new Set([slug]);
  const short = slug.replace(/-new-york$/, '');
  if (short !== slug) slugsToTry.add(short);
  for (const s of slugsToTry) {
    for (const loc of ['new-york-ny', 'ny']) {
      try {
        const resp = await fetch(`https://api.resy.com/3/venue?url_slug=${s}&location=${loc}`, {
          headers: getHeaders(), signal: AbortSignal.timeout(10000)
        });
        if (!resp.ok) continue;
        const data = await resp.json();
        const id = data?.id?.resy;
        if (id) { venueCache[slug] = id; return id; }
      } catch {}
    }
  }
  return null;
}

// ── Puppeteer bail tracking ──
const PUPPETEER_BAIL_THRESHOLD = 5;
let puppeteerConsecutiveFails = 0;
let puppeteerBurnt = false;

function resetPuppeteerBail() {
  puppeteerConsecutiveFails = 0;
  puppeteerBurnt = false;
}

function trackPuppeteerResult(success) {
  if (success) {
    puppeteerConsecutiveFails = 0;
  } else {
    puppeteerConsecutiveFails++;
    if (puppeteerConsecutiveFails >= PUPPETEER_BAIL_THRESHOLD) {
      puppeteerBurnt = true;
      log(`⚠️  Puppeteer burnt — ${PUPPETEER_BAIL_THRESHOLD} consecutive failures. Bailing on remaining.`);
    }
  }
}

// ── API: /4/find ──
async function apiFind(venueId, slug, date, partySize) {
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
      return { success: true, slots: slots.map(s => ({ time: s.date?.start || '', type: s.config?.type || '' })) };
    }
    if (resp.status === 403 || resp.status === 429) return { success: false, error: resp.status, retriable: true };
    return { success: false, error: resp.status };
  } catch (e) {
    // Try GET fallback
    try {
      const qs = venueId ? `venue_id=${venueId}` : `slug=${slug}&location=ny`;
      const url = `https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${date}&party_size=${partySize}&${qs}`;
      const resp = await fetch(url, { headers: getHeaders(), signal: AbortSignal.timeout(10000) });
      if (resp.ok) {
        const data = await resp.json();
        const slots = data?.results?.venues?.[0]?.slots || [];
        return { success: true, slots: slots.map(s => ({ time: s.date?.start || '', type: s.config?.type || '' })) };
      }
      return { success: false, error: resp.status || e.message, retriable: true };
    } catch (e2) {
      return { success: false, error: e2.message, retriable: true };
    }
  }
}

// ── API: /4/venue/calendar ──
async function apiCalendar(venueId, partySize) {
  const endDate = new Date(); endDate.setDate(endDate.getDate() + 14);
  const end = endDate.toISOString().split('T')[0];
  try {
    const resp = await fetch(
      `https://api.resy.com/4/venue/calendar?venue_id=${venueId}&num_seats=${partySize}&start_date=${TODAY}&end_date=${end}`,
      { headers: getHeaders(), signal: AbortSignal.timeout(10000) }
    );
    if (resp.status === 500) return { success: false, error: 500, retriable: true };
    if (!resp.ok) return { success: false, error: resp.status };
    const data = await resp.json();
    const scheduled = data?.scheduled || [];
    if (scheduled.length === 0) return { success: true, not_bookable: true };
    const available = scheduled.find(s => s.inventory?.reservation === 'available');
    if (available) {
      const daysOut = Math.round((new Date(available.date) - new Date(TODAY)) / 86400000);
      return { success: true, opens_in: daysOut, first_date: available.date };
    }
    return { success: true, fully_locked: true };
  } catch (e) {
    return { success: false, error: e.message, retriable: true };
  }
}

// ── Puppeteer check ──
let browser = null;
let browserAge = 0;

async function ensureBrowser() {
  if (browser && browserAge < 25) return;
  if (browser) { try { await browser.close(); } catch {} }
  browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
    defaultViewport: { width: 1280, height: 800 },
  });
  browserAge = 0;
}

async function puppeteerCheck(slug, date, partySize) {
  await ensureBrowser();
  browserAge++;
  let page;
  try {
    page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36');

    let capturedSlots = null;
    page.on('response', async (resp) => {
      try {
        if (resp.url().includes('/4/find') && resp.status() === 200) {
          const data = await resp.json();
          const slots = data?.results?.venues?.[0]?.slots || [];
          capturedSlots = slots.map(s => ({ time: s.date?.start || '', type: s.config?.type || '' }));
        }
      } catch {}
    });

    const url = `https://resy.com/cities/new-york-ny/venues/${slug}?date=${date}&seats=${partySize}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(3000);

    // If we captured API response, use that
    if (capturedSlots !== null) {
      await page.close();
      return { success: true, slots: capturedSlots };
    }

    // Fallback: scrape buttons for time text
    const timeTexts = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      const times = [];
      buttons.forEach(b => {
        const text = b.textContent.trim();
        if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(text)) times.push(text);
      });
      return times;
    });

    if (timeTexts.length > 0) {
      const slots = timeTexts.map(t => {
        const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        let h = parseInt(m[1]);
        if (/PM/i.test(m[3]) && h !== 12) h += 12;
        if (/AM/i.test(m[3]) && h === 12) h = 0;
        return { time: `${date} ${String(h).padStart(2,'0')}:${m[2]}:00` };
      });
      await page.close();
      return { success: true, slots };
    }

    // Check for "Notify" or no availability indicators
    const pageText = await page.evaluate(() => document.body.innerText);
    if (pageText.includes('Notify') || pageText.includes('no availability') || pageText.includes('No availability')) {
      await page.close();
      return { success: true, slots: [] };
    }

    await page.close();
    return { success: false, error: 'no_data' };
  } catch (e) {
    if (page) try { await page.close(); } catch {}
    return { success: false, error: e.message };
  }
}

// ── Main ──
async function main() {
  log('═══════════════════════════════════════════════════');
  log('RESY AVAILABILITY CHECK — Limited & Booked');
  log(`Date: ${TODAY}  |  Log: ${LOG_FILE}`);
  log('═══════════════════════════════════════════════════\n');

  const bm = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
  const output = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));

  // Build list: limited + booked Resy restaurants
  const toCheck = [];
  for (const [key, val] of Object.entries(output)) {
    if (key.startsWith('_')) continue;
    if (val.tier !== 'booked' && val.tier !== 'limited') continue;
    const bmKey = Object.keys(bm).find(n => n.toLowerCase() === key.toLowerCase());
    if (!bmKey) continue;
    const entry = bm[bmKey];
    if (entry.platform !== 'resy' || !entry.url) continue;
    const slug = extractResySlug(entry.url);
    if (!slug) continue;
    toCheck.push({ name: bmKey, key: key.toLowerCase(), slug, bmEntry: entry, originalTier: val.tier });
  }

  log(`Found ${toCheck.length} restaurants (${toCheck.filter(r => r.originalTier === 'limited').length} limited, ${toCheck.filter(r => r.originalTier === 'booked').length} booked)\n`);

  const results = {}; // key → { tier, status, pass }
  const failed = [];  // items that had API errors (not real booked)

  // ════════════════════════════════════════════════════
  // PASS 1: API /4/find for all
  // ════════════════════════════════════════════════════
  log('────── PASS 1: API Check (/4/find) ──────');
  let p1_open = 0, p1_limited = 0, p1_booked = 0, p1_failed = 0;

  for (let i = 0; i < toCheck.length; i++) {
    const r = toCheck[i];
    const venueId = await resolveVenueId(r.slug, r.bmEntry);
    const result = await apiFind(venueId, r.slug, TODAY, 2);

    if (!result.success) {
      p1_failed++;
      failed.push(r);
      results[r.key] = { status: 'failed', error: result.error, pass: 1 };
      log(`  ❌ [${i+1}/${toCheck.length}] ${r.name}: FAILED (${result.error}) — was ${r.originalTier}`);
    } else {
      const cls = classifySlots(result.slots);
      results[r.key] = { ...cls, status: 'checked', pass: 1 };
      output[r.key] = { ...output[r.key], ...cls, _checked_date: TODAY };

      if (cls.tier === 'open') {
        p1_open++;
        delete output[r.key].opens_in;
        delete output[r.key].fully_locked;
        delete output[r.key].not_bookable;
        log(`  🟢 [${i+1}/${toCheck.length}] ${r.name}: OPENED (${cls.dinner_slots} dinner) [${cls.early}/${cls.prime}/${cls.late}] — was ${r.originalTier}`);
      } else if (cls.tier === 'limited') {
        p1_limited++;
        log(`  🟡 [${i+1}/${toCheck.length}] ${r.name}: LIMITED (${cls.dinner_slots} dinner) [${cls.early}/${cls.prime}/${cls.late}]`);
      } else {
        p1_booked++;
        log(`  ⚫ [${i+1}/${toCheck.length}] ${r.name}: BOOKED (0 slots)`);
      }
    }

    if ((i + 1) % 50 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
      log(`  💾 Progress saved (${i+1}/${toCheck.length})`);
    }
    await sleep(5000);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  log(`\n📊 Pass 1: 🟢 ${p1_open} opened | 🟡 ${p1_limited} limited | ⚫ ${p1_booked} booked | ❌ ${p1_failed} failed\n`);

  // ════════════════════════════════════════════════════
  // PASS 2: Puppeteer retry for failed
  // ════════════════════════════════════════════════════
  if (failed.length > 0) {
    log(`────── PASS 2: Puppeteer Retry (${failed.length} failed) ──────`);
    resetPuppeteerBail();
    let p2_open = 0, p2_limited = 0, p2_booked = 0, p2_failed = 0, p2_skipped = 0;

    for (let i = 0; i < failed.length; i++) {
      if (puppeteerBurnt) { p2_skipped++; continue; }
      const r = failed[i];
      const result = await puppeteerCheck(r.slug, TODAY, 2);

      if (!result.success) {
        p2_failed++;
        trackPuppeteerResult(false);
        results[r.key] = { status: 'failed', error: result.error, pass: 2 };
        log(`  ❌ [${i+1}/${failed.length}] ${r.name}: STILL FAILED (${result.error})`);
      } else {
        trackPuppeteerResult(true);
        const cls = classifySlots(result.slots);
        results[r.key] = { ...cls, status: 'checked', pass: 2 };
        output[r.key] = { ...output[r.key], ...cls, _checked_date: TODAY };
        const icon = cls.tier === 'open' ? '🟢' : cls.tier === 'limited' ? '🟡' : '⚫';
        if (cls.tier === 'open') p2_open++;
        else if (cls.tier === 'limited') p2_limited++;
        else p2_booked++;
        log(`  ${icon} [${i+1}/${failed.length}] ${r.name}: ${cls.tier.toUpperCase()} (${cls.dinner_slots} dinner)`);
      }
      await sleep(5000);
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    log(`\n📊 Pass 2: 🟢 ${p2_open} opened | 🟡 ${p2_limited} limited | ⚫ ${p2_booked} booked | ❌ ${p2_failed} failed${p2_skipped ? ' | ⏭️ ' + p2_skipped + ' skipped (burnt)' : ''}\n`);
  }

  // ════════════════════════════════════════════════════
  // PASS 3: Calendar API for still-booked
  // ════════════════════════════════════════════════════
  const stillBooked = toCheck.filter(r => results[r.key]?.tier === 'booked');
  if (stillBooked.length > 0) {
    log(`────── PASS 3: Calendar API — Future Availability (${stillBooked.length} booked) ──────`);
    let p3_future = 0, p3_locked = 0, p3_notbookable = 0, p3_failed = 0;
    const calFailed = [];

    for (let i = 0; i < stillBooked.length; i++) {
      const r = stillBooked[i];
      const venueId = venueCache[r.slug] || await resolveVenueId(r.slug, r.bmEntry);
      if (!venueId) {
        p3_failed++;
        calFailed.push(r);
        log(`  ❌ [${i+1}/${stillBooked.length}] ${r.name}: no venue ID`);
        await sleep(5000);
        continue;
      }

      const result = await apiCalendar(venueId, 2);

      if (!result.success) {
        p3_failed++;
        calFailed.push(r);
        log(`  ❌ [${i+1}/${stillBooked.length}] ${r.name}: calendar FAILED (${result.error})`);
      } else if (result.not_bookable) {
        p3_notbookable++;
        output[r.key].not_bookable = true;
        log(`  ⚪ [${i+1}/${stillBooked.length}] ${r.name}: not bookable (walk-in/events)`);
      } else if (result.opens_in) {
        p3_future++;
        output[r.key].opens_in = result.opens_in;
        delete output[r.key].fully_locked;
        log(`  🟢 [${i+1}/${stillBooked.length}] ${r.name}: opens in +${result.opens_in}d (${result.first_date})`);
      } else {
        p3_locked++;
        output[r.key].fully_locked = true;
        log(`  🔒 [${i+1}/${stillBooked.length}] ${r.name}: locked (no future slots)`);
      }

      if ((i + 1) % 50 === 0) {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
        log(`  💾 Progress saved`);
      }
      await sleep(5000);
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    log(`\n📊 Pass 3: 🟢 ${p3_future} future | 🔒 ${p3_locked} locked | ⚪ ${p3_notbookable} not bookable | ❌ ${p3_failed} failed\n`);

    // ════════════════════════════════════════════════════
    // PASS 4: Puppeteer for calendar failures
    // ════════════════════════════════════════════════════
    if (calFailed.length > 0) {
      log(`────── PASS 4: Puppeteer — Calendar Failures (${calFailed.length}) ──────`);
      resetPuppeteerBail();
      let p4_open = 0, p4_booked = 0, p4_failed = 0, p4_skipped = 0;

      for (let i = 0; i < calFailed.length; i++) {
        if (puppeteerBurnt) { p4_skipped++; continue; }
        const r = calFailed[i];
        const futureDate = new Date(); futureDate.setDate(futureDate.getDate() + 7);
        const fd = futureDate.toISOString().split('T')[0];
        const result = await puppeteerCheck(r.slug, fd, 2);

        if (!result.success) {
          p4_failed++;
          trackPuppeteerResult(false);
          log(`  ❌ [${i+1}/${calFailed.length}] ${r.name}: FAILED (${result.error})`);
        } else if (result.slots.length > 0) {
          p4_open++;
          trackPuppeteerResult(true);
          output[r.key].opens_in = 7;
          delete output[r.key].fully_locked;
          log(`  🟢 [${i+1}/${calFailed.length}] ${r.name}: has slots +7d (${result.slots.length} slots)`);
        } else {
          p4_booked++;
          trackPuppeteerResult(true);
          output[r.key].fully_locked = true;
          log(`  🔒 [${i+1}/${calFailed.length}] ${r.name}: locked (+7d also empty)`);
        }
        await sleep(5000);
      }

      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
      log(`\n📊 Pass 4: 🟢 ${p4_open} future | 🔒 ${p4_booked} locked | ❌ ${p4_failed} failed${p4_skipped ? ' | ⏭️ ' + p4_skipped + ' skipped (burnt)' : ''}\n`);
    }
  }

  // ════════════════════════════════════════════════════
  // PASS 5: API retry — anything still failed from Pass 1+2
  // ════════════════════════════════════════════════════
  const stillFailed = toCheck.filter(r => results[r.key]?.status === 'failed');
  if (stillFailed.length > 0) {
    log(`────── PASS 5: API Retry (${stillFailed.length} still failed) ──────`);
    let p5_resolved = 0, p5_failed = 0;

    for (let i = 0; i < stillFailed.length; i++) {
      const r = stillFailed[i];
      const venueId = venueCache[r.slug] || await resolveVenueId(r.slug, r.bmEntry);
      const result = await apiFind(venueId, r.slug, TODAY, 2);

      if (result.success) {
        p5_resolved++;
        const cls = classifySlots(result.slots);
        results[r.key] = { ...cls, status: 'checked', pass: 5 };
        output[r.key] = { ...output[r.key], ...cls, _checked_date: TODAY };
        const icon = cls.tier === 'open' ? '🟢' : cls.tier === 'limited' ? '🟡' : '⚫';
        log(`  ${icon} [${i+1}/${stillFailed.length}] ${r.name}: ${cls.tier.toUpperCase()} (${cls.dinner_slots} dinner)`);
      } else {
        p5_failed++;
        log(`  ❌ [${i+1}/${stillFailed.length}] ${r.name}: STILL FAILED (${result.error})`);
      }
      await sleep(5000);
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    log(`\n📊 Pass 5: ✅ ${p5_resolved} resolved | ❌ ${p5_failed} still failed\n`);
  }

  // ════════════════════════════════════════════════════
  // PASS 6: Puppeteer confirm ALL booked solid
  // ════════════════════════════════════════════════════
  const allBooked = toCheck.filter(r => results[r.key]?.tier === 'booked');
  if (allBooked.length > 0) {
    log(`────── PASS 6: Puppeteer Confirm Booked Solid (${allBooked.length}) ──────`);
    resetPuppeteerBail();
    let p6_actually_open = 0, p6_confirmed = 0, p6_failed = 0, p6_skipped = 0;

    for (let i = 0; i < allBooked.length; i++) {
      if (puppeteerBurnt) { p6_skipped++; continue; }
      const r = allBooked[i];
      const result = await puppeteerCheck(r.slug, TODAY, 2);

      if (!result.success) {
        p6_failed++;
        trackPuppeteerResult(false);
        log(`  ❓ [${i+1}/${allBooked.length}] ${r.name}: Puppeteer FAILED (${result.error}) — keeping booked`);
      } else if (result.slots.length > 0) {
        p6_actually_open++;
        trackPuppeteerResult(true);
        const cls = classifySlots(result.slots);
        results[r.key] = { ...cls, status: 'checked', pass: 6 };
        output[r.key] = { ...output[r.key], ...cls, _checked_date: TODAY };
        log(`  🟢 [${i+1}/${allBooked.length}] ${r.name}: ACTUALLY ${cls.tier.toUpperCase()} (${cls.dinner_slots} dinner) — API was wrong!`);
      } else {
        p6_confirmed++;
        trackPuppeteerResult(true);
        log(`  ⚫ [${i+1}/${allBooked.length}] ${r.name}: confirmed booked`);
      }

      if ((i + 1) % 50 === 0) {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
        log(`  💾 Progress saved`);
      }
      await sleep(5000);
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    log(`\n📊 Pass 6: 🟢 ${p6_actually_open} actually open! | ⚫ ${p6_confirmed} confirmed booked | ❓ ${p6_failed} failed${p6_skipped ? ' | ⏭️ ' + p6_skipped + ' skipped (burnt)' : ''}\n`);
  }

  // ════════════════════════════════════════════════════
  // PASS 7: Final sweep — any remaining failures
  // ════════════════════════════════════════════════════
  const finalFailed = toCheck.filter(r => results[r.key]?.status === 'failed');
  if (finalFailed.length > 0) {
    log(`────── PASS 7: Final Sweep (${finalFailed.length} remaining) ──────`);
    let p7_resolved = 0, p7_failed = 0;

    for (let i = 0; i < finalFailed.length; i++) {
      const r = finalFailed[i];
      // Try API one more time
      const venueId = venueCache[r.slug] || await resolveVenueId(r.slug, r.bmEntry);
      let result = await apiFind(venueId, r.slug, TODAY, 2);

      if (!result.success) {
        // Last resort: Puppeteer
        result = await puppeteerCheck(r.slug, TODAY, 2);
      }

      if (result.success) {
        p7_resolved++;
        const cls = classifySlots(result.slots);
        results[r.key] = { ...cls, status: 'checked', pass: 7 };
        output[r.key] = { ...output[r.key], ...cls, _checked_date: TODAY };
        const icon = cls.tier === 'open' ? '🟢' : cls.tier === 'limited' ? '🟡' : '⚫';
        log(`  ${icon} [${i+1}/${finalFailed.length}] ${r.name}: ${cls.tier.toUpperCase()}`);
      } else {
        p7_failed++;
        results[r.key] = { status: 'failed', pass: 7 };
        log(`  ❌ [${i+1}/${finalFailed.length}] ${r.name}: PERMANENTLY FAILED`);
      }
      await sleep(5000);
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    log(`\n📊 Pass 7: ✅ ${p7_resolved} resolved | ❌ ${p7_failed} permanently failed\n`);
  }

  // ════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ════════════════════════════════════════════════════
  const final = {
    open: toCheck.filter(r => results[r.key]?.tier === 'open').length,
    limited: toCheck.filter(r => results[r.key]?.tier === 'limited').length,
    booked: toCheck.filter(r => results[r.key]?.tier === 'booked').length,
    failed: toCheck.filter(r => results[r.key]?.status === 'failed').length,
  };

  // Update metadata
  output._meta = {
    last_run: TODAY,
    checked_date: TODAY,
    party_size: 2,
    checked: toCheck.length - final.failed,
    failed: final.failed,
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  log('═══════════════════════════════════════════════════');
  log('FINAL RESULTS');
  log(`  🟢 Open: ${final.open}  |  🟡 Limited: ${final.limited}  |  ⚫ Booked: ${final.booked}  |  ❌ Failed: ${final.failed}`);
  log(`  Total checked: ${toCheck.length}`);
  log(`  Saved → ${OUTPUT_FILE}`);
  log(`  Log → ${LOG_FILE}`);
  log('═══════════════════════════════════════════════════');

  if (browser) try { await browser.close(); } catch {}
}

main().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
