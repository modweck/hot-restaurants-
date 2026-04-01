/**
 * extract-sevenrooms-slugs.js
 *
 * Visits each SevenRooms restaurant's actual website with Puppeteer,
 * extracts the real SevenRooms slug from embedded widgets/links,
 * then verifies the slug is live.
 *
 * RUN: node scripts/extract-sevenrooms-slugs.js
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BM_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'sevenrooms_slugs.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let BM = {};
try {
  BM = JSON.parse(fs.readFileSync(BM_FILE, 'utf8'));
  console.log(`✅ Loaded BOOKING_MASTER: ${Object.keys(BM).length} entries`);
} catch (e) {
  console.error('❌ Cannot load BOOKING_MASTER.json');
  process.exit(1);
}

const SR_LIST = [
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
];

async function main() {
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

  // Intercept all requests to capture sevenrooms URLs
  const srUrls = new Set();
  page.on('request', req => {
    const u = req.url();
    if (u.includes('sevenrooms')) srUrls.add(u);
  });
  page.on('response', res => {
    const u = res.url();
    if (u.includes('sevenrooms')) srUrls.add(u);
  });

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔍 Extracting SevenRooms slugs from ${SR_LIST.length} restaurant websites`);
  console.log(`${'═'.repeat(60)}\n`);

  const results = {};

  for (let i = 0; i < SR_LIST.length; i++) {
    const name = SR_LIST[i];
    const entry = BM[name] || BM[name.toLowerCase()];
    const websiteUrl = entry?.website || entry?.url;

    if (!websiteUrl || websiteUrl.includes('sevenrooms.com') || websiteUrl.includes('resy.com') || websiteUrl.includes('opentable.com')) {
      console.log(`  ⏭️ [${i+1}/${SR_LIST.length}] ${name} — no independent website`);
      results[name] = { found: false, reason: 'no_website' };
      continue;
    }

    // Clear tracked URLs
    srUrls.clear();

    try {
      console.log(`  📡 [${i+1}/${SR_LIST.length}] ${name} — visiting ${websiteUrl}`);
      await page.goto(websiteUrl, { waitUntil: 'networkidle2', timeout: 20000 });
      await sleep(3000);

      // Extract SevenRooms references from HTML
      const htmlSlugs = await page.evaluate(() => {
        const html = document.documentElement.innerHTML;
        const slugs = new Set();

        // Match sevenrooms.com/reservations/SLUG
        const resMatch = html.matchAll(/sevenrooms\.com\/reservations\/([a-zA-Z0-9_-]+)/g);
        for (const m of resMatch) slugs.add(m[1]);

        // Match sevenrooms.com/explore/SLUG
        const expMatch = html.matchAll(/sevenrooms\.com\/explore\/([a-zA-Z0-9_-]+)/g);
        for (const m of expMatch) slugs.add(m[1]);

        // Match widget venue IDs or slugs in data attributes
        const widgetMatch = html.matchAll(/sevenrooms[^"']*?venue[^"']*?[=:]["']([a-zA-Z0-9_-]+)["']/gi);
        for (const m of widgetMatch) slugs.add(m[1]);

        // Match iframe src with sevenrooms
        const iframes = document.querySelectorAll('iframe[src*="sevenrooms"]');
        for (const iframe of iframes) {
          const src = iframe.src;
          const iframeMatch = src.match(/sevenrooms\.com\/(?:reservations|explore)\/([a-zA-Z0-9_-]+)/);
          if (iframeMatch) slugs.add(iframeMatch[1]);
        }

        // Check all links
        const links = document.querySelectorAll('a[href*="sevenrooms"]');
        for (const link of links) {
          const href = link.href;
          const linkMatch = href.match(/sevenrooms\.com\/(?:reservations|explore)\/([a-zA-Z0-9_-]+)/);
          if (linkMatch) slugs.add(linkMatch[1]);
        }

        return [...slugs];
      });

      // Also check network requests for slugs
      const networkSlugs = [];
      for (const u of srUrls) {
        const m = u.match(/sevenrooms\.com\/(?:reservations|explore)\/([a-zA-Z0-9_-]+)/);
        if (m) networkSlugs.push(m[1]);
      }

      const allSlugs = [...new Set([...htmlSlugs, ...networkSlugs])];

      if (allSlugs.length > 0) {
        console.log(`  🔑 Found slugs: ${allSlugs.join(', ')}`);

        // Verify the first slug is live
        const slug = allSlugs[0];
        const verifyUrl = `https://www.sevenrooms.com/reservations/${slug}`;
        await page.goto(verifyUrl, { waitUntil: 'networkidle2', timeout: 15000 });
        await sleep(2000);
        const body = await page.evaluate(() => document.body?.innerText || '');
        const isLive = !body.includes('off the menu') && !body.includes('page not found');

        results[name] = { found: true, slugs: allSlugs, primarySlug: slug, live: isLive };
        console.log(`  ${isLive ? '✅ LIVE' : '❌ OFF MENU'} → sevenrooms.com/reservations/${slug}`);
      } else {
        // Check if sevenrooms appeared in network at all
        const hasSR = srUrls.size > 0;
        results[name] = { found: false, reason: hasSR ? 'sr_network_but_no_slug' : 'not_on_sevenrooms', networkHits: [...srUrls].slice(0, 3) };
        console.log(`  ❌ No SevenRooms slug found${hasSR ? ' (SR network requests detected but no slug)' : ''}`);
      }

    } catch (e) {
      results[name] = { found: false, reason: 'error', error: e.message };
      console.log(`  ⚠️ Error: ${e.message}`);
    }

    await sleep(2000);
  }

  await browser.close();

  // Summary
  const live = Object.entries(results).filter(([,r]) => r.found && r.live);
  const offMenu = Object.entries(results).filter(([,r]) => r.found && !r.live);
  const notFound = Object.entries(results).filter(([,r]) => !r.found);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 RESULTS`);
  console.log(`${'═'.repeat(60)}\n`);

  console.log(`LIVE SevenRooms (${live.length}):`);
  live.forEach(([n, r]) => console.log(`  ✅ ${n} → ${r.primarySlug}`));

  if (offMenu.length > 0) {
    console.log(`\nSlug found but OFF MENU (${offMenu.length}):`);
    offMenu.forEach(([n, r]) => console.log(`  ⚠️ ${n} → ${r.primarySlug}`));
  }

  console.log(`\nNOT on SevenRooms (${notFound.length}):`);
  notFound.forEach(([n, r]) => console.log(`  ❌ ${n} — ${r.reason}`));

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\n💾 Saved to ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
