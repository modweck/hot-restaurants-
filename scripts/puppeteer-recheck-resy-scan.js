/**
 * puppeteer-recheck-resy-scan.js
 *
 * Puppeteer verification for the 182 restaurants from website_platform_scan.txt
 * that the Resy API couldn't confirm. Generates slug variations and visits
 * resy.com directly to check if pages are alive/bookable.
 *
 * RUN:   node scripts/puppeteer-recheck-resy-scan.js
 * OPTIONS:
 *   --quick       First 10 only
 *   --batch N     Check N then stop
 *   --all         Check ALL 228 (not just failed)
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const SCAN_FILE = path.join(__dirname, '..', 'data', 'website_platform_scan.txt');
const API_RESULTS = path.join(__dirname, '..', 'data', 'platform_scan_resy_verified.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'platform_scan_resy_puppeteer.json');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const ALL = args.includes('--all');
function getArg(name, def) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}
const BATCH_LIMIT = parseInt(getArg('batch', '0'), 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));
function randDelay() { return 8000 + Math.random() * 7000; } // 8-15s between requests

// Parse Resy names from scan file
function parseResyNames() {
  const text = fs.readFileSync(SCAN_FILE, 'utf8');
  const lines = text.split('\n');
  let inResy = false;
  const names = [];
  for (const line of lines) {
    if (line.startsWith('RESY (')) { inResy = true; continue; }
    if (inResy && /^[A-Z]/.test(line) && !line.startsWith('  ')) break;
    if (inResy && line.startsWith('  ')) {
      const name = line.trim();
      if (name && name !== 'n/a') names.push(name);
    }
  }
  return names;
}

// Generate slug variations from a restaurant name
function generateSlugs(name) {
  const base = name.toLowerCase()
    .replace(/[''`\u2019]/g, '')
    .replace(/&/g, 'and')
    .replace(/®/g, '')
    .replace(/\+/g, '-')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const slugs = new Set();
  slugs.add(base);

  // Without location suffixes
  const noLocation = base
    .replace(/-(nyc|ny|new-york|manhattan|brooklyn|queens|astoria|bushwick|chelsea|soho|tribeca|ues|uws|midtown|nj|jersey-city|crown-heights|union-square|east-village|west-village|park-slope|times-square|flushing|williamsburg|bed-stuy|edgewater|westchester-place|upper-west-side|5th-ave|third-avenue|on-the-hudson)$/g, '')
    .replace(/-+$/, '');
  if (noLocation !== base) slugs.add(noLocation);

  // Without common prefixes/suffixes
  const noSuffix = base
    .replace(/-(restaurant|ristorante|bistro|bar|grill|kitchen|cafe|steakhouse|chophouse|cantina|taphouse|lounge|club|tavern|diner|pizzeria|trattoria|osteria|brasserie)$/g, '')
    .replace(/-+$/, '');
  if (noSuffix !== base) slugs.add(noSuffix);

  // Without "the-"
  if (base.startsWith('the-')) slugs.add(base.slice(4));

  // With -ny or -nyc suffix
  slugs.add(base + '-ny');
  slugs.add(base + '-nyc');
  slugs.add(base + '-new-york');

  // Without trailing descriptors like "- tapas downtown"
  const dashParts = name.split(' - ');
  if (dashParts.length > 1) {
    const first = dashParts[0].toLowerCase()
      .replace(/[''`\u2019]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    slugs.add(first);
    slugs.add(first + '-ny');
    slugs.add(first + '-nyc');
  }

  // With / without "s" at end
  if (base.endsWith('s')) slugs.add(base.slice(0, -1));
  else slugs.add(base + 's');

  return [...slugs].filter(s => s.length > 1);
}

async function checkResyPage(page, slug) {
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
                       body.includes('check that the address') ||
                       body.includes('no longer available') ||
                       body.includes('page not found') ||
                       title.toLowerCase().includes('not found');

      const closed = body.includes('permanently closed') ||
                     body.includes('this venue is closed');

      const hasBooking = !!document.querySelector('[class*="ReservationButton"]') ||
                         !!document.querySelector('[class*="TimeSlot"]') ||
                         !!document.querySelector('button[data-test*="reserve"]') ||
                         body.includes('Find a Time') ||
                         body.includes('Notify Me') ||
                         body.includes('Reserve Now');

      const isHomepage = window.location.pathname === '/' ||
                         window.location.pathname === '/cities/ny';

      const venueNameEl = document.querySelector('h1');
      const venueName = venueNameEl ? venueNameEl.textContent.trim() : '';

      return { notFound, closed, hasBooking, isHomepage, venueName, finalUrl: window.location.href, bodyLen: body.length };
    });

    if (status === 404 || pageData.notFound || pageData.isHomepage) return { result: 'dead', status, slug };
    if (pageData.closed) return { result: 'closed', status, slug, venueName: pageData.venueName };
    if (pageData.hasBooking) return { result: 'alive', status, slug, venueName: pageData.venueName, finalUrl: pageData.finalUrl, url };
    if (status >= 200 && status < 400 && pageData.venueName && pageData.bodyLen > 500) {
      return { result: 'alive_no_widget', status, slug, venueName: pageData.venueName, finalUrl: pageData.finalUrl, url };
    }
    return { result: 'dead', status, slug };
  } catch (e) {
    return { result: 'error', slug, error: e.message };
  }
}

async function main() {
  const allNames = parseResyNames();
  let apiResults = {};
  try { apiResults = JSON.parse(fs.readFileSync(API_RESULTS, 'utf8'))._results || {}; } catch {}

  // Load existing puppeteer results for resume
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}
  if (!existing._results) existing._results = {};

  // Filter to only failed API entries (unless --all)
  let todo;
  if (ALL) {
    todo = allNames.filter(n => !existing._results[n]);
  } else {
    todo = allNames.filter(n => {
      if (existing._results[n]) return false; // already puppeteer-checked
      const api = apiResults[n];
      return !api || !api.valid; // API failed or false positive
    });
  }

  if (QUICK) todo = todo.slice(0, 10);
  if (BATCH_LIMIT > 0) todo = todo.slice(0, BATCH_LIMIT);

  console.log(`\n🔍 Puppeteer Resy Recheck`);
  console.log(`📋 Total from scan: ${allNames.length}`);
  console.log(`✅ Already puppeteer-checked: ${Object.keys(existing._results).length}`);
  console.log(`📋 To check: ${todo.length}`);
  console.log(`⏱️  Delay: 8-15s between slugs`);
  console.log(`${'═'.repeat(50)}\n`);

  if (todo.length === 0) { console.log('Nothing to check!'); return; }

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

  let alive = 0, dead = 0, errors = 0;

  for (let i = 0; i < todo.length; i++) {
    const name = todo[i];
    const slugs = generateSlugs(name);

    process.stdout.write(`  [${i + 1}/${todo.length}] ${name.substring(0, 40).padEnd(40)} `);

    let found = null;
    for (const slug of slugs) {
      const result = await checkResyPage(page, slug);

      if (result.result === 'alive' || result.result === 'alive_no_widget') {
        found = result;
        break;
      }

      // Small delay between slug attempts
      await sleep(3000 + Math.random() * 2000);
    }

    if (found) {
      existing._results[name] = {
        valid: true,
        result: found.result,
        slug: found.slug,
        venueName: found.venueName,
        url: found.url || `https://resy.com/cities/ny/${found.slug}`,
        finalUrl: found.finalUrl,
        checkedAt: new Date().toISOString()
      };
      alive++;
      const icon = found.result === 'alive' ? '🟢' : '🟡';
      console.log(`${icon} ${found.result} → ${found.venueName} (${found.slug})`);
    } else {
      existing._results[name] = {
        valid: false,
        slugsTried: slugs.slice(0, 5),
        checkedAt: new Date().toISOString()
      };
      dead++;
      console.log(`💀 dead (tried ${slugs.length} slugs)`);
    }

    // Save every 10
    if ((i + 1) % 10 === 0) {
      existing._meta = { alive, dead, errors, total: alive + dead + errors, checked_at: new Date().toISOString() };
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));
      console.log('  💾 Saved progress');
    }

    // Delay between restaurants
    if (i < todo.length - 1) await sleep(randDelay());
  }

  await browser.close();

  existing._meta = { alive, dead, errors, total: alive + dead + errors, checked_at: new Date().toISOString() };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 PUPPETEER RESULTS:`);
  console.log(`   🟢 Alive/bookable: ${alive}`);
  console.log(`   💀 Dead: ${dead}`);
  console.log(`   ❌ Errors: ${errors}`);
  console.log(`\n💾 Saved to data/platform_scan_resy_puppeteer.json`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
