/**
 * scrape-sevenrooms-directory.js
 *
 * Discovers all SevenRooms restaurants in NYC using multiple approaches:
 * 1. SevenRooms explore/discover pages (if they have a public directory)
 * 2. Google search: site:sevenrooms.com/reservations + NYC
 * 3. Google search: site:sevenrooms.com/explore + NYC
 *
 * Saves results to data/sevenrooms_nyc_directory.json (NOT to BOOKING_MASTER)
 *
 * RUN: node scripts/scrape-sevenrooms-directory.js
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const OUTPUT = path.join(__dirname, '..', 'data', 'sevenrooms_nyc_directory.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Google search queries to find SevenRooms NYC restaurants
const GOOGLE_QUERIES = [
  'site:sevenrooms.com/reservations new york',
  'site:sevenrooms.com/reservations nyc',
  'site:sevenrooms.com/reservations manhattan',
  'site:sevenrooms.com/reservations brooklyn',
  'site:sevenrooms.com/reservations queens',
  'site:sevenrooms.com/explore new york',
  'site:sevenrooms.com/explore nyc',
  'site:sevenrooms.com/explore manhattan',
  'site:sevenrooms.com/explore brooklyn',
  // Cuisine-specific searches
  'site:sevenrooms.com/reservations restaurant new york italian',
  'site:sevenrooms.com/reservations restaurant new york japanese',
  'site:sevenrooms.com/reservations restaurant new york french',
  'site:sevenrooms.com/reservations restaurant new york steakhouse',
  'site:sevenrooms.com/reservations restaurant new york chinese',
  'site:sevenrooms.com/reservations restaurant new york indian',
  'site:sevenrooms.com/reservations restaurant new york mexican',
  'site:sevenrooms.com/reservations restaurant new york thai',
  'site:sevenrooms.com/reservations restaurant new york korean',
  'site:sevenrooms.com/reservations restaurant new york seafood',
  'site:sevenrooms.com/reservations restaurant new york bar',
  'site:sevenrooms.com/reservations restaurant new york brunch',
  'site:sevenrooms.com/reservations restaurant new york fine dining',
  'site:sevenrooms.com/reservations restaurant new york pizza',
  'site:sevenrooms.com/reservations restaurant new york sushi',
  'site:sevenrooms.com/reservations restaurant new york mediterranean',
  'site:sevenrooms.com/reservations restaurant new york american',
  'site:sevenrooms.com/reservations restaurant new york midtown',
  'site:sevenrooms.com/reservations restaurant new york downtown',
  'site:sevenrooms.com/reservations restaurant new york soho',
  'site:sevenrooms.com/reservations restaurant new york tribeca',
  'site:sevenrooms.com/reservations restaurant new york west village',
  'site:sevenrooms.com/reservations restaurant new york east village',
  'site:sevenrooms.com/reservations restaurant new york upper east side',
  'site:sevenrooms.com/reservations restaurant new york upper west side',
  'site:sevenrooms.com/reservations restaurant new york chelsea',
  'site:sevenrooms.com/reservations restaurant new york flatiron',
  'site:sevenrooms.com/reservations restaurant new york williamsburg',
  'site:sevenrooms.com/reservations restaurant new york harlem',
  'site:sevenrooms.com/reservations restaurant new york lower east side',
  'site:sevenrooms.com/reservations restaurant new york gramercy',
  'site:sevenrooms.com/reservations restaurant new york murray hill',
  'site:sevenrooms.com/reservations restaurant new york hell\'s kitchen',
  'site:sevenrooms.com/reservations restaurant new york financial district',
  'site:sevenrooms.com/reservations restaurant new york greenpoint',
  'site:sevenrooms.com/reservations restaurant new york astoria',
  // Also search without "restaurant" qualifier
  'site:sevenrooms.com/reservations new york lounge',
  'site:sevenrooms.com/reservations new york club',
  'site:sevenrooms.com/reservations new york rooftop',
  'site:sevenrooms.com/reservations new york cocktail',
  'site:sevenrooms.com/reservations new york brunch spot',
  // Broader searches with just sevenrooms.com
  'sevenrooms.com reservations nyc restaurant',
  'sevenrooms.com reservations new york restaurant -site:yelp.com -site:tripadvisor.com',
];

// All discovered slugs
const allSlugs = new Map(); // slug -> { name, url, source }

function extractSlug(url) {
  const m = url.match(/sevenrooms\.com\/(?:reservations|explore)\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

async function scrapeGoogleResults(page, query, queryIndex, totalQueries) {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=100`;
  console.log(`\n  🔍 [${queryIndex}/${totalQueries}] ${query}`);

  try {
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(2000 + Math.random() * 2000);

    // Check for CAPTCHA
    const html = await page.content();
    if (html.includes('unusual traffic') || html.includes('captcha') || html.includes('CAPTCHA')) {
      console.log('  ⚠️  Google CAPTCHA detected — waiting 30s...');
      await sleep(30000);
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20000 });
      await sleep(3000);
    }

    // Extract all sevenrooms links from search results
    const results = await page.evaluate(() => {
      const items = [];
      // Get all links on page
      const links = document.querySelectorAll('a[href]');
      for (const link of links) {
        const href = link.href;
        if (href.includes('sevenrooms.com/reservations/') || href.includes('sevenrooms.com/explore/')) {
          // Get the title text
          const titleEl = link.querySelector('h3') || link;
          const title = titleEl?.textContent?.trim() || '';
          items.push({ url: href, title });
        }
      }
      return items;
    });

    let newCount = 0;
    for (const r of results) {
      const slug = extractSlug(r.url);
      if (slug && !allSlugs.has(slug)) {
        allSlugs.set(slug, {
          slug,
          name: r.title.replace(/ - SevenRooms.*$/i, '').replace(/ \| .*$/i, '').trim(),
          url: `https://www.sevenrooms.com/reservations/${slug}`,
          source: 'google',
          query
        });
        newCount++;
      }
    }
    console.log(`     Found ${results.length} links, ${newCount} new slugs (total: ${allSlugs.size})`);

    // Try to get more results - click "More results" / pagination
    const hasNext = await page.evaluate(() => {
      const next = document.querySelector('#pnnext') || document.querySelector('a[aria-label="Next"]');
      return !!next;
    });

    if (hasNext && results.length > 0) {
      // Scrape up to 3 more pages
      for (let p = 2; p <= 4; p++) {
        try {
          const nextUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=100&start=${(p-1)*100}`;
          await page.goto(nextUrl, { waitUntil: 'networkidle2', timeout: 15000 });
          await sleep(2000 + Math.random() * 2000);

          const moreResults = await page.evaluate(() => {
            const items = [];
            const links = document.querySelectorAll('a[href]');
            for (const link of links) {
              const href = link.href;
              if (href.includes('sevenrooms.com/reservations/') || href.includes('sevenrooms.com/explore/')) {
                const titleEl = link.querySelector('h3') || link;
                items.push({ url: href, title: titleEl?.textContent?.trim() || '' });
              }
            }
            return items;
          });

          let pageNew = 0;
          for (const r of moreResults) {
            const slug = extractSlug(r.url);
            if (slug && !allSlugs.has(slug)) {
              allSlugs.set(slug, {
                slug,
                name: r.title.replace(/ - SevenRooms.*$/i, '').replace(/ \| .*$/i, '').trim(),
                url: `https://www.sevenrooms.com/reservations/${slug}`,
                source: 'google',
                query
              });
              pageNew++;
            }
          }
          console.log(`     Page ${p}: ${moreResults.length} links, ${pageNew} new (total: ${allSlugs.size})`);
          if (moreResults.length === 0) break;
        } catch (e) {
          break;
        }
      }
    }

  } catch (e) {
    console.log(`  ⚠️  Error: ${e.message}`);
  }
}

async function trySevenRoomsDiscover(page) {
  // SevenRooms has a discover/marketplace feature
  const discoverUrls = [
    'https://www.sevenrooms.com/discover/new-york',
    'https://www.sevenrooms.com/discover/nyc',
    'https://www.sevenrooms.com/discover/new-york-city',
    'https://www.sevenrooms.com/explore/new-york',
    'https://www.sevenrooms.com/explore/nyc',
    'https://www.sevenrooms.com/marketplace/new-york',
    'https://www.sevenrooms.com/landing/new-york',
  ];

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Phase 1: Checking SevenRooms discover/explore pages');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Intercept API calls
  const apiCalls = [];
  page.on('response', async res => {
    const url = res.url();
    if (url.includes('sevenrooms.com') && url.includes('api')) {
      try {
        const body = await res.text();
        apiCalls.push({ url, status: res.status(), bodyLen: body.length });
      } catch (e) {}
    }
  });

  for (const url of discoverUrls) {
    try {
      console.log(`  Trying: ${url}`);
      const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
      const status = resp?.status();

      if (status === 200) {
        console.log(`  ✅ Got 200! Scraping...`);
        await sleep(3000);

        // Scroll to load all content
        for (let i = 0; i < 50; i++) {
          await page.evaluate(() => window.scrollBy(0, 800));
          await sleep(300);
        }

        const found = await page.evaluate(() => {
          const results = [];
          // Look for restaurant cards/links
          const links = document.querySelectorAll('a[href*="sevenrooms.com"]');
          for (const link of links) {
            const href = link.href;
            const match = href.match(/sevenrooms\.com\/(?:reservations|explore)\/([a-zA-Z0-9_-]+)/);
            if (match) {
              results.push({
                slug: match[1],
                name: link.textContent?.trim()?.substring(0, 100) || '',
                url: href
              });
            }
          }
          // Also check for any JSON data in script tags
          const scripts = document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]');
          for (const s of scripts) {
            try {
              const data = JSON.parse(s.textContent);
              if (typeof data === 'object') {
                const str = JSON.stringify(data);
                const matches = str.matchAll(/sevenrooms\.com\/(?:reservations|explore)\/([a-zA-Z0-9_-]+)/g);
                for (const m of matches) results.push({ slug: m[1], name: '', url: `https://www.sevenrooms.com/reservations/${m[1]}` });
              }
            } catch (e) {}
          }
          return results;
        });

        for (const r of found) {
          if (!allSlugs.has(r.slug)) {
            allSlugs.set(r.slug, { ...r, source: 'discover' });
          }
        }
        console.log(`  Found ${found.length} restaurants from ${url}`);
      } else {
        console.log(`  ❌ Status ${status}`);
      }
    } catch (e) {
      console.log(`  ❌ ${e.message?.substring(0, 60)}`);
    }
  }

  if (apiCalls.length > 0) {
    console.log(`\n  📡 Detected ${apiCalls.length} API calls:`);
    apiCalls.forEach(c => console.log(`     ${c.url.substring(0, 100)} [${c.status}]`));
  }
}

async function verifySlugsBatch(page, slugs) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Phase 3: Verifying ${slugs.length} slugs are live`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let verified = 0, dead = 0;

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const entry = allSlugs.get(slug);

    try {
      const url = `https://www.sevenrooms.com/reservations/${slug}`;
      const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 12000 });
      await sleep(1500);

      const status = resp?.status();
      const body = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
      const title = await page.title();

      const isDead = status === 404 ||
                     body.includes('off the menu') ||
                     body.includes('page not found') ||
                     body.includes('Page not found') ||
                     body.includes('no longer available');

      if (!isDead) {
        entry.verified = true;
        entry.title = title.replace(/ - SevenRooms.*$/i, '').replace(/ \| SevenRooms$/i, '').trim();
        if (!entry.name || entry.name.length < 3) entry.name = entry.title;
        verified++;
      } else {
        entry.verified = false;
        dead++;
      }

      if ((i + 1) % 25 === 0 || i === slugs.length - 1) {
        console.log(`  [${i+1}/${slugs.length}] ✅ ${verified} live, ❌ ${dead} dead`);
        // Save progress
        saveResults();
      }
    } catch (e) {
      entry.verified = false;
      entry.error = e.message;
      dead++;
    }

    await sleep(1500 + Math.random() * 1000);
  }

  return { verified, dead };
}

function saveResults() {
  const results = {
    scraped_at: new Date().toISOString(),
    total: allSlugs.size,
    verified: [...allSlugs.values()].filter(s => s.verified).length,
    restaurants: Object.fromEntries(allSlugs)
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
}

async function main() {
  // Load existing results if any (for resuming)
  let resuming = false;
  if (fs.existsSync(OUTPUT)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
      if (existing.restaurants) {
        for (const [slug, data] of Object.entries(existing.restaurants)) {
          allSlugs.set(slug, data);
        }
        resuming = true;
        console.log(`📂 Loaded ${allSlugs.size} existing slugs from previous run`);
      }
    } catch (e) {}
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

  console.log('═══════════════════════════════════════════════');
  console.log('🔍 SevenRooms NYC Directory Scraper');
  console.log('═══════════════════════════════════════════════\n');

  // Phase 1: Try SevenRooms own discover pages
  await trySevenRoomsDiscover(page);
  console.log(`\n📊 After Phase 1: ${allSlugs.size} slugs\n`);

  // Phase 2: Google searches
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Phase 2: Google search discovery');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  for (let i = 0; i < GOOGLE_QUERIES.length; i++) {
    await scrapeGoogleResults(page, GOOGLE_QUERIES[i], i + 1, GOOGLE_QUERIES.length);
    // Save progress after each query
    saveResults();
    // Reasonable delay between Google searches to avoid rate limiting
    await sleep(4000 + Math.random() * 4000);
  }

  console.log(`\n📊 After Phase 2: ${allSlugs.size} slugs\n`);

  // Phase 3: Verify all unverified slugs
  const unverified = [...allSlugs.keys()].filter(s => allSlugs.get(s).verified === undefined);
  if (unverified.length > 0) {
    const { verified, dead } = await verifySlugsBatch(page, unverified);
    console.log(`\n📊 Verification complete: ${verified} live, ${dead} dead`);
  }

  await browser.close();

  // Final save
  saveResults();

  // Summary
  const live = [...allSlugs.values()].filter(s => s.verified);
  const dead = [...allSlugs.values()].filter(s => s.verified === false);

  console.log('\n═══════════════════════════════════════════════');
  console.log('📊 FINAL RESULTS');
  console.log('═══════════════════════════════════════════════\n');
  console.log(`Total slugs discovered: ${allSlugs.size}`);
  console.log(`✅ Verified live: ${live.length}`);
  console.log(`❌ Dead/off menu: ${dead.length}`);
  console.log(`\n💾 Saved to ${OUTPUT}`);

  if (live.length > 0) {
    console.log('\nSample live restaurants:');
    live.slice(0, 20).forEach(r => console.log(`  ✅ ${r.name || r.slug} → sevenrooms.com/reservations/${r.slug}`));
  }
}

main().catch(e => { console.error('❌', e); process.exit(1); });
