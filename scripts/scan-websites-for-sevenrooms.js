/**
 * scan-websites-for-sevenrooms.js
 *
 * Visits all "website" platform restaurants in BOOKING_MASTER,
 * checks if they embed SevenRooms widgets/links, and extracts slugs.
 * Then verifies the slug is live on sevenrooms.com.
 *
 * Resumable — saves progress after each batch.
 *
 * RUN: node scripts/scan-websites-for-sevenrooms.js
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BM_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const OUTPUT = path.join(__dirname, '..', 'data', 'sevenrooms_website_scan.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const master = JSON.parse(fs.readFileSync(BM_FILE, 'utf8'));

  // Get all website-platform entries with a real website URL
  const candidates = Object.entries(master)
    .filter(([, v]) => v.platform === 'website' && v.website)
    .filter(([, v]) => {
      const w = v.website.toLowerCase();
      // Skip if website is already a booking platform
      return !w.includes('sevenrooms.com') && !w.includes('resy.com') &&
             !w.includes('opentable.com') && !w.includes('exploretock.com') &&
             !w.includes('yelp.com') && !w.includes('instagram.com') &&
             !w.includes('facebook.com');
    });

  console.log(`Candidates to scan: ${candidates.length}`);

  // Load existing progress
  let results = { found: {}, checked: {} };
  if (fs.existsSync(OUTPUT)) {
    try {
      results = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
      console.log(`Resuming — ${Object.keys(results.checked).length} already checked, ${Object.keys(results.found).length} found`);
    } catch (e) {}
  }

  const toCheck = candidates.filter(([name]) => !results.checked[name]);
  console.log(`Remaining: ${toCheck.length}\n`);

  if (toCheck.length === 0) {
    printSummary(results);
    return;
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1366, height: 768 });

  // Track sevenrooms network requests
  const srUrls = new Set();
  page.on('request', req => {
    const u = req.url();
    if (u.includes('sevenrooms')) srUrls.add(u);
  });
  page.on('response', res => {
    const u = res.url();
    if (u.includes('sevenrooms')) srUrls.add(u);
  });

  console.log('═══════════════════════════════════════════════');
  console.log('🔍 Scanning restaurant websites for SevenRooms');
  console.log('═══════════════════════════════════════════════\n');

  for (let i = 0; i < toCheck.length; i++) {
    const [name, entry] = toCheck[i];
    srUrls.clear();

    try {
      await page.goto(entry.website, { waitUntil: 'networkidle2', timeout: 12000 });
      await sleep(2000);

      // Extract SevenRooms references from HTML + network
      const htmlSlugs = await page.evaluate(() => {
        const html = document.documentElement.innerHTML;
        const slugs = new Set();

        // sevenrooms.com/reservations/SLUG
        for (const m of html.matchAll(/sevenrooms\.com\/reservations\/([a-zA-Z0-9_-]+)/g)) slugs.add(m[1]);
        // sevenrooms.com/explore/SLUG
        for (const m of html.matchAll(/sevenrooms\.com\/explore\/([a-zA-Z0-9_-]+)/g)) slugs.add(m[1]);
        // Widget venue slugs
        for (const m of html.matchAll(/sevenrooms[^"']*?venue[^"']*?[=:]["']([a-zA-Z0-9_-]+)["']/gi)) slugs.add(m[1]);
        // iframes
        for (const iframe of document.querySelectorAll('iframe[src*="sevenrooms"]')) {
          const im = iframe.src.match(/sevenrooms\.com\/(?:reservations|explore)\/([a-zA-Z0-9_-]+)/);
          if (im) slugs.add(im[1]);
        }
        // links
        for (const link of document.querySelectorAll('a[href*="sevenrooms"]')) {
          const lm = link.href.match(/sevenrooms\.com\/(?:reservations|explore)\/([a-zA-Z0-9_-]+)/);
          if (lm) slugs.add(lm[1]);
        }

        // Also check for sevenrooms widget embed script
        const hasWidget = html.includes('sevenrooms.com/widget') || html.includes('sevenrooms.com/embed');

        return { slugs: [...slugs], hasWidget };
      });

      // Network slugs
      const networkSlugs = [];
      for (const u of srUrls) {
        const m = u.match(/sevenrooms\.com\/(?:reservations|explore)\/([a-zA-Z0-9_-]+)/);
        if (m) networkSlugs.push(m[1]);
      }

      const allSlugs = [...new Set([...htmlSlugs.slugs, ...networkSlugs])];
      const hasAnySR = allSlugs.length > 0 || htmlSlugs.hasWidget || srUrls.size > 0;

      results.checked[name] = true;

      if (allSlugs.length > 0) {
        results.found[name] = {
          slugs: allSlugs,
          primarySlug: allSlugs[0],
          website: entry.website,
          address: entry.address
        };
        console.log(`  ✅ [${i+1}/${toCheck.length}] ${name} → ${allSlugs.join(', ')}`);
      } else if (hasAnySR) {
        results.found[name] = {
          slugs: [],
          hasWidget: true,
          networkHits: [...srUrls].slice(0, 3),
          website: entry.website,
          address: entry.address
        };
        console.log(`  🔶 [${i+1}/${toCheck.length}] ${name} — SR widget detected but no slug`);
      } else {
        if ((i + 1) % 100 === 0) {
          console.log(`  · [${i+1}/${toCheck.length}] checked... (${Object.keys(results.found).length} found so far)`);
        }
      }

    } catch (e) {
      results.checked[name] = true;
      // Don't log timeouts, too noisy
    }

    // Save every 50
    if ((i + 1) % 50 === 0) {
      save(results);
    }

    await sleep(1500);
  }

  await browser.close();
  save(results);
  printSummary(results);
}

function save(results) {
  const output = {
    scanned_at: new Date().toISOString(),
    total_checked: Object.keys(results.checked).length,
    total_found: Object.keys(results.found).length,
    found: results.found,
    checked: results.checked
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
}

function printSummary(results) {
  const withSlugs = Object.entries(results.found).filter(([, v]) => v.slugs?.length > 0);
  const widgetOnly = Object.entries(results.found).filter(([, v]) => v.hasWidget && (!v.slugs || v.slugs.length === 0));

  console.log('\n═══════════════════════════════════════════════');
  console.log('📊 RESULTS');
  console.log('═══════════════════════════════════════════════\n');
  console.log(`Total scanned: ${Object.keys(results.checked).length}`);
  console.log(`✅ Found with slug: ${withSlugs.length}`);
  console.log(`🔶 Widget only (no slug): ${widgetOnly.length}`);

  if (withSlugs.length > 0) {
    console.log('\nWith booking slugs:');
    withSlugs.forEach(([n, v]) => console.log(`  ✅ ${n} → sevenrooms.com/reservations/${v.primarySlug}`));
  }
  if (widgetOnly.length > 0) {
    console.log('\nWidget detected but no slug:');
    widgetOnly.forEach(([n, v]) => console.log(`  🔶 ${n} — ${v.networkHits?.[0] || 'widget embed'}`));
  }

  console.log(`\n💾 Saved to ${OUTPUT}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
