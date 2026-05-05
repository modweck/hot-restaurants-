/**
 * sniper-template-v2.js — Resy Sniper Template v2 (Hybrid API + 2Captcha + File Logging)
 *
 * USAGE: Copy this file, fill in the config below, and run.
 * Proven: booked Four Horsemen in 2.7s.
 *
 * RUN: node scripts/sniper-template-v2.js
 */

const puppeteer = require('puppeteer-core');
const { homedir } = require('os');
const { execSync } = require('child_process');

// ═══════════════════════════════════════════════════════════════════
// ██ FILL IN THESE VALUES ██
// ═══════════════════════════════════════════════════════════════════
const VENUE_SLUG = 'RESTAURANT-SLUG-HERE';    // e.g. 'torrisi', 'the-four-horsemen'
const VENUE_ID = 0;                            // e.g. 64593 (find via /3/venue API)
const TARGET_DATE = '2026-00-00';              // e.g. '2026-05-08'
const PARTY_SIZE = 2;                          // e.g. 2, 4
const DROP_HOUR = 10;                          // e.g. 9, 10 (24h format)
const DROP_MINUTE = 0;                         // usually 0
// ═══════════════════════════════════════════════════════════════════
const API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
// uid 64692867
const AUTH_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3ODE4NzcwMDEsInVpZCI6NjQ3MzQ1NTgsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTM1MTEzMDV9fQ.AOlKh4ANqfmn4d15NBxgPMa6jLS7lgXTJ_9e-3uRMkUUl_SZi_5nI6bA4qBvXO-FgM8HMJXEYokbe0cP9lAim5LSAbxkhpiKzC1JpPV4PCUTJ7TKc2BuAyFdLxOHh7BvGLjprkYkeyQYCqxmCK6m0DIEG5ueF4l6CyzVbjMvlmu584lY';
const PAYMENT_METHOD_ID = 34876858; // Mastercard ending 3162

const CAPTCHA_KEY = 'c9f9650dcc39ce04c40e5414c201836a';
const SITEKEY = '6Lfw-dIZAAAAAESRBH4JwdgfTXj5LlS1ewlvvCYe';

const HEADERS = {
  'Authorization': `ResyAPI api_key="${API_KEY}"`,
  'X-Resy-Auth-Token': AUTH_TOKEN,
  'X-Resy-Universal-Auth': AUTH_TOKEN,
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Origin': 'https://resy.com',
  'Referer': 'https://resy.com/',
  'Accept': 'application/json, text/plain, */*',
};

const fs = require('fs');
const LOG_FILE = require('path').join(__dirname, '..', `sniper-torrisi-${TARGET_DATE}.log`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(msg) {
  const now = new Date();
  const ts = now.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch(e) {}
}

async function solveCaptcha() {
  try {
    const submitResp = JSON.parse(execSync(
      `curl -s "http://2captcha.com/in.php?key=${CAPTCHA_KEY}&method=userrecaptcha&googlekey=${SITEKEY}&pageurl=https://resy.com/cities/new-york-ny/venues/${VENUE_SLUG}&json=1"`,
      { encoding: 'utf8' }
    ));
    if (submitResp.status !== 1) return null;
    const taskId = submitResp.request;

    for (let i = 0; i < 30; i++) {
      await sleep(5000);
      const resp = JSON.parse(execSync(
        `curl -s "http://2captcha.com/res.php?key=${CAPTCHA_KEY}&action=get&id=${taskId}&json=1"`,
        { encoding: 'utf8' }
      ));
      if (resp.status === 1) return resp.request;
      if (resp.request !== 'CAPCHA_NOT_READY') return null;
    }
  } catch (e) {
    log(`Captcha error: ${e.message}`);
  }
  return null;
}

async function apiFind() {
  const t0 = Date.now();
  try {
    const resp = await fetch(
      `https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${TARGET_DATE}&party_size=${PARTY_SIZE}&venue_id=${VENUE_ID}`,
      { headers: HEADERS }
    );
    if (!resp.ok) return { found: false, error: resp.status, ms: Date.now() - t0 };
    const data = await resp.json();
    const slots = data?.results?.venues?.[0]?.slots || [];
    if (!slots.length) return { found: false, slotCount: 0, ms: Date.now() - t0 };

    // Collect all slot times for logging
    const allTimes = slots.map(s => (s.date?.start || '').match(/(\d{2}:\d{2})/)?.[1]).filter(Boolean);

    let pick = null;
    const TARGET_HOUR = 21;
    const TARGET_MIN = 0;
    const targetMins = TARGET_HOUR * 60 + TARGET_MIN;
    const targetTimeStr = `${String(TARGET_HOUR).padStart(2, '0')}:${String(TARGET_MIN).padStart(2, '0')}`;

    // Priority 1: exact 9:00 PM
    for (const s of slots) { if ((s.date?.start || '').includes(targetTimeStr)) { pick = s; break; } }

    // Priority 2: closest to 9pm, going lower first (8:30, 8:00, 7:30...)
    if (!pick) {
      const evening = slots.filter(s => {
        const hm = (s.date?.start || '').match(/(\d{2}):(\d{2})/);
        return hm && parseInt(hm[1]) >= 17;
      }).sort((a, b) => {
        const ha = (a.date?.start || '').match(/(\d{2}):(\d{2})/);
        const hb = (b.date?.start || '').match(/(\d{2}):(\d{2})/);
        const aDiff = Math.abs(parseInt(ha[1]) * 60 + parseInt(ha[2]) - targetMins);
        const bDiff = Math.abs(parseInt(hb[1]) * 60 + parseInt(hb[2]) - targetMins);
        return aDiff - bDiff;
      });
      if (evening.length) pick = evening[0];
    }

    // NO last resort — only 5pm+ slots
    if (!pick) return { found: false, slotCount: slots.length, noEveningSlots: true, allTimes, ms: Date.now() - t0 };

    return { found: true, time: pick.date?.start, configToken: pick.config?.token, slotCount: slots.length, allTimes, ms: Date.now() - t0 };
  } catch (e) {
    return { found: false, error: e.message, ms: Date.now() - t0 };
  }
}

async function apiDetails(configToken, captchaToken) {
  const t0 = Date.now();
  try {
    const body = { config_id: configToken, day: TARGET_DATE, party_size: PARTY_SIZE };
    if (captchaToken) body.captcha_token = captchaToken;

    const fs = require('fs');
    fs.writeFileSync('/tmp/resy_captcha_body.json', JSON.stringify(body));

    const result = execSync(
      `curl -s -X POST 'https://api.resy.com/3/details' ` +
      `-H 'Authorization: ResyAPI api_key="${API_KEY}"' ` +
      `-H 'X-Resy-Auth-Token: ${AUTH_TOKEN}' ` +
      `-H 'X-Resy-Universal-Auth: ${AUTH_TOKEN}' ` +
      `-H 'Origin: https://resy.com' ` +
      `-H 'Referer: https://resy.com/' ` +
      `-H 'Content-Type: application/json' ` +
      `-d @/tmp/resy_captcha_body.json`,
      { encoding: 'utf8', timeout: 10000 }
    );

    const data = JSON.parse(result);
    return { success: !!data?.book_token?.value, bookToken: data?.book_token?.value, ms: Date.now() - t0 };
  } catch (e) {
    return { success: false, error: e.message.substring(0, 150), ms: Date.now() - t0 };
  }
}

async function apiBook(bookToken) {
  const t0 = Date.now();
  try {
    const h = Object.assign({}, HEADERS);
    h['Content-Type'] = 'application/x-www-form-urlencoded';
    delete h['Accept'];
    const paymentMethod = JSON.stringify({"id": PAYMENT_METHOD_ID});
    const resp = await fetch('https://api.resy.com/3/book', {
      method: 'POST', headers: h, body: `book_token=${encodeURIComponent(bookToken)}&struct_payment_method=${encodeURIComponent(paymentMethod)}`,
    });
    const data = await resp.json();
    return {
      success: resp.status === 201 || !!data?.resy_token,
      status: resp.status, resyToken: data?.resy_token || null,
      error: data?.message || null, ms: Date.now() - t0,
    };
  } catch (e) {
    return { success: false, error: e.message, ms: Date.now() - t0 };
  }
}

async function main() {
  log('TORRISI SNIPER — Hybrid API + 2Captcha');
  log(`   Target: ${TARGET_DATE} — 9:00 PM (fallback closest to 9pm, going lower)`);
  log(`   Party: ${PARTY_SIZE}`);
  log(`   Drop: ${DROP_HOUR}:00 AM`);
  log(`   Log file: ${LOG_FILE}`);
  log('');

  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: false,
    userDataDir: `${homedir()}/.resy-sniper-profile-torrisi`,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled', '--start-maximized'],
    defaultViewport: null,
  });

  let page = (await browser.pages())[0] || await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const resyUrl = `https://resy.com/cities/new-york-ny/venues/${VENUE_SLUG}?date=${TARGET_DATE}&seats=${PARTY_SIZE}`;

  const now = new Date();
  const drop = new Date(now);
  drop.setHours(DROP_HOUR, DROP_MINUTE, 0, 0);
  if (drop <= now) drop.setDate(drop.getDate() + 1);

  const openAt = new Date(drop.getTime() - 5 * 60 * 1000);
  if (openAt > new Date()) {
    log('Waiting to open browser...');
    while (new Date() < openAt) {
      const remaining = openAt - new Date();
      if (remaining > 60000) { log(`   ${Math.round(remaining / 60000)} min...`); await sleep(30000); }
      else if (remaining > 5000) { log(`   ${Math.round(remaining / 1000)}s...`); await sleep(5000); }
      else await sleep(500);
    }
  }

  log('Opening Resy — log in if needed');
  await page.goto(resyUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  log('Browser ready');

  // Wait until 3min before drop to solve first batch of captchas
  const solveAt = new Date(drop.getTime() - 180000);
  if (solveAt > new Date()) {
    log('Waiting to solve captchas...');
    while (new Date() < solveAt) {
      const remaining = drop - new Date();
      if (remaining > 60000) { log(`   ${Math.round(remaining / 60000)} min...`); await sleep(30000); }
      else if (remaining > 40000) { log(`   ${Math.round(remaining / 1000)}s...`); await sleep(5000); }
      else await sleep(500);
    }
  }

  // ── PHASE 0: Pre-solve captchas in 2 waves ──
  // Wave 1: 4 captchas ~3min before drop
  log('PHASE 0: Wave 1 — solving 4 captchas in parallel...');
  const solveStart = Date.now();

  const wave1 = await Promise.all([
    solveCaptcha().then(t => { log(`   Captcha 1: ${t ? 'READY' : 'FAILED'} (${((Date.now() - solveStart) / 1000).toFixed(0)}s)`); return t; }),
    solveCaptcha().then(t => { log(`   Captcha 2: ${t ? 'READY' : 'FAILED'} (${((Date.now() - solveStart) / 1000).toFixed(0)}s)`); return t; }),
    solveCaptcha().then(t => { log(`   Captcha 3: ${t ? 'READY' : 'FAILED'} (${((Date.now() - solveStart) / 1000).toFixed(0)}s)`); return t; }),
    solveCaptcha().then(t => { log(`   Captcha 4: ${t ? 'READY' : 'FAILED'} (${((Date.now() - solveStart) / 1000).toFixed(0)}s)`); return t; }),
  ]);

  // Wave 2: 2 fresh captchas ~90s before drop (these will be freshest at drop time)
  const wave2At = new Date(drop.getTime() - 90000);
  if (wave2At > new Date()) {
    log('Waiting for wave 2...');
    while (new Date() < wave2At) await sleep(1000);
  }
  log('PHASE 0: Wave 2 — solving 2 fresh captchas...');
  const solve2Start = Date.now();
  const wave2 = await Promise.all([
    solveCaptcha().then(t => { log(`   Captcha 5: ${t ? 'READY' : 'FAILED'} (${((Date.now() - solve2Start) / 1000).toFixed(0)}s)`); return t; }),
    solveCaptcha().then(t => { log(`   Captcha 6: ${t ? 'READY' : 'FAILED'} (${((Date.now() - solve2Start) / 1000).toFixed(0)}s)`); return t; }),
  ]);

  // Freshest tokens first (wave 2), then wave 1
  const captchaTokens = [...wave2, ...wave1].filter(Boolean);
  log(`${captchaTokens.length} captcha token(s) ready`);

  if (captchaTokens.length === 0) {
    log('All captchas failed — will try without + browser fallback');
  }

  // Wait until 1s before drop
  const startAt = drop.getTime() - 1000;
  if (startAt > Date.now()) {
    log('Waiting for drop...');
    while (Date.now() < startAt) {
      const remaining = drop.getTime() - Date.now();
      if (remaining > 5000) await sleep(1000);
      else await sleep(100);
    }
  }

  // ── PHASE 1: Find ──
  log('PHASE 1: API polling...');
  let slot = null;

  for (let i = 0; i < 8; i++) {
    const result = await apiFind();
    if (result.found) {
      slot = result;
      log(`FOUND: ${result.time} (${result.slotCount} slots, ${result.ms}ms)`);
      if (result.allTimes?.length) log(`   ALL SLOTS: ${result.allTimes.join(', ')}`);
      break;
    }
    let msg = result.error ? 'error ' + result.error : result.noEveningSlots ? `${result.slotCount} slots but none 5:30pm+` : 'no slots';
    if (result.allTimes?.length) msg += ` [${result.allTimes.join(', ')}]`;
    log(`Check ${i + 1}/8: ${msg} (${result.ms}ms)`);
    if (i < 3) await sleep(500);
  }

  if (!slot) {
    log('No slots found. Browser fallback.');
    await page.goto(resyUrl, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    log('BOOK MANUALLY NOW!');
    await new Promise(() => {});
  }

  // ── PHASE 2+3: Details + Book ──
  for (let t = 0; t < Math.max(captchaTokens.length, 1); t++) {
    const captchaToken = captchaTokens[t] || null;
    log(`PHASE 2: Details (token ${t + 1}/${captchaTokens.length || 1})...`);

    const details = await apiDetails(slot.configToken, captchaToken);
    if (!details.success) {
      log(`Details FAILED: ${details.status} — ${details.error} (${details.ms}ms)`);
      if (t < captchaTokens.length - 1) { log('Trying next token...'); continue; }
      log('All tokens exhausted — browser fallback.');
      await page.goto(resyUrl, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
      log('BOOK MANUALLY NOW!');
      await new Promise(() => {});
    }

    log(`Book token ready (${details.ms}ms)`);
    log('PHASE 3: Booking...');
    const book = await apiBook(details.bookToken);

    if (book.success) {
      log('');
      log('RESERVATION BOOKED!');
      log(`   Torrisi — ${TARGET_DATE} at ${slot.time}`);
      log(`   Party of ${PARTY_SIZE}`);
      log(`   Resy token: ${book.resyToken}`);
      log(`   find=${slot.ms}ms + details=${details.ms}ms + book=${book.ms}ms`);
      log('   Check your Resy app!');
      break;
    } else {
      log(`Book FAILED: ${book.status} — ${book.error} (${book.ms}ms)`);
      if (t < captchaTokens.length - 1) { log('Trying next token...'); continue; }
      log('Browser fallback.');
      await page.goto(resyUrl, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
      log('BOOK MANUALLY NOW!');
    }
  }

  log('Browser stays open. Ctrl+C to exit.');
  await new Promise(() => {});
}

main().catch(e => { log('Fatal: ' + e.message); });
