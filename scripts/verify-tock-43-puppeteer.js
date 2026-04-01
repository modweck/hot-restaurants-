/**
 * verify-tock-43-puppeteer.js
 *
 * Verifies 43 Tock restaurants in BOOKING_MASTER:
 *   1. Check if each is actually on Resy (if so, switch to Resy)
 *   2. Verify the Tock URL is alive and bookable
 *
 * RUN:   node scripts/verify-tock-43-puppeteer.js
 * OPTIONS:
 *   --quick       First 5 only
 *   --batch N     Check N then stop
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'tock_43_verification.json');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
function getArg(name, def) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}
const BATCH_LIMIT = parseInt(getArg('batch', '0'), 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));
function randDelay(min = 5000, max = 10000) { return min + Math.random() * (max - min); }

function loadJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } }
function saveJSON(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

// Generate Resy slug guesses from restaurant name
function generateResySlugs(name) {
  const base = name.toLowerCase()
    .replace(/[''`\u2019·]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const slugs = new Set();
  slugs.add(base);

  // Without location/descriptor suffixes
  const noLoc = base.replace(/-(nyc|ny|new-york|manhattan|brooklyn|queens|flatiron|greenwich-village|centre-street|troy)$/g, '').replace(/-+$/, '');
  if (noLoc !== base) slugs.add(noLoc);

  const noSuffix = base.replace(/-(restaurant|bar|kitchen|cafe|lounge|room|online|usa)$/g, '').replace(/-+$/, '');
  if (noSuffix !== base) slugs.add(noSuffix);

  if (base.startsWith('the-')) slugs.add(base.slice(4));

  // With location
  slugs.add(base + '-ny');
  slugs.add(base + '-nyc');

  // Handle "X by Y" or "X - Y" patterns
  const dashParts = name.split(/ [-–—] | by /i);
  if (dashParts.length > 1) {
    const first = dashParts[0].toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    slugs.add(first);
    slugs.add(first + '-nyc');
  }

  return [...slugs].filter(s => s.length > 1);
}

// Check if a restaurant is on Resy
async function checkResy(page, slug) {
  const url = `https://resy.com/cities/ny/${slug}`;
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    const status = resp ? resp.status() : 0;
    await sleep(2500);

    const pageData = await page.evaluate(() => {
      const body = document.body ? document.body.innerText : '';
      const title = document.title || '';

      const notFound = body.includes('page you were looking for') ||
                       body.includes("can't find") ||
                       body.includes('can\u2019t find') ||
                       body.includes('Sorry, but we') ||
                       body.includes('no longer available') ||
                       body.includes('page not found') ||
                       title.toLowerCase().includes('not found');

      const hasBooking = !!document.querySelector('[class*="ReservationButton"]') ||
                         !!document.querySelector('[class*="TimeSlot"]') ||
                         body.includes('Find a Time') ||
                         body.includes('Notify Me') ||
                         body.includes('Reserve Now');

      const isHomepage = window.location.pathname === '/' ||
                         window.location.pathname === '/cities/ny';

      const venueNameEl = document.querySelector('h1');
      const venueName = venueNameEl ? venueNameEl.textContent.trim() : '';

      return { notFound, hasBooking, isHomepage, venueName, bodyLen: body.length };
    });

    if (status === 404 || pageData.notFound || pageData.isHomepage) return { found: false };
    if (pageData.hasBooking || (status >= 200 && status < 400 && pageData.venueName && pageData.bodyLen > 500)) {
      return { found: true, slug, venueName: pageData.venueName, url };
    }
    return { found: false };
  } catch {
    return { found: false };
  }
}

// Check if Tock URL is alive
async function checkTock(page, tockUrl) {
  try {
    const resp = await page.goto(tockUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    const status = resp ? resp.status() : 0;
    await sleep(2500);

    const pageData = await page.evaluate(() => {
      const body = document.body ? document.body.innerText : '';
      const title = document.title || '';

      const notFound = body.includes('page not found') ||
                       body.includes('Page not found') ||
                       body.includes('404') ||
                       body.includes('no longer available') ||
                       body.includes("doesn't exist") ||
                       title.toLowerCase().includes('not found') ||
                       title.toLowerCase().includes('page not found');

      const hasBooking = body.includes('Reserve') ||
                        body.includes('Book') ||
                        body.includes('experience') ||
                        body.includes('Reservation') ||
                        body.includes('Select a date') ||
                        body.includes('party size') ||
                        !!document.querySelector('[class*="reservation"]') ||
                        !!document.querySelector('[class*="booking"]') ||
                        !!document.querySelector('button');

      const venueNameEl = document.querySelector('h1') || document.querySelector('[class*="venue-name"]');
      const venueName = venueNameEl ? venueNameEl.textContent.trim() : '';

      return { notFound, hasBooking, venueName, bodyLen: body.length, title, finalUrl: window.location.href };
    });

    if (status === 404 || pageData.notFound) {
      return { alive: false, reason: 'not_found', status };
    }
    if (status >= 200 && status < 400 && pageData.bodyLen > 200) {
      return {
        alive: true,
        hasBooking: pageData.hasBooking,
        venueName: pageData.venueName,
        title: pageData.title,
        status,
      };
    }
    return { alive: false, reason: `http_${status}`, status };
  } catch (e) {
    return { alive: false, reason: `error: ${e.message.substring(0, 50)}` };
  }
}

async function main() {
  const master = loadJSON(MASTER_FILE);
  let results = loadJSON(OUTPUT_FILE);

  const tockEntries = Object.entries(master).filter(([, v]) => v.platform === 'tock');
  console.log(`\n🔍 Tock 43 Verification (Resy check + Tock alive check)`);
  console.log(`📋 Tock restaurants in BOOKING_MASTER: ${tockEntries.length}`);

  let todo = tockEntries.filter(([name]) => !results[name]);
  if (QUICK) todo = todo.slice(0, 5);
  if (BATCH_LIMIT > 0) todo = todo.slice(0, BATCH_LIMIT);

  console.log(`✅ Already checked: ${tockEntries.length - todo.length}`);
  console.log(`📋 To check: ${todo.length}`);
  console.log(`${'═'.repeat(55)}\n`);

  if (todo.length === 0) { console.log('Nothing to check!'); printSummary(results); return; }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1280,800']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  let onResy = 0, tockAlive = 0, tockDead = 0;

  for (let i = 0; i < todo.length; i++) {
    const [name, entry] = todo[i];
    process.stdout.write(`  [${i + 1}/${todo.length}] ${name.substring(0, 35).padEnd(35)} `);

    // Step 1: Check Resy
    const slugs = generateResySlugs(name);
    let resyResult = null;
    for (const slug of slugs) {
      const check = await checkResy(page, slug);
      if (check.found) {
        resyResult = check;
        break;
      }
      await sleep(2500 + Math.random() * 2000);
    }

    if (resyResult) {
      // Found on Resy — flag for switch
      results[name] = {
        name,
        currentPlatform: 'tock',
        tockUrl: entry.url,
        onResy: true,
        resySlug: resyResult.slug,
        resyUrl: `https://resy.com/cities/ny/${resyResult.slug}`,
        resyVenueName: resyResult.venueName,
        tockChecked: false,
        action: 'switch_to_resy',
        checkedAt: new Date().toISOString()
      };
      onResy++;
      console.log(`🔄 ON RESY → ${resyResult.venueName} (${resyResult.slug})`);
    } else {
      // Not on Resy — verify Tock URL
      await sleep(randDelay(3000, 6000));
      const tockResult = await checkTock(page, entry.url);

      if (tockResult.alive) {
        results[name] = {
          name,
          currentPlatform: 'tock',
          tockUrl: entry.url,
          onResy: false,
          tockAlive: true,
          tockHasBooking: tockResult.hasBooking,
          tockVenueName: tockResult.venueName,
          action: 'keep_tock',
          checkedAt: new Date().toISOString()
        };
        tockAlive++;
        console.log(`✅ Tock alive${tockResult.venueName ? ' — ' + tockResult.venueName : ''}`);
      } else {
        results[name] = {
          name,
          currentPlatform: 'tock',
          tockUrl: entry.url,
          onResy: false,
          tockAlive: false,
          tockReason: tockResult.reason,
          action: 'tock_dead',
          checkedAt: new Date().toISOString()
        };
        tockDead++;
        console.log(`💀 Tock dead (${tockResult.reason})`);
      }
    }

    saveJSON(OUTPUT_FILE, results);
    if (i < todo.length - 1) await sleep(randDelay(5000, 10000));
  }

  await browser.close();

  results._meta = {
    total: Object.keys(results).filter(k => k !== '_meta').length,
    onResy,
    tockAlive,
    tockDead,
    lastRun: new Date().toISOString()
  };
  saveJSON(OUTPUT_FILE, results);
  printSummary(results);
}

function printSummary(results) {
  const entries = Object.entries(results).filter(([k]) => k !== '_meta');
  const resy = entries.filter(([, v]) => v.onResy);
  const alive = entries.filter(([, v]) => !v.onResy && v.tockAlive);
  const dead = entries.filter(([, v]) => !v.onResy && !v.tockAlive);

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`📊 SUMMARY (${entries.length} checked)`);
  console.log(`   🔄 On Resy (switch): ${resy.length}`);
  console.log(`   ✅ Tock alive: ${alive.length}`);
  console.log(`   💀 Tock dead: ${dead.length}`);

  if (resy.length > 0) {
    console.log(`\n   Switch to Resy:`);
    for (const [, v] of resy)
      console.log(`      ${v.name} → resy.com/cities/ny/${v.resySlug}`);
  }
  if (dead.length > 0) {
    console.log(`\n   Dead Tock URLs:`);
    for (const [, v] of dead)
      console.log(`      ${v.name} → ${v.tockUrl} (${v.tockReason})`);
  }
  console.log(`\n💾 Results: data/tock_43_verification.json`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
