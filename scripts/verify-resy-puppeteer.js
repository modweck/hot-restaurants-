/**
 * verify-resy-puppeteer.js
 *
 * Visits each broken Resy URL with Puppeteer to check if the page is alive or dead.
 * Runs SLOW (~3 min between requests) to avoid detection.
 * Saves progress after every entry so it can be resumed.
 *
 * RUN:   node scripts/verify-resy-puppeteer.js
 * RESUME: just run again — it skips already-checked entries
 * QUICK:  node scripts/verify-resy-puppeteer.js --quick   (first 5 only)
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BROKEN_FILE = path.join(__dirname, '..', 'data', 'broken_resy_entries.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'resy_puppeteer_verification.json');
const BOOKING_MASTER = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');

const QUICK = process.argv.includes('--quick');

// Slow delay: ~3 minutes between requests (randomized 150-210 seconds)
const MIN_DELAY = 150_000;
const MAX_DELAY = 210_000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const randDelay = () => MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);

function loadJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } }
function saveJSON(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

async function checkResyPage(page, url) {
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const status = resp ? resp.status() : 0;

    // Wait a bit for any client-side rendering
    await sleep(3000);

    const pageData = await page.evaluate(() => {
      const body = document.body ? document.body.innerText : '';
      const title = document.title || '';
      const canonical = document.querySelector('link[rel="canonical"]');
      const canonicalUrl = canonical ? canonical.href : '';

      // Check for common "not found" / "closed" indicators on Resy
      const notFound = body.includes('page you were looking for') ||
                       body.includes('couldn\'t find') ||
                       body.includes('no longer available') ||
                       body.includes('page not found') ||
                       body.includes('404') ||
                       title.toLowerCase().includes('not found');

      // Check for venue closed indicators
      const closed = body.includes('permanently closed') ||
                     body.includes('this venue is closed') ||
                     body.includes('no longer accepting');

      // Check if there's a booking widget / time slots visible
      const hasBooking = !!document.querySelector('[class*="ReservationButton"]') ||
                         !!document.querySelector('[class*="TimeSlot"]') ||
                         !!document.querySelector('button[data-test*="reserve"]') ||
                         body.includes('Find a Time') ||
                         body.includes('Notify Me') ||
                         body.includes('Reserve Now');

      // Check if redirected to homepage or search
      const isHomepage = window.location.pathname === '/' ||
                         window.location.pathname === '/cities/ny';

      // Grab the venue name if visible
      const venueNameEl = document.querySelector('h1');
      const venueName = venueNameEl ? venueNameEl.textContent.trim() : '';

      return {
        bodySnippet: body.substring(0, 500),
        title,
        canonicalUrl,
        notFound,
        closed,
        hasBooking,
        isHomepage,
        venueName,
        finalUrl: window.location.href,
      };
    });

    // Determine status
    let result = 'unknown';
    if (status === 404 || pageData.notFound || pageData.isHomepage) {
      result = 'dead';
    } else if (pageData.closed) {
      result = 'closed';
    } else if (pageData.hasBooking) {
      result = 'alive';
    } else if (status >= 200 && status < 400 && pageData.venueName) {
      result = 'alive_no_booking';
    } else if (status >= 200 && status < 400) {
      result = 'maybe_alive';
    } else {
      result = 'error';
    }

    return {
      httpStatus: status,
      result,
      venueName: pageData.venueName,
      finalUrl: pageData.finalUrl,
      title: pageData.title,
      hasBooking: pageData.hasBooking,
      notFound: pageData.notFound,
      closed: pageData.closed,
      isHomepage: pageData.isHomepage,
      checkedAt: new Date().toISOString(),
    };
  } catch (e) {
    return {
      httpStatus: 0,
      result: 'error',
      error: e.message,
      checkedAt: new Date().toISOString(),
    };
  }
}

async function main() {
  const broken = loadJSON(BROKEN_FILE);
  const existing = loadJSON(OUTPUT_FILE);

  const entries = Object.entries(broken);
  const todo = entries.filter(([name]) => !existing[name]);

  if (QUICK) todo.splice(5);

  console.log(`\n🔍 Resy Puppeteer Verification`);
  console.log(`📊 Total broken: ${entries.length}`);
  console.log(`✅ Already checked: ${entries.length - todo.length}`);
  console.log(`📋 To check: ${todo.length}`);
  console.log(`⏱️  Delay: ${(MIN_DELAY/1000/60).toFixed(1)}-${(MAX_DELAY/1000/60).toFixed(1)} min between requests`);

  const totalMinutes = todo.length * ((MIN_DELAY + MAX_DELAY) / 2 / 1000 / 60);
  console.log(`⏳ Estimated time: ${(totalMinutes / 60).toFixed(1)} hours`);
  console.log(`\n${'═'.repeat(60)}\n`);

  if (todo.length === 0) {
    console.log('Nothing to check — all done!');
    printSummary(existing);
    return;
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1280,800',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // Set cookies to look more like a real user
    await page.setCookie({
      name: '_resy_visit',
      value: '1',
      domain: '.resy.com',
    });

    let alive = 0, dead = 0, closed = 0, errors = 0, other = 0;

    for (let i = 0; i < todo.length; i++) {
      const [name, data] = todo[i];
      const url = data.url;

      process.stdout.write(`  [${i + 1}/${todo.length}] ${name} ... `);

      const result = await checkResyPage(page, url);
      existing[name] = { ...data, ...result };

      // Save after every entry (resume-safe)
      saveJSON(OUTPUT_FILE, existing);

      const icon = result.result === 'alive' ? '🟢' :
                   result.result === 'alive_no_booking' ? '🟡' :
                   result.result === 'maybe_alive' ? '🟠' :
                   result.result === 'dead' ? '💀' :
                   result.result === 'closed' ? '🚫' : '❌';

      console.log(`${icon} ${result.result} (HTTP ${result.httpStatus})${result.venueName ? ' — ' + result.venueName : ''}`);

      if (result.result === 'alive' || result.result === 'alive_no_booking') alive++;
      else if (result.result === 'dead') dead++;
      else if (result.result === 'closed') closed++;
      else if (result.result === 'error') errors++;
      else other++;

      // Wait before next request (skip wait on last one)
      if (i < todo.length - 1) {
        const delay = randDelay();
        const mins = (delay / 1000 / 60).toFixed(1);
        process.stdout.write(`     ⏳ waiting ${mins} min...\r`);
        await sleep(delay);
      }
    }

    await page.close();

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`This batch: 🟢 ${alive} alive | 💀 ${dead} dead | 🚫 ${closed} closed | ❌ ${errors} errors | 🟠 ${other} other`);

  } finally {
    await browser.close();
  }

  printSummary(loadJSON(OUTPUT_FILE));
}

function printSummary(data) {
  const all = Object.entries(data);
  const counts = {};
  for (const [, v] of all) {
    counts[v.result] = (counts[v.result] || 0) + 1;
  }
  console.log(`\n📊 FULL SUMMARY (${all.length} checked):`);
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${k}: ${v}`);
  }
  console.log();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
