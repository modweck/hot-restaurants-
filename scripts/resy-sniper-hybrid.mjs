/**
 * resy-sniper-hybrid.mjs
 *
 * APPROACH 2: Hybrid — uses fast API calls for finding slots + getting tokens,
 * but opens a real browser to solve reCAPTCHA when needed.
 *
 * Flow:
 *   1. API: Find slots (fast, no captcha needed)
 *   2. API: Get book_token via /3/details (fast, no captcha needed)
 *   3. API: Try /3/book — if captcha blocks it...
 *   4. BROWSER: Open Resy page with the slot pre-selected, let reCAPTCHA
 *      pass via real browser, complete booking in browser
 *
 * USAGE:
 *   node scripts/resy-sniper-hybrid.mjs --slug torrisi --date 2026-04-23 --party 2 --drop-time "10:00"
 */

import { execSync } from 'child_process';
import { homedir } from 'os';
import { existsSync } from 'fs';

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}

const SLUG = getArg('slug', null);
const TARGET_DATE = getArg('date', null);
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);
const EARLIEST = getArg('earliest', '17:00');
const LATEST = getArg('latest', '22:00');
const DROP_TIME = getArg('drop-time', '10:00');
const DRY_RUN = args.includes('--dry-run');

if (!SLUG || !TARGET_DATE) {
  console.error('Usage: node resy-sniper-hybrid.mjs --slug <slug> --date <YYYY-MM-DD> --party <n>');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const AUTH = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3NzgyNDgwNDUsInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.ALJ6I2NlbwJgN-vRIPd1Pw6CS8CWz9Pec34WwxNoDIFku1ycNsUOEbs9Ejbg2qZznEW4Dqcmw39o2hGmAr7FGW0IAJBTi587PJjzKz8DaqQDpQm6UhGdbo2gSGqOnJXKJRhxrJtN4EsMa2cSGWf0Zl3gt0ZhnwOW5zxy4apWuU9JiT5k';

// Use curl for API calls (Node fetch gets rate limited differently)
function curlGet(url) {
  return JSON.parse(execSync(
    `curl -s "${url}" -H 'Authorization: ResyAPI api_key="${KEY}"' -H 'Origin: https://resy.com'`,
    { encoding: 'utf8', timeout: 15000 }
  ));
}

function curlPostJson(url, data) {
  const body = JSON.stringify(data).replace(/'/g, "'\\''");
  return JSON.parse(execSync(
    `curl -s -X POST "${url}" ` +
    `-H 'Authorization: ResyAPI api_key="${KEY}"' ` +
    `-H 'X-Resy-Auth-Token: ${AUTH}' ` +
    `-H 'X-Resy-Universal-Auth: ${AUTH}' ` +
    `-H 'Origin: https://resy.com' ` +
    `-H 'Content-Type: application/json' ` +
    `-d '${body}'`,
    { encoding: 'utf8', timeout: 15000 }
  ));
}

function curlPostForm(url, params) {
  const parts = Object.entries(params).map(([k, v]) => `--data-urlencode '${k}=${v}'`).join(' ');
  return execSync(
    `curl -s -X POST "${url}" ` +
    `-H 'Authorization: ResyAPI api_key="${KEY}"' ` +
    `-H 'X-Resy-Auth-Token: ${AUTH}' ` +
    `-H 'X-Resy-Universal-Auth: ${AUTH}' ` +
    `-H 'Origin: https://resy.com' ` +
    `-H 'Content-Type: application/x-www-form-urlencoded' ` +
    parts,
    { encoding: 'utf8', timeout: 15000 }
  );
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

const EARLIEST_MIN = timeToMinutes(EARLIEST);
const LATEST_MIN = timeToMinutes(LATEST);

async function main() {
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  🎯 RESY SNIPER — HYBRID MODE`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`  Slug:      ${SLUG}`);
  console.log(`  Date:      ${TARGET_DATE}`);
  console.log(`  Party:     ${PARTY_SIZE}`);
  console.log(`  Window:    ${EARLIEST} - ${LATEST}`);
  console.log(`  Drop:      ${DROP_TIME}`);
  console.log(`  Mode:      ${DRY_RUN ? '🧪 DRY RUN' : '🔴 LIVE'}`);
  console.log(`${'═'.repeat(50)}\n`);

  // ── Resolve venue ───────────────────────────────────────────────────────
  console.log('🔍 Resolving venue...');
  const venue = curlGet(`https://api.resy.com/3/venue?url_slug=${SLUG}&location=new-york-ny`);
  const venueId = venue?.id?.resy;
  const hasCaptcha = venue?.feature_recaptcha;
  console.log(`✅ ${venue.name} (ID: ${venueId})`);
  console.log(`   reCAPTCHA: ${hasCaptcha ? '⚠️ YES' : '✅ NO'}`);

  // ── Wait for drop ───────────────────────────────────────────────────────
  const [dropH, dropM] = DROP_TIME.split(':').map(Number);
  const now = new Date();
  const drop = new Date(now);
  drop.setHours(dropH, dropM, 0, 0);

  if (drop > now) {
    const msUntil = drop - now;
    console.log(`\n⏰ Waiting ${Math.ceil(msUntil / 60000)} min until ${DROP_TIME}...`);

    // Wait until 2 seconds before
    const waitMs = msUntil - 2000;
    if (waitMs > 0) {
      const interval = setInterval(() => {
        const r = drop - new Date();
        if (r > 0) {
          process.stdout.write(`\r   ⏳ ${Math.floor(r / 60000)}m ${Math.floor((r % 60000) / 1000)}s...     `);
        }
      }, 15000);
      await sleep(waitMs);
      clearInterval(interval);
    }
    console.log('\n');
  }

  // ── SNIPE ───────────────────────────────────────────────────────────────
  console.log(`🚀 SNIPING at ${new Date().toISOString()}\n`);

  const MAX_ATTEMPTS = 15;
  let browserLaunched = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    process.stdout.write(`  [${attempt}/${MAX_ATTEMPTS}] `);

    try {
      // 1. Find slots
      const findData = curlGet(
        `https://api.resy.com/4/find?venue_id=${venueId}&day=${TARGET_DATE}&party_size=${PARTY_SIZE}&lat=40.7128&long=-74.006`
      );
      const allSlots = findData?.results?.venues?.[0]?.slots || [];

      if (allSlots.length === 0) {
        console.log('— no slots');
        await sleep(1000);
        continue;
      }

      // 2. Filter to time window (inclusive on both ends)
      const matching = allSlots.filter(s => {
        const m = s.date?.start?.match(/(\d{2}):(\d{2})/);
        if (!m) return false;
        const totalMin = parseInt(m[1]) * 60 + parseInt(m[2]);
        return totalMin >= EARLIEST_MIN && totalMin <= LATEST_MIN;
      });

      if (matching.length === 0) {
        // Show what times ARE available
        const availTimes = allSlots.slice(0, 4).map(s => s.date?.start?.match(/(\d{2}:\d{2})/)?.[1]).join(', ');
        console.log(`— ${allSlots.length} slots outside window (${availTimes}...)`);
        await sleep(1000);
        continue;
      }

      // Sort: prefer 7-8:30pm, then earlier
      matching.sort((a, b) => {
        const getMin = s => { const m = s.date.start.match(/(\d{2}):(\d{2})/); return parseInt(m[1]) * 60 + parseInt(m[2]); };
        const ma = getMin(a), mb = getMin(b);
        const pa = ma >= 1140 && ma <= 1290 ? 0 : 1;
        const pb = mb >= 1140 && mb <= 1290 ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return ma - mb;
      });

      const best = matching[0];
      const bestTime = best.date.start.match(/(\d{2}:\d{2})/)[1];
      console.log(`🎯 ${matching.length} slots! Best: ${bestTime}`);

      if (DRY_RUN) {
        console.log(`\n🧪 DRY RUN — would book ${bestTime}. Stopping.`);
        process.exit(0);
      }

      // 3. Try each matching slot via API (fast path)
      let booked = false;
      for (let si = 0; si < Math.min(matching.length, 3); si++) {
        const slot = matching[si];
        const slotTime = slot.date.start.match(/(\d{2}:\d{2})/)[1];

        try {
          // Get book token
          const details = curlPostJson('https://api.resy.com/3/details', {
            config_id: slot.config.token,
            day: TARGET_DATE,
            party_size: PARTY_SIZE,
          });

          const bookToken = details?.book_token?.value;
          const paymentId = details?.user?.payment_methods?.[0]?.id;

          if (!bookToken) {
            console.log(`  ❌ No token for ${slotTime} — captcha likely blocking`);
            // Don't waste time on more API attempts — go to browser
            break;
          }

          // Try booking
          const bookResult = curlPostForm('https://api.resy.com/3/book', {
            book_token: bookToken,
            struct_payment_method: JSON.stringify({ id: paymentId }),
            source_id: 'resy.com-venue-details',
          });
          const bookData = JSON.parse(bookResult);

          if (bookData.resy_token) {
            console.log(`\n  ${'🎉'.repeat(5)}`);
            console.log(`  ✅ BOOKED VIA API!`);
            console.log(`  ${venue.name} — ${TARGET_DATE} at ${slotTime}`);
            console.log(`  Confirmation: ${bookData.resy_token}`);
            console.log(`  ${'🎉'.repeat(5)}\n`);
            process.exit(0);
          }

          console.log(`  ❌ ${slotTime}: ${JSON.stringify(bookData).slice(0, 100)}`);
        } catch (e) {
          console.log(`  ❌ ${slotTime}: ${e.message?.slice(0, 60)}`);
        }
      }

      // 4. API failed — switch to browser immediately
      if (!browserLaunched && hasCaptcha) {
        browserLaunched = true;
        console.log(`\n  🌐 API blocked by captcha — opening browser...`);
        await bookViaBrowser(bestTime);
        return;
      }

    } catch (e) {
      console.log(`❌ ${e.message?.slice(0, 60)}`);
    }

    await sleep(1000);
  }

  console.log(`\n😔 Max attempts reached.`);
}

// ── Browser fallback ──────────────────────────────────────────────────────
async function bookViaBrowser(targetTime) {
  const puppeteer = await import('puppeteer-core');

  const chromePath = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  ].find(p => existsSync(p));

  if (!chromePath) {
    console.log('❌ Chrome not found for browser fallback');
    return;
  }

  console.log(`\n🌐 Opening browser — will click ${targetTime} slot...`);

  const browser = await puppeteer.default.launch({
    executablePath: chromePath,
    headless: false,
    userDataDir: `${homedir()}/.resy-sniper-profile`,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,900',
    ],
    defaultViewport: null,
  });

  const page = (await browser.pages())[0] || await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  // Set auth token as cookie to log in automatically
  await page.setCookie(
    { name: 'authToken', value: AUTH, domain: '.resy.com', path: '/', httpOnly: false, secure: true },
    { name: 'x-resy-auth-token', value: AUTH, domain: '.resy.com', path: '/', httpOnly: false, secure: true },
    { name: 'x-resy-universal-auth', value: AUTH, domain: '.resy.com', path: '/', httpOnly: false, secure: true },
  );

  // Inject auth into localStorage when page loads
  await page.evaluateOnNewDocument((token) => {
    try {
      localStorage.setItem('authToken', token);
      localStorage.setItem('x-resy-auth-token', token);
      localStorage.setItem('x-resy-universal-auth', token);
    } catch {}
  }, AUTH);

  const url = `https://resy.com/cities/new-york-ny/venues/${SLUG}?date=${TARGET_DATE}&seats=${PARTY_SIZE}`;
  console.log(`🔗 Loading: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(3000);

  // Check if logged in
  const loggedIn = await page.evaluate(() => {
    return document.body.innerText.includes('Account') ||
           document.body.innerText.includes('My Reservations') ||
           !!document.querySelector('[class*="Avatar"]');
  });

  if (!loggedIn) {
    console.log('⚠️ Not logged in — please log in manually in the browser window.');
    console.log('   Waiting 60 seconds...');
    await sleep(60000);
    // Reload after login
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(2000);
  } else {
    console.log('✅ Logged in');
  }

  // Convert 24h time to 12h for button matching
  const [targetH, targetM] = targetTime.split(':').map(Number);
  const h12 = targetH > 12 ? targetH - 12 : targetH;
  const ampm = targetH >= 12 ? 'PM' : 'AM';
  const targetAmPm = `${h12}:${String(targetM).padStart(2, '0')} ${ampm}`;

  console.log(`🖱️ Looking for "${targetAmPm}" button...`);

  // Try clicking the time slot
  const clicked = await page.evaluate((time12, time24) => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent.trim();
      if (text.includes(time12) || text.includes(time24)) {
        btn.click();
        return text;
      }
    }
    // Also try any button with the hour
    const hourStr = time12.split(':')[0] + ':';
    for (const btn of buttons) {
      const text = btn.textContent.trim();
      if (text.includes(hourStr) && btn.offsetParent !== null) {
        btn.click();
        return text;
      }
    }
    return null;
  }, targetAmPm, targetTime);

  if (clicked) {
    console.log(`✅ Clicked: "${clicked}"`);
    await sleep(2000);

    // Try to click Reserve/Confirm
    const reserved = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const t = btn.textContent.trim().toLowerCase();
        if ((t.includes('reserve') || t.includes('confirm') || t.includes('complete reservation')) &&
            btn.offsetParent !== null && !btn.disabled) {
          btn.click();
          return btn.textContent.trim();
        }
      }
      return null;
    });

    if (reserved) {
      console.log(`✅ Clicked: "${reserved}"`);
      await sleep(5000);

      // Check result
      const result = await page.evaluate(() => {
        const text = document.body.innerText;
        if (text.includes('confirmed') || text.includes('Confirmed') || text.includes("You're going")) return 'success';
        return 'pending';
      });

      if (result === 'success') {
        console.log(`\n  ${'🎉'.repeat(5)}`);
        console.log(`  ✅ BOOKED VIA BROWSER!`);
        console.log(`  ${'🎉'.repeat(5)}\n`);
      } else {
        console.log(`\n📌 If captcha appeared, solve it in the browser window now.`);
      }
    } else {
      console.log(`📌 Click the Reserve button in the browser window.`);
    }
  } else {
    console.log(`⚠️ Couldn't find time slot button — book manually in the browser.`);
  }

  console.log(`\n📌 Browser stays open. Press Ctrl+C when done.`);
  await new Promise(() => {});
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
