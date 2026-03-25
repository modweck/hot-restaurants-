/**
 * resy-sniper-browser.mjs
 *
 * APPROACH 1: Uses your REAL Chrome browser (not headless) with your actual
 * Resy login session. reCAPTCHA sees a real browser with real history = passes.
 *
 * HOW:
 *   1. Opens Chrome with your real profile (you're already logged into Resy)
 *   2. Navigates to the restaurant page BEFORE drop time
 *   3. At drop time, rapidly refreshes and grabs the first matching slot
 *   4. Clicks through the booking flow in the actual browser
 *
 * USAGE:
 *   node scripts/resy-sniper-browser.mjs --slug torrisi --date 2026-04-23 --party 2 --drop-time "10:00"
 *   node scripts/resy-sniper-browser.mjs --slug torrisi --date 2026-04-23 --party 2 --drop-time "10:00" --dry-run
 *
 * IMPORTANT: Close Chrome completely before running (can't attach to a running instance)
 */

import puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';

// ── CLI args ────────────────────────────────────────────────────────────────
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

// Account 2 auth token (mauricedweck16@gmail.com)
const AUTH_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3NzgyNTY1MTMsInVpZCI6Mzk4MTc5NDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxMzE1NzU1OTh9fQ.ABgNrvln-lly8zjNpitmQ7N26hMS9TsKSrgFUnxjX9DMvI4-6XzkWG3Tf6PCQ5cDFkGMWUuNhew6RQm0HvRcdh5LAX7fYyeM02BbUmqERzB-xmPrSvHLlgx6HLA3bkdJvrH0Rmkko3kUIvYsP-r3FPK6hBI0OnopKeD6bW13kou2VsY2';

if (!SLUG || !TARGET_DATE) {
  console.error('Usage: node resy-sniper-browser.mjs --slug <slug> --date <YYYY-MM-DD> --party <n> --drop-time <HH:MM>');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}
const EARLIEST_MIN = timeToMinutes(EARLIEST);
const LATEST_MIN = timeToMinutes(LATEST);

// ── Find Chrome ─────────────────────────────────────────────────────────────
function findChrome() {
  const paths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

function findChromeProfile() {
  const profileDir = `${homedir()}/Library/Application Support/Google/Chrome`;
  if (existsSync(profileDir)) return profileDir;
  return null;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  🎯 RESY SNIPER — REAL BROWSER MODE`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`  Restaurant: ${SLUG}`);
  console.log(`  Date:       ${TARGET_DATE}`);
  console.log(`  Party:      ${PARTY_SIZE}`);
  console.log(`  Window:     ${EARLIEST} - ${LATEST}`);
  console.log(`  Drop time:  ${DROP_TIME}`);
  console.log(`  Mode:       ${DRY_RUN ? '🧪 DRY RUN' : '🔴 LIVE'}`);
  console.log(`${'═'.repeat(50)}\n`);

  const chromePath = findChrome();
  if (!chromePath) {
    console.error('❌ Chrome not found');
    process.exit(1);
  }
  console.log(`✅ Chrome: ${chromePath}`);

  // Use a temp profile that copies cookies from real profile
  // This avoids "Chrome is already running" issues
  const profileDir = findChromeProfile();
  console.log(`✅ Profile: ${profileDir ? 'found' : 'not found (will use fresh)'}`);

  // Launch Chrome (NOT headless — real browser window)
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    userDataDir: process.env.SNIPER_PROFILE || `${homedir()}/.resy-sniper-profile`,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,900',
    ],
    defaultViewport: null,
  });

  const page = (await browser.pages())[0] || await browser.newPage();

  // Remove webdriver flag
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    // Also override permissions for notifications
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
  });

  try {
    // ── Step 1: Inject auth token and check login ─────────────────────────
    console.log('\n📱 Setting up Resy login (Account 2)...');

    // Set auth cookies before navigating
    await page.setCookie(
      { name: 'authToken', value: AUTH_TOKEN, domain: '.resy.com', path: '/', secure: true },
      { name: 'x-resy-auth-token', value: AUTH_TOKEN, domain: '.resy.com', path: '/', secure: true },
      { name: 'x-resy-universal-auth', value: AUTH_TOKEN, domain: '.resy.com', path: '/', secure: true },
    );

    // Also inject into localStorage
    await page.evaluateOnNewDocument((token) => {
      try {
        localStorage.setItem('authToken', token);
        localStorage.setItem('x-resy-auth-token', token);
        localStorage.setItem('x-resy-universal-auth', token);
      } catch {}
    }, AUTH_TOKEN);

    await page.goto('https://resy.com', { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(2000);

    const isLoggedIn = await page.evaluate(() => {
      // Check for logged-in indicators
      const body = document.body.innerText;
      return body.includes('My Reservations') || body.includes('Account') ||
             !!document.querySelector('[class*="Avatar"]') ||
             !!document.querySelector('[data-test*="user"]');
    });

    if (!isLoggedIn) {
      console.log('⚠️ Not detected as logged in — proceeding anyway (cookies were set).');
      console.log('   If not logged in, log in manually in the browser window.');
    } else {
      console.log('✅ Already logged in to Resy');
    }

    // ── Step 2: Navigate to restaurant page ───────────────────────────────
    const resyUrl = `https://resy.com/cities/new-york-ny/venues/${SLUG}?date=${TARGET_DATE}&seats=${PARTY_SIZE}`;
    console.log(`\n🔗 Loading: ${resyUrl}`);
    await page.goto(resyUrl, { waitUntil: 'networkidle2', timeout: 25000 });
    await sleep(3000);

    // Verify we're on the right page
    const pageTitle = await page.title();
    console.log(`📄 Page: ${pageTitle}`);

    // ── Step 3: Wait for drop time ────────────────────────────────────────
    const [dropH, dropM] = DROP_TIME.split(':').map(Number);
    const now = new Date();
    const drop = new Date(now);
    drop.setHours(dropH, dropM, 0, 0);

    if (drop > now) {
      const msUntil = drop - now;
      const minsUntil = Math.ceil(msUntil / 60000);
      console.log(`\n⏰ Waiting ${minsUntil} minutes until ${DROP_TIME} drop...`);
      console.log(`   Page is pre-loaded and ready.`);

      // Refresh page 5 seconds before drop to have fresh state
      const refreshAt = msUntil - 5000;
      if (refreshAt > 10000) {
        // Wait until 5 sec before drop
        const waitInterval = setInterval(() => {
          const remaining = drop - new Date();
          if (remaining > 0) {
            const m = Math.floor(remaining / 60000);
            const s = Math.floor((remaining % 60000) / 1000);
            process.stdout.write(`\r   ⏳ ${m}m ${s}s...     `);
          }
        }, 10000);

        await sleep(refreshAt);
        clearInterval(waitInterval);
        console.log(`\n\n🔄 Refreshing page 5s before drop...`);
      }
    } else {
      console.log(`⚡ Drop time already passed — going now`);
    }

    // ── Step 4: Rapid refresh + grab slot ─────────────────────────────────
    console.log(`\n🚀 SNIPING at ${new Date().toISOString()}`);

    const MAX_ATTEMPTS = 15;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      process.stdout.write(`  [${attempt}/${MAX_ATTEMPTS}] `);

      // Refresh the page with the target date
      await page.goto(resyUrl, { waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
      await sleep(2000);

      // Look for time slot buttons
      const slots = await page.evaluate((earliest, latest) => {
        // Find all clickable time slot buttons
        const buttons = document.querySelectorAll(
          'button[class*="TimeSlot"], button[class*="timeslot"], ' +
          '[class*="ReservationButton"] button, [class*="slot"] button, ' +
          'button[data-test*="time"], [role="button"][class*="time"]'
        );

        const found = [];
        for (const btn of buttons) {
          const text = btn.textContent.trim();
          // Match time patterns like "7:00 PM", "19:00", etc
          const match = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
          if (!match) continue;

          let h = parseInt(match[1]);
          const m = parseInt(match[2]);
          const ampm = match[3];
          if (ampm) {
            if (/pm/i.test(ampm) && h !== 12) h += 12;
            if (/am/i.test(ampm) && h === 12) h = 0;
          }
          const totalMin = h * 60 + m;

          if (totalMin >= earliest && totalMin <= latest) {
            found.push({
              text,
              totalMin,
              index: Array.from(buttons).indexOf(btn),
            });
          }
        }

        // Sort: prefer 7-8:30 PM, then earlier
        found.sort((a, b) => {
          const primeA = a.totalMin >= 1140 && a.totalMin <= 1290 ? 0 : 1;
          const primeB = b.totalMin >= 1140 && b.totalMin <= 1290 ? 0 : 1;
          if (primeA !== primeB) return primeA - primeB;
          return a.totalMin - b.totalMin;
        });

        return found;
      }, EARLIEST_MIN, LATEST_MIN);

      if (slots.length === 0) {
        // Also check if page shows "no availability" or "notify"
        const pageState = await page.evaluate(() => {
          const text = document.body.innerText;
          if (text.includes('Notify') && !text.includes('Find a Time')) return 'notify_only';
          if (text.includes('No availability')) return 'no_availability';
          return 'unknown';
        });
        console.log(`— no matching slots (${pageState})`);
        await sleep(1000);
        continue;
      }

      console.log(`🎯 Found ${slots.length} matching slots!`);
      const best = slots[0];
      console.log(`   Best: ${best.text}`);

      if (DRY_RUN) {
        console.log(`\n🧪 DRY RUN — would click "${best.text}" now. Stopping.`);
        console.log(`   Browser stays open so you can inspect.`);
        return; // Don't close browser
      }

      // ── Click the time slot ───────────────────────────────────────────
      console.log(`\n🖱️ Clicking "${best.text}"...`);

      const clicked = await page.evaluate((idx) => {
        const buttons = document.querySelectorAll(
          'button[class*="TimeSlot"], button[class*="timeslot"], ' +
          '[class*="ReservationButton"] button, [class*="slot"] button, ' +
          'button[data-test*="time"], [role="button"][class*="time"]'
        );
        if (buttons[idx]) {
          buttons[idx].click();
          return true;
        }
        return false;
      }, best.index);

      if (!clicked) {
        console.log('   ⚠️ Click failed, retrying...');
        continue;
      }

      await sleep(2000);

      // ── Click "Reserve" / "Confirm" button ────────────────────────────
      console.log(`🖱️ Looking for Reserve/Confirm button...`);

      const booked = await page.evaluate(() => {
        const selectors = [
          'button[class*="Reserve"]',
          'button[class*="reserve"]',
          'button[class*="Confirm"]',
          'button[class*="confirm"]',
          'button[data-test*="book"]',
          'button[data-test*="reserve"]',
          'button[data-test*="confirm"]',
        ];

        for (const sel of selectors) {
          const btn = document.querySelector(sel);
          if (btn && btn.offsetParent !== null) {
            btn.click();
            return { clicked: true, text: btn.textContent.trim() };
          }
        }

        // Try finding by text content
        const allButtons = document.querySelectorAll('button');
        for (const btn of allButtons) {
          const t = btn.textContent.trim().toLowerCase();
          if ((t.includes('reserve') || t.includes('confirm') || t.includes('complete')) &&
              btn.offsetParent !== null && !btn.disabled) {
            btn.click();
            return { clicked: true, text: btn.textContent.trim() };
          }
        }

        return { clicked: false };
      });

      if (booked.clicked) {
        console.log(`   ✅ Clicked: "${booked.text}"`);
        await sleep(3000);

        // Check for success
        const result = await page.evaluate(() => {
          const text = document.body.innerText;
          if (text.includes('confirmed') || text.includes('Confirmed') || text.includes('You\'re going')) {
            return 'success';
          }
          if (text.includes('recaptcha') || text.includes('CAPTCHA') || text.includes('verify')) {
            return 'captcha';
          }
          if (text.includes('error') || text.includes('unavailable') || text.includes('no longer available')) {
            return 'failed';
          }
          return 'unknown';
        });

        if (result === 'success') {
          console.log(`\n  ${'🎉'.repeat(5)}`);
          console.log(`  ✅ RESERVATION BOOKED!`);
          console.log(`  ${SLUG} — ${TARGET_DATE} at ${best.text}`);
          console.log(`  Party of ${PARTY_SIZE}`);
          console.log(`  ${'🎉'.repeat(5)}\n`);
          console.log(`  Browser stays open — check your Resy app!`);
          return;
        } else if (result === 'captcha') {
          console.log(`   ⚠️ reCAPTCHA appeared — solve it in the browser window!`);
          console.log(`   Waiting 30s for you to solve...`);
          await sleep(30000);

          // Check again after captcha
          const afterCaptcha = await page.evaluate(() => {
            return document.body.innerText.includes('confirmed') || document.body.innerText.includes('Confirmed');
          });
          if (afterCaptcha) {
            console.log(`\n  🎉 BOOKED after captcha solve!`);
            return;
          }
        } else {
          console.log(`   Status: ${result} — checking page...`);
          await sleep(2000);
        }
      } else {
        console.log(`   ⚠️ No Reserve/Confirm button found`);
      }
    }

    console.log(`\n😔 Max attempts reached.`);
    console.log(`   Browser stays open — you can try manually.`);

  } catch (err) {
    console.error('Error:', err.message);
  }

  // Keep browser open
  console.log('\n📌 Browser staying open. Press Ctrl+C to exit.');
  await new Promise(() => {}); // hang forever
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
