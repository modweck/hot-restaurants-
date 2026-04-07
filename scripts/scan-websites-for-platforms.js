/**
 * scan-websites-for-platforms.js
 *
 * Visits all "website" platform restaurants in BOOKING_MASTER,
 * checks if they secretly embed booking widgets from known platforms:
 *   - Resy
 *   - OpenTable
 *   - SevenRooms
 *   - Tock
 *   - Yelp Reservations
 *   - Toast / ToastTab
 *   - Square (Squareup)
 *   - Google Reserve
 *   - Bentobox
 *   - Popmenu
 *
 * Resumable — saves progress after each batch.
 *
 * RUN:
 *   node scripts/scan-websites-for-platforms.js
 *   node scripts/scan-websites-for-platforms.js --limit 50
 *   node scripts/scan-websites-for-platforms.js --resume
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BM_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const OUTPUT = path.join(__dirname, '..', 'data', 'website_platform_scan.json');
const BATCH_SIZE = 25; // save every N restaurants

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const LIMIT = parseInt(getArg('limit', '9999'), 10);
const RESUME = args.includes('--resume');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Platform detection patterns ──
// Each platform has: links/hrefs, iframes, script tags, network requests, HTML patterns

const PLATFORM_PATTERNS = {
  resy: {
    linkPatterns: [/resy\.com/i],
    iframePatterns: [/resy\.com/i],
    htmlPatterns: [
      /resy\.com\/cities\/[^"'\s]+/i,
      /widgets\.resy\.com/i,
      /api\.resy\.com/i,
    ],
    networkPatterns: [/resy\.com/i],
    extract: (html, url) => {
      // Try to get slug
      const m = url.match(/resy\.com\/cities\/[^/]+\/venues?\/([a-z0-9-]+)/i)
        || html.match(/resy\.com\/cities\/[^/]+\/venues?\/([a-z0-9-]+)/i);
      return m ? { slug: m[1] } : {};
    }
  },
  opentable: {
    linkPatterns: [/opentable\.com/i],
    iframePatterns: [/opentable\.com/i],
    htmlPatterns: [
      /opentable\.com\/r\/([a-z0-9-]+)/i,
      /opentable\.com\/restref\/client/i,
      /opentable\.com\/widget/i,
      /data-ot-rid/i,
      /ot-reservation-widget/i,
    ],
    networkPatterns: [/opentable\.com/i],
    extract: (html, url) => {
      const slugMatch = (url + ' ' + html).match(/opentable\.com\/r\/([a-z0-9-]+)/i);
      const ridMatch = html.match(/(?:data-ot-rid|rid|restaurantId|restaurant_id)[=:"'\s]+(\d{4,})/i);
      return {
        slug: slugMatch ? slugMatch[1] : undefined,
        rid: ridMatch ? parseInt(ridMatch[1]) : undefined,
      };
    }
  },
  sevenrooms: {
    linkPatterns: [/sevenrooms\.com/i],
    iframePatterns: [/sevenrooms\.com/i],
    htmlPatterns: [
      /sevenrooms\.com\/reservations\/([a-zA-Z0-9_-]+)/i,
      /sevenrooms\.com\/explore\/([a-zA-Z0-9_-]+)/i,
      /sevenrooms\.com\/widget/i,
      /sevenrooms\.com\/embed/i,
    ],
    networkPatterns: [/sevenrooms\.com/i],
    extract: (html, url) => {
      const m = (url + ' ' + html).match(/sevenrooms\.com\/(?:reservations|explore)\/([a-zA-Z0-9_-]+)/i);
      return m ? { slug: m[1] } : {};
    }
  },
  tock: {
    linkPatterns: [/exploretock\.com/i],
    iframePatterns: [/exploretock\.com/i],
    htmlPatterns: [
      /exploretock\.com\/([a-z0-9-]+)/i,
      /tock-widget/i,
    ],
    networkPatterns: [/exploretock\.com/i],
    extract: (html, url) => {
      const m = (url + ' ' + html).match(/exploretock\.com\/([a-z0-9-]+)(?:[/?#]|$)/i);
      return m ? { slug: m[1] } : {};
    }
  },
  yelp: {
    linkPatterns: [/yelp\.com.*reservation/i, /yelp\.com\/biz\/[^"'\s]+/i],
    iframePatterns: [/yelp\.com/i],
    htmlPatterns: [
      /yelp\.com\/reservations/i,
      /yelpreservations/i,
    ],
    networkPatterns: [/yelp\.com.*reserv/i],
    extract: (html, url) => {
      const m = (url + ' ' + html).match(/yelp\.com\/biz\/([a-z0-9-]+)/i);
      return m ? { slug: m[1] } : {};
    }
  },
  toast: {
    linkPatterns: [/toasttab\.com/i],
    iframePatterns: [/toasttab\.com/i],
    htmlPatterns: [
      /toasttab\.com\/([a-z0-9-]+)/i,
      /toast-widget/i,
      /toastrestaurants\.com/i,
    ],
    networkPatterns: [/toasttab\.com/i],
    extract: (html, url) => {
      const m = (url + ' ' + html).match(/toasttab\.com\/([a-z0-9-]+)(?:[/?#]|$)/i);
      return m ? { slug: m[1] } : {};
    }
  },
  square: {
    linkPatterns: [/squareup\.com/i, /square\.site/i],
    iframePatterns: [/squareup\.com/i],
    htmlPatterns: [
      /squareup\.com\/appointments/i,
      /square\.site/i,
      /squarespace.*booking/i,
    ],
    networkPatterns: [/squareup\.com/i],
    extract: () => ({})
  },
  google_reserve: {
    linkPatterns: [/reserve\.google/i, /reserve-with-google/i],
    iframePatterns: [/reserve\.google/i],
    htmlPatterns: [
      /reserve\.google/i,
      /reserve-with-google/i,
      /reserveWithGoogle/i,
      /rwg_token/i,
    ],
    networkPatterns: [/reserve\.google/i, /rwg/i],
    extract: () => ({})
  },
  bentobox: {
    linkPatterns: [/getbento\.com/i, /bentobox/i],
    iframePatterns: [/getbento/i],
    htmlPatterns: [
      /getbento\.com/i,
      /bentobox/i,
      /bento-reservation/i,
    ],
    networkPatterns: [/getbento\.com/i],
    extract: () => ({})
  },
  popmenu: {
    linkPatterns: [/popmenu\.com/i],
    iframePatterns: [/popmenu/i],
    htmlPatterns: [
      /popmenu\.com/i,
      /popmenu-widget/i,
      /popmenucloud\.com/i,
    ],
    networkPatterns: [/popmenu/i],
    extract: () => ({})
  },
};

async function scanPage(page, networkUrls) {
  return await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    const results = {};

    // Collect all hrefs
    const allHrefs = [];
    document.querySelectorAll('a[href]').forEach(a => allHrefs.push(a.href));
    document.querySelectorAll('iframe[src]').forEach(f => allHrefs.push(f.src));

    // Also check meta tags, data attributes
    document.querySelectorAll('[data-src], [data-url], [data-href]').forEach(el => {
      const v = el.getAttribute('data-src') || el.getAttribute('data-url') || el.getAttribute('data-href');
      if (v) allHrefs.push(v);
    });

    return { html: html.substring(0, 200000), hrefs: allHrefs };
  });
}

function detectPlatforms(pageData, networkUrls) {
  const found = {};

  for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
    let detected = false;
    const signals = [];

    // Check hrefs for link patterns
    for (const href of pageData.hrefs) {
      for (const pat of patterns.linkPatterns) {
        if (pat.test(href)) {
          detected = true;
          signals.push(`link: ${href.substring(0, 120)}`);
          break;
        }
      }
    }

    // Check HTML content
    for (const pat of patterns.htmlPatterns) {
      if (pat.test(pageData.html)) {
        detected = true;
        signals.push(`html: ${pat.source}`);
        break; // one is enough
      }
    }

    // Check network requests
    for (const url of networkUrls) {
      for (const pat of patterns.networkPatterns) {
        if (pat.test(url)) {
          detected = true;
          signals.push(`network: ${url.substring(0, 120)}`);
          break;
        }
      }
    }

    if (detected) {
      const extracted = patterns.extract(pageData.html, pageData.hrefs.join(' '));
      found[platform] = {
        signals: [...new Set(signals)].slice(0, 3), // dedupe, keep top 3
        ...extracted,
      };
    }
  }

  return found;
}

async function main() {
  const master = JSON.parse(fs.readFileSync(BM_FILE, 'utf8'));

  // Get truly website-only entries: no resy/ot/tock slugs, no platform URLs
  const candidates = Object.entries(master)
    .filter(([, v]) => {
      if (v.platform !== 'website') return false;
      if (!(v.url || v.website)) return false;
      // Skip ones that already have a known platform slug/ID
      if (v.resy_slug || v.ot_slug || v.ot_rid || v.tock_url || v.venue_id) return false;
      if (v.opentable_url || v.resy_url || v.booking_url) return false;
      return true;
    })
    .map(([name, v]) => [name, v.url || v.website]);

  console.log(`Total website restaurants: ${candidates.length}`);

  // Load existing progress
  let results = { found: {}, checked: {}, errors: {}, stats: {} };
  if (fs.existsSync(OUTPUT) && RESUME) {
    try {
      results = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
      console.log(`Resuming - ${Object.keys(results.checked).length} already checked, ${Object.keys(results.found).length} found`);
    } catch (e) {}
  }

  const toCheck = candidates.filter(([name]) => !results.checked[name]).slice(0, LIMIT);
  console.log(`To scan: ${toCheck.length}\n`);

  if (toCheck.length === 0) {
    printSummary(results);
    return;
  }

  const networkUrls = new Set();

  async function launchBrowser() {
    const b = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-gpu']
    });
    const p = await b.newPage();
    await p.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    await p.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await p.setViewport({ width: 1366, height: 768 });
    await p.setRequestInterception(true);
    p.on('request', req => {
      networkUrls.add(req.url());
      if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
      else req.continue();
    });
    return { browser: b, page: p };
  }

  let { browser, page } = await launchBrowser();

  console.log('='.repeat(60));
  console.log('Scanning restaurant websites for hidden booking platforms');
  console.log('='.repeat(60) + '\n');

  let scanned = 0;
  let foundCount = 0;

  for (let i = 0; i < toCheck.length; i++) {
    const [name, url] = toCheck[i];
    networkUrls.clear();

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(2000); // let widgets/iframes load

      const pageData = await scanPage(page, networkUrls);
      const platforms = detectPlatforms(pageData, networkUrls);

      results.checked[name] = true;
      scanned++;

      if (Object.keys(platforms).length > 0) {
        results.found[name] = {
          url,
          platforms,
          scannedAt: new Date().toISOString(),
        };
        foundCount++;
        const platList = Object.keys(platforms).join(', ');
        console.log(`  FOUND [${i+1}/${toCheck.length}] ${name} -> ${platList}`);
      } else {
        if ((i + 1) % 50 === 0) {
          console.log(`  ... [${i+1}/${toCheck.length}] ${name} - no platforms`);
        }
      }
    } catch (e) {
      results.checked[name] = true;
      results.errors[name] = { url, error: e.message.substring(0, 100) };
    }

    // Save progress every batch
    if (scanned % BATCH_SIZE === 0) {
      updateStats(results);
      fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
    }

    // Small delay between sites
    await sleep(1000 + Math.random() * 2000);

    // Restart browser every 100 to stay fresh
    if (scanned % 100 === 0 && scanned > 0 && i < toCheck.length - 1) {
      console.log(`\n  -- Browser restart (${scanned} scanned, ${foundCount} found) --\n`);
      await browser.close();
      ({ browser, page } = await launchBrowser());
    }
  }

  // Final save
  updateStats(results);
  fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));

  await browser.close();
  printSummary(results);
}

function updateStats(results) {
  const stats = {};
  for (const [name, data] of Object.entries(results.found)) {
    for (const platform of Object.keys(data.platforms)) {
      stats[platform] = (stats[platform] || 0) + 1;
    }
  }
  results.stats = stats;
}

function printSummary(results) {
  console.log('\n' + '='.repeat(60));
  console.log('SCAN RESULTS');
  console.log('='.repeat(60));
  console.log(`Checked: ${Object.keys(results.checked).length}`);
  console.log(`Errors:  ${Object.keys(results.errors).length}`);
  console.log(`Found:   ${Object.keys(results.found).length}`);
  console.log('\nPlatforms detected:');

  updateStats(results);
  const sorted = Object.entries(results.stats).sort((a, b) => b[1] - a[1]);
  for (const [platform, count] of sorted) {
    console.log(`  ${platform.padEnd(15)} ${count}`);
  }

  // Show some examples per platform
  console.log('\nExamples:');
  for (const [platform] of sorted) {
    const examples = Object.entries(results.found)
      .filter(([, d]) => d.platforms[platform])
      .slice(0, 2)
      .map(([name, d]) => {
        const info = d.platforms[platform];
        const extra = info.slug ? ` (slug: ${info.slug})` : info.rid ? ` (rid: ${info.rid})` : '';
        return `${name}${extra}`;
      });
    console.log(`  ${platform}: ${examples.join(', ')}`);
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
