/**
 * verify-sevenrooms.js
 *
 * Puppeteer-based verification for restaurants listed under SevenRooms.
 * Visits each restaurant's website and detects what booking widget is embedded.
 * Also checks resy.com directly for each restaurant name.
 *
 * RUN: node scripts/verify-sevenrooms.js
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BM_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'sevenrooms_verification.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// The 24 SevenRooms restaurants from the scan
const SEVENROOMS_LIST = [
  'Albertos Cocina',
  'American Cut Steakhouse Tribeca',
  'C Italian Restaurant',
  'Dhania Fine Indian',
  'Fine & Rare',
  "Friedman's West End",
  'Pilot',
  'Ponte Modern American',
  'Portale Restaurant',
  'The View',
  'VYBES CUISINE',
  'abc cocina',
  'city island yacht club',
  'close up',
  'corner store',
  'drift in',
  'el lugar cantina',
  'momofuku ko',
  'nerai',
  "or'esh",
  'redfarm',
  'scarpetta',
  'the eighty six',
  'the fulton on pier 17',
];

// Load booking master
let BM = {};
try {
  BM = JSON.parse(fs.readFileSync(BM_FILE, 'utf8'));
  console.log(`✅ Loaded BOOKING_MASTER: ${Object.keys(BM).length} entries`);
} catch (e) {
  console.error('❌ Cannot load BOOKING_MASTER.json');
  process.exit(1);
}

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
  await page.setViewport({ width: 1366, height: 768 });
  return page;
}

/**
 * Visit a restaurant's website and detect booking platform widgets
 */
async function detectPlatformOnWebsite(page, url, name) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(2000);

    const result = await page.evaluate(() => {
      const html = document.documentElement.innerHTML.toLowerCase();
      const body = document.body?.innerText || '';

      const platforms = {};

      // SevenRooms detection
      if (html.includes('sevenrooms.com') || html.includes('sevenrooms') ||
          html.includes('7rooms') || html.includes('widget.sevenrooms')) {
        platforms.sevenrooms = true;
      }

      // Resy detection
      if (html.includes('resy.com') || html.includes('resywidget') ||
          html.includes('resy-widget') || html.includes('widgets.resy')) {
        platforms.resy = true;
      }

      // OpenTable detection
      if (html.includes('opentable.com') || html.includes('ot-widget') ||
          html.includes('opentable') || html.includes('restref.com')) {
        platforms.opentable = true;
      }

      // Tock detection
      if (html.includes('exploretock.com') || html.includes('tock.') ||
          html.includes('tockhq')) {
        platforms.tock = true;
      }

      // Yelp reservation detection
      if (html.includes('yelp.com/reservations') || html.includes('yelpreservations')) {
        platforms.yelp = true;
      }

      // Toast/ToastTab detection
      if (html.includes('toasttab.com')) {
        platforms.toast = true;
      }

      // Olo detection
      if (html.includes('olo.com')) {
        platforms.olo = true;
      }

      // Check for dead/parked sites
      const isDead = body.includes('This site can') ||
                     body.includes('no longer available') ||
                     body.includes('domain is for sale') ||
                     body.includes('coming soon') ||
                     body.length < 100;

      return { platforms, isDead, bodyLength: body.length };
    });

    return result;
  } catch (e) {
    return { platforms: {}, error: e.message, isDead: false };
  }
}

/**
 * Check if restaurant exists on Resy by visiting search
 */
async function checkResyDirect(page, name) {
  try {
    const slug = name.toLowerCase()
      .replace(/['']/g, '')
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    const url = `https://resy.com/cities/ny/${slug}?date=2026-03-29&seats=2`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(3000);

    const result = await page.evaluate(() => {
      const body = document.body?.innerText || '';
      const is404 = body.includes('page not found') || body.includes('404') ||
                     body.includes('no longer available') || body.includes("doesn't exist");

      // Check if venue name appears (successful page load)
      const hasVenue = body.includes('Reserve') || body.includes('Notify') ||
                       body.includes('seats') || body.includes('Find a Time');

      return { is404, hasVenue, bodyLength: body.length, sample: body.substring(0, 200) };
    });

    return { slug, found: !result.is404 && result.hasVenue, ...result };
  } catch (e) {
    return { found: false, error: e.message };
  }
}

async function main() {
  const results = {};
  const browser = await launchBrowser();
  const page = await setupPage(browser);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔍 Verifying ${SEVENROOMS_LIST.length} SevenRooms restaurants`);
  console.log(`${'═'.repeat(60)}\n`);

  for (let i = 0; i < SEVENROOMS_LIST.length; i++) {
    const name = SEVENROOMS_LIST[i];
    const entry = BM[name] || BM[name.toLowerCase()];
    const websiteUrl = entry?.website || entry?.url;

    console.log(`\n[${i+1}/${SEVENROOMS_LIST.length}] ${name}`);

    const result = { name, currentPlatform: entry?.platform, websiteUrl };

    // Step 1: Check the restaurant's own website for booking widgets
    if (websiteUrl && !websiteUrl.includes('resy.com') && !websiteUrl.includes('opentable.com')) {
      console.log(`  📡 Checking website: ${websiteUrl}`);
      const webResult = await detectPlatformOnWebsite(page, websiteUrl, name);
      result.websiteDetection = webResult;

      const found = Object.keys(webResult.platforms || {});
      if (found.length > 0) {
        console.log(`  ✅ Detected on website: ${found.join(', ')}`);
      } else if (webResult.isDead) {
        console.log(`  💀 Website appears dead/empty`);
      } else if (webResult.error) {
        console.log(`  ⚠️ Website error: ${webResult.error}`);
      } else {
        console.log(`  ❌ No booking platform detected on website`);
      }
    } else {
      console.log(`  ⏭️ No independent website to check (URL points to booking platform)`);
    }

    // Step 2: Check Resy directly
    console.log(`  🔍 Checking Resy...`);
    const resyResult = await checkResyDirect(page, name);
    result.resyCheck = resyResult;
    if (resyResult.found) {
      console.log(`  🟢 FOUND on Resy (slug: ${resyResult.slug})`);
    } else {
      console.log(`  ⚫ Not found on Resy (slug: ${resyResult.slug})`);
    }

    results[name] = result;
    await sleep(2000 + Math.floor(Math.random() * 3000));
  }

  await browser.close();

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('📊 SUMMARY');
  console.log(`${'═'.repeat(60)}\n`);

  const onResy = [], confirmedSR = [], noPlatform = [], dead = [];

  for (const [name, r] of Object.entries(results)) {
    const webPlatforms = Object.keys(r.websiteDetection?.platforms || {});

    if (r.resyCheck?.found) {
      onResy.push(name);
      console.log(`  🔄 MOVE TO RESY: ${name} (slug: ${r.resyCheck.slug})`);
    } else if (webPlatforms.includes('sevenrooms')) {
      confirmedSR.push(name);
      console.log(`  ✅ CONFIRMED SevenRooms: ${name}`);
    } else if (r.websiteDetection?.isDead) {
      dead.push(name);
      console.log(`  💀 DEAD: ${name}`);
    } else if (webPlatforms.length > 0) {
      console.log(`  🔀 OTHER PLATFORM (${webPlatforms.join(',')}): ${name}`);
    } else {
      noPlatform.push(name);
      console.log(`  ❓ UNVERIFIED: ${name}`);
    }
  }

  console.log(`\n  Resy: ${onResy.length} | SevenRooms confirmed: ${confirmedSR.length} | Dead: ${dead.length} | Unverified: ${noPlatform.length}`);

  // Save results
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\n💾 Saved to ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
