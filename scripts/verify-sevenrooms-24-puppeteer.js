/**
 * verify-sevenrooms-24-puppeteer.js
 *
 * Verifies 24 SevenRooms restaurants:
 *   1. Visit restaurant website, extract SevenRooms slug
 *   2. Check if SevenRooms URL is alive and bookable
 *   3. Check if restaurant is on Resy instead (prefer Resy)
 *
 * RUN:   node scripts/verify-sevenrooms-24-puppeteer.js
 * OPTIONS:
 *   --quick       First 5 only
 *   --batch N     Check N then stop
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const SR_VERIFY_FILE = path.join(__dirname, '..', 'data', 'sevenrooms_verification.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'sevenrooms_24_puppeteer_results.json');

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

// Generate Resy slug guesses
function generateResySlugs(name) {
  const base = name.toLowerCase()
    .replace(/[''`\u2019]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const slugs = new Set();
  slugs.add(base);
  if (base.startsWith('the-')) slugs.add(base.slice(4));
  slugs.add(base + '-ny');
  slugs.add(base + '-nyc');
  const noLoc = base.replace(/-(nyc|ny|new-york|tribeca|manhattan|brooklyn)$/g, '').replace(/-+$/, '');
  if (noLoc !== base) slugs.add(noLoc);
  const noSuffix = base.replace(/-(restaurant|bar|kitchen|cuisine)$/g, '').replace(/-+$/, '');
  if (noSuffix !== base) slugs.add(noSuffix);
  const dashParts = name.split(/ [-–] /);
  if (dashParts.length > 1) {
    const first = dashParts[0].toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    slugs.add(first);
  }
  return [...slugs].filter(s => s.length > 1);
}

// Check Resy page
async function checkResy(page, slug) {
  const url = `https://resy.com/cities/ny/${slug}`;
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    const status = resp ? resp.status() : 0;
    await sleep(2500);

    const data = await page.evaluate(() => {
      const body = document.body ? document.body.innerText : '';
      const title = document.title || '';
      const notFound = body.includes('page you were looking for') || body.includes("can't find") ||
                       body.includes('can\u2019t find') || body.includes('Sorry, but we') ||
                       body.includes('page not found') || title.toLowerCase().includes('not found');
      const hasBooking = !!document.querySelector('[class*="ReservationButton"]') ||
                         !!document.querySelector('[class*="TimeSlot"]') ||
                         body.includes('Find a Time') || body.includes('Notify Me') || body.includes('Reserve Now');
      const isHomepage = window.location.pathname === '/' || window.location.pathname === '/cities/ny';
      const h1 = document.querySelector('h1');
      return { notFound, hasBooking, isHomepage, venueName: h1 ? h1.textContent.trim() : '', bodyLen: body.length };
    });

    if (status === 404 || data.notFound || data.isHomepage) return { found: false };
    if (data.hasBooking || (status >= 200 && status < 400 && data.venueName && data.bodyLen > 500)) {
      return { found: true, slug, venueName: data.venueName, url };
    }
    return { found: false };
  } catch { return { found: false }; }
}

// Check SevenRooms URL
async function checkSevenRooms(page, srUrl) {
  try {
    const resp = await page.goto(srUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    const status = resp ? resp.status() : 0;
    await sleep(2500);

    const data = await page.evaluate(() => {
      const body = document.body ? document.body.innerText : '';
      const title = document.title || '';
      const notFound = body.includes('not found') || body.includes('404') ||
                       body.includes('no longer') || title.includes('Not Found');
      const hasBooking = body.includes('Reserve') || body.includes('reservation') ||
                        body.includes('party size') || body.includes('Select') ||
                        body.includes('Make a Reservation') || body.includes('Book');
      const h1 = document.querySelector('h1');
      return { notFound, hasBooking, venueName: h1 ? h1.textContent.trim() : '', bodyLen: body.length, finalUrl: window.location.href };
    });

    if (status === 404 || data.notFound || data.bodyLen < 200) {
      return { alive: false, reason: status === 404 ? 'not_found' : 'dead_page' };
    }
    return { alive: true, hasBooking: data.hasBooking, venueName: data.venueName, finalUrl: data.finalUrl };
  } catch (e) {
    return { alive: false, reason: `error: ${e.message.substring(0, 50)}` };
  }
}

// Visit restaurant website to find SevenRooms slug
async function extractSRFromWebsite(page, websiteUrl) {
  try {
    const srUrls = [];
    const handler = req => { if (req.url().includes('sevenrooms')) srUrls.push(req.url()); };
    page.on('request', handler);

    await page.goto(websiteUrl, { waitUntil: 'networkidle2', timeout: 25000 });
    await sleep(3000);

    const info = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      const srMatches = html.match(/sevenrooms\.com\/reservations\/([a-z0-9-]+)/gi) || [];
      const slugs = [...new Set(srMatches.map(m => {
        const s = m.match(/reservations\/([a-z0-9-]+)/i);
        return s ? s[1] : null;
      }).filter(Boolean))];

      const srLinks = [];
      document.querySelectorAll('a[href*="sevenrooms"]').forEach(a => srLinks.push(a.href));

      const hasSR = html.includes('sevenrooms.com') || html.includes('SevenRooms');
      return { slugs, srLinks: [...new Set(srLinks)], hasSR };
    });

    page.off('request', handler);

    // Check network requests too
    let networkSlug = null;
    for (const url of srUrls) {
      const m = url.match(/sevenrooms\.com\/reservations\/([a-z0-9-]+)/i);
      if (m) { networkSlug = m[1]; break; }
    }

    const slug = info.slugs[0] || networkSlug;
    // Also extract from links
    let linkSlug = null;
    for (const link of info.srLinks) {
      const m = link.match(/sevenrooms\.com\/reservations\/([a-z0-9-]+)/i);
      if (m) { linkSlug = m[1]; break; }
    }

    const finalSlug = slug || linkSlug;
    return {
      found: !!finalSlug,
      slug: finalSlug,
      srUrl: finalSlug ? `https://www.sevenrooms.com/reservations/${finalSlug}` : null,
      hasSR: info.hasSR,
      srLinks: info.srLinks.slice(0, 3),
    };
  } catch (e) {
    page.removeAllListeners('request');
    return { found: false, error: e.message };
  }
}

async function main() {
  const master = loadJSON(MASTER_FILE);
  const srVerify = loadJSON(SR_VERIFY_FILE);
  let results = loadJSON(OUTPUT_FILE);

  // Get all 24 SR restaurants from verification file
  const srNames = Object.keys(srVerify);
  console.log(`\n🔍 SevenRooms 24 Puppeteer Verification`);
  console.log(`📋 Total from scan: ${srNames.length}`);

  let todo = srNames.filter(name => !results[name.toLowerCase()]);
  if (QUICK) todo = todo.slice(0, 5);
  if (BATCH_LIMIT > 0) todo = todo.slice(0, BATCH_LIMIT);

  console.log(`✅ Already checked: ${srNames.length - todo.length}`);
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

  let onResy = 0, srAlive = 0, srDead = 0;

  for (let i = 0; i < todo.length; i++) {
    const name = todo[i];
    const key = name.toLowerCase();
    const masterEntry = master[key];
    const scanData = srVerify[name];
    const websiteUrl = masterEntry?.website || scanData?.websiteUrl;
    const existingSRUrl = masterEntry?.platform === 'sevenrooms' ? masterEntry.url : null;

    process.stdout.write(`  [${i + 1}/${todo.length}] ${name.substring(0, 35).padEnd(35)} `);

    // Step 1: Check Resy first
    const slugs = generateResySlugs(name);
    let resyResult = null;
    for (const slug of slugs) {
      const check = await checkResy(page, slug);
      if (check.found) { resyResult = check; break; }
      await sleep(2500 + Math.random() * 2000);
    }

    if (resyResult) {
      results[key] = {
        name, onResy: true,
        resySlug: resyResult.slug,
        resyUrl: `https://resy.com/cities/ny/${resyResult.slug}`,
        resyVenueName: resyResult.venueName,
        currentPlatform: masterEntry?.platform || 'none',
        action: 'switch_to_resy',
        checkedAt: new Date().toISOString()
      };
      onResy++;
      console.log(`🔄 ON RESY → ${resyResult.venueName} (${resyResult.slug})`);
      saveJSON(OUTPUT_FILE, results);
      if (i < todo.length - 1) await sleep(randDelay());
      continue;
    }

    // Step 2: Not on Resy — find/verify SevenRooms URL
    await sleep(randDelay(3000, 6000));

    let srUrl = existingSRUrl;

    // If no existing SR URL, try extracting from website
    if (!srUrl && websiteUrl) {
      const extract = await extractSRFromWebsite(page, websiteUrl);
      if (extract.found) {
        srUrl = extract.srUrl;
        process.stdout.write(`→ ${extract.slug} `);
      }
      await sleep(randDelay(3000, 5000));
    }

    // Verify SR URL
    if (srUrl) {
      const srCheck = await checkSevenRooms(page, srUrl);
      if (srCheck.alive) {
        results[key] = {
          name, onResy: false,
          srUrl, srAlive: true,
          srHasBooking: srCheck.hasBooking,
          srVenueName: srCheck.venueName,
          currentPlatform: masterEntry?.platform || 'none',
          action: masterEntry?.platform === 'sevenrooms' ? 'keep_sevenrooms' : 'switch_to_sevenrooms',
          checkedAt: new Date().toISOString()
        };
        srAlive++;
        console.log(`✅ SR alive${srCheck.venueName ? ' — ' + srCheck.venueName : ''}`);
      } else {
        results[key] = {
          name, onResy: false,
          srUrl, srAlive: false,
          srReason: srCheck.reason,
          currentPlatform: masterEntry?.platform || 'none',
          action: 'sr_dead',
          checkedAt: new Date().toISOString()
        };
        srDead++;
        console.log(`💀 SR dead (${srCheck.reason})`);
      }
    } else {
      results[key] = {
        name, onResy: false,
        srUrl: null, srAlive: false,
        srReason: 'no_sr_url_found',
        currentPlatform: masterEntry?.platform || 'none',
        action: 'no_sr_url',
        checkedAt: new Date().toISOString()
      };
      srDead++;
      console.log(`❌ no SR URL found`);
    }

    saveJSON(OUTPUT_FILE, results);
    if (i < todo.length - 1) await sleep(randDelay());
  }

  await browser.close();

  results._meta = { total: Object.keys(results).filter(k => k !== '_meta').length, onResy, srAlive, srDead, lastRun: new Date().toISOString() };
  saveJSON(OUTPUT_FILE, results);
  printSummary(results);
}

function printSummary(results) {
  const entries = Object.entries(results).filter(([k]) => k !== '_meta');
  const resy = entries.filter(([, v]) => v.onResy);
  const alive = entries.filter(([, v]) => !v.onResy && v.srAlive);
  const dead = entries.filter(([, v]) => !v.onResy && !v.srAlive);

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`📊 SUMMARY (${entries.length} checked)`);
  console.log(`   🔄 On Resy (switch): ${resy.length}`);
  console.log(`   ✅ SevenRooms alive: ${alive.length}`);
  console.log(`   💀 Dead/not found: ${dead.length}`);

  if (resy.length > 0) {
    console.log(`\n   Switch to Resy:`);
    for (const [, v] of resy) console.log(`      ${v.name} → ${v.resySlug}`);
  }
  if (dead.length > 0) {
    console.log(`\n   Dead/missing:`);
    for (const [, v] of dead) console.log(`      ${v.name} → ${v.srReason}`);
  }
  console.log(`\n💾 Results: data/sevenrooms_24_puppeteer_results.json`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
