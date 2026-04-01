/**
 * sniper-four-horsemen.js — Full Hybrid Sniper with 2Captcha
 *
 * Same approach as sniper-torrisi.js but for Four Horsemen, 7 AM drop.
 *
 * RUN: node scripts/sniper-four-horsemen.js
 */

const puppeteer = require('puppeteer-core');
const { homedir } = require('os');
const { execSync } = require('child_process');

// ── Config ──
const VENUE_SLUG = 'the-four-horsemen';
const VENUE_ID = 2492;
const TARGET_DATE = '2026-04-29';
const PARTY_SIZE = 2;
const DROP_HOUR = 7;
const DROP_MINUTE = 0;
const API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
// Ben (uid 64616650) — fresh token
const AUTH_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzg3Mjg5NjAsInVpZCI6NjQ2MTY2NTAsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTMxOTk0NzJ9fQ.AV3irw2XU4oZ8xB_lUKkbSqrLMmIYyjWZ2ZJA4hlYHJrxFsRGeFhFknhfAKOMb3k-fvWKBeyhEEBICqcjJMkjnHdATeYjRyaLYqq8hDwQsLHbEaPv5Sx6kl_RT6bv_G5DS8CBso6tyzFICeaBGXf3nZiiMdI04lEpg8b-Rsihj6FK9bB';

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(msg) {
  const now = new Date();
  const ts = now.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
  console.log(`[${ts}] ${msg}`);
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

    let pick = null;
    // Priority: 6:00 PM, then any slot
    for (const s of slots) { if ((s.date?.start || '').includes('18:00')) { pick = s; break; } }
    if (!pick) pick = slots[0]; // grab anything available

    return { found: true, time: pick.date?.start, configToken: pick.config?.token, slotCount: slots.length, ms: Date.now() - t0 };
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
    const resp = await fetch('https://api.resy.com/3/book', {
      method: 'POST', headers: h, body: `book_token=${encodeURIComponent(bookToken)}`,
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
  log('FOUR HORSEMEN SNIPER — Hybrid API + 2Captcha');
  log(`   Target: ${TARGET_DATE} — 6:00 PM (fallback any time)`);
  log(`   Party: ${PARTY_SIZE}`);
  log(`   Drop: ${DROP_HOUR}:00 AM`);
  log('');

  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: false,
    userDataDir: `${homedir()}/.resy-sniper-profile-horsemen`,
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

  // Wait until 35s before drop to solve captchas
  const solveAt = new Date(drop.getTime() - 120000); // 2 min before drop
  if (solveAt > new Date()) {
    log(`Waiting to solve captchas...`);
    while (new Date() < solveAt) {
      const remaining = drop - new Date();
      if (remaining > 60000) { log(`   ${Math.round(remaining / 60000)} min...`); await sleep(30000); }
      else if (remaining > 40000) { log(`   ${Math.round(remaining / 1000)}s...`); await sleep(5000); }
      else await sleep(500);
    }
  }

  // ── PHASE 0: Pre-solve captchas ──
  log('PHASE 0: Solving 2 captchas in parallel...');
  const solveStart = Date.now();

  const [token1, token2] = await Promise.all([
    solveCaptcha().then(t => { log(`   Captcha 1: ${t ? 'READY' : 'FAILED'} (${((Date.now() - solveStart) / 1000).toFixed(0)}s)`); return t; }),
    solveCaptcha().then(t => { log(`   Captcha 2: ${t ? 'READY' : 'FAILED'} (${((Date.now() - solveStart) / 1000).toFixed(0)}s)`); return t; }),
  ]);

  const captchaTokens = [token1, token2].filter(Boolean);
  log(`${captchaTokens.length} captcha token(s) ready`);

  if (captchaTokens.length === 0) {
    log('Both captchas failed — will try without + browser fallback');
  }

  // Wait until 500ms before drop
  const startAt = drop.getTime() - 500;
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

  for (let i = 0; i < 4; i++) {
    const result = await apiFind();
    if (result.found) {
      slot = result;
      log(`FOUND: ${result.time} (${result.slotCount} slots, ${result.ms}ms)`);
      break;
    }
    log(`Check ${i + 1}/4: ${result.error ? 'error ' + result.error : 'no slots'} (${result.ms}ms)`);
    if (i < 3) await sleep(500);
  }

  if (!slot) {
    log('No slots found. Browser fallback.');
    await page.goto(resyUrl, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
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
      log(`   Four Horsemen — ${TARGET_DATE} at ${slot.time}`);
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
