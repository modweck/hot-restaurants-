/**
 * verify-ot-111-puppeteer.js
 *
 * Puppeteer-based verification of the 111 OT restaurants from platform_scan_ot_verified.json.
 * For each restaurant:
 *   1. If it has a verifiedUrl, visit it and confirm it's bookable + name matches
 *   2. If no URL or URL fails, search OT via Puppeteer and find the correct link
 *
 * RUN:   node scripts/verify-ot-111-puppeteer.js
 * OPTIONS:
 *   --quick       First 5 only
 *   --batch N     Check N then stop
 *   --force       Re-check even already verified ones
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const INPUT_FILE = path.join(__dirname, '..', 'data', 'platform_scan_ot_verified.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'ot_111_puppeteer_verified.json');
const BM_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const FORCE = args.includes('--force');
function getArg(name, def) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}
const BATCH_LIMIT = parseInt(getArg('batch', '0'), 10);
const BROWSER_RESTART_EVERY = 40;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function nameMatch(restaurantName, pageName) {
  if (!pageName) return { ratio: 0, match: false };
  const clean = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[''`]/g, '').replace(/[^a-z0-9]/g, ' ').trim();
  // Extensive stop words — common restaurant words that cause false matches
  const stopWords = new Set([
    'the', 'and', 'bar', 'restaurant', 'cafe', 'nyc', 'new', 'york', 'grill', 'kitchen',
    'house', 'room', 'place', 'spot', 'table', 'chef', 'craft', 'beer', 'wine', 'steak',
    'steakhouse', 'pizza', 'pizzeria', 'bistro', 'brasserie', 'tavern', 'pub', 'lounge',
    'club', 'friends', 'upper', 'lower', 'east', 'west', 'side', 'north', 'south',
    'street', 'avenue', 'brooklyn', 'manhattan', 'queens', 'bronx', 'italian', 'french',
    'japanese', 'chinese', 'mexican', 'american', 'seafood', 'fish', 'meat', 'burger',
    'burgers', 'oyster', 'sushi', 'tapas', 'trattoria', 'ristorante', 'osteria',
    'downtown', 'midtown', 'uptown', 'village', 'heights', 'park', 'garden',
  ]);
  const rWords = clean(restaurantName).split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  const pWords = clean(pageName).split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  if (rWords.length === 0) return { ratio: 0, match: false };

  // Exact word match only
  const matched = rWords.filter(w => pWords.includes(w)).length;
  const ratio = matched / rWords.length;
  // Need at least 60% match AND at least 2 significant words (or 1 if name is 1 word)
  const minMatched = rWords.length === 1 ? 1 : 2;
  return { ratio, match: ratio >= 0.6 && matched >= minMatched };
}

async function launchBrowser() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280 + Math.floor(Math.random() * 100), height: 800 + Math.floor(Math.random() * 100) });
  return { browser, page };
}

async function checkOTPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(2000);

    return await page.evaluate(() => {
      const body = document.body?.innerText || '';
      const html = document.documentElement?.innerHTML || '';

      // Get restaurant name from page
      const h1 = document.querySelector('h1');
      const pageName = h1 ? h1.innerText.trim() : '';

      const hasSlots = document.querySelectorAll('li[data-test^="time-slot"]').length > 0;
      const hasReserve = body.includes('Make a reservation') || body.includes('Find a time') || hasSlots;
      const notOnNetwork = body.includes('not on the OpenTable reservation network') || body.includes('not currently taking reservations');
      const is404 = body.includes('page you requested cannot be found') || body.includes('Page Not Found') || body.length < 300;
      const isClosed = body.includes('permanently closed') || body.includes('Permanently Closed');

      // Try to get rid
      const ridMatch = html.match(/"rid":\s*(\d+)/) || html.match(/restaurant\/(\d+)/);
      const rid = ridMatch ? ridMatch[1] : null;

      // Get address if visible
      const addrEl = document.querySelector('[data-test="restaurant-address"]') ||
                     document.querySelector('.restaurant-address');
      const address = addrEl ? addrEl.innerText.trim() : '';

      return {
        pageName,
        hasReserve,
        hasSlots,
        notOnNetwork,
        is404,
        isClosed,
        rid,
        address,
        finalUrl: window.location.href,
        bodyLen: body.length
      };
    });
  } catch (e) {
    return { error: e.message, is404: false, notOnNetwork: false, hasReserve: false };
  }
}

async function searchOT(page, restaurantName) {
  const cleanName = restaurantName.replace(/[&]/g, 'and').replace(/['']/g, "'");
  const searchUrl = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName)}&metroId=4`;

  try {
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 25000 });
    await sleep(3000);

    const results = await page.evaluate(() => {
      // Get all restaurant result links
      const links = [];
      const anchors = document.querySelectorAll('a[href*="/r/"]');
      for (const a of anchors) {
        const href = a.href;
        if (!href.includes('/r/')) continue;
        // Get the restaurant name from the link context
        const card = a.closest('[data-test]') || a.closest('li') || a.parentElement;
        const nameEl = card?.querySelector('h2, h3, [class*="name"], [class*="Name"]');
        const name = nameEl ? nameEl.innerText.trim() : a.innerText.trim();
        if (name && href && !links.some(l => l.href === href)) {
          links.push({ href, name });
        }
      }
      return links.slice(0, 10);
    });

    return results;
  } catch (e) {
    console.log(`    Search error: ${e.message}`);
    return [];
  }
}

async function main() {
  const input = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  const entries = Object.entries(input);
  console.log(`Loaded ${entries.length} restaurants from platform_scan_ot_verified.json`);

  // Load existing results
  let results = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try { results = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch(e) {}
  }

  const limit = QUICK ? 5 : BATCH_LIMIT > 0 ? BATCH_LIMIT : entries.length;
  let { browser, page } = await launchBrowser();
  let checked = 0;
  let verified = 0, notFound = 0, mismatch = 0, errors = 0;

  for (const [key, entry] of entries) {
    if (checked >= limit) break;

    // Skip already checked unless --force
    if (!FORCE && results[key] && results[key].puppeteerStatus) {
      const s = results[key].puppeteerStatus;
      if (s === 'verified') verified++;
      else if (s === 'not_found') notFound++;
      else if (s === 'mismatch') mismatch++;
      continue;
    }

    // Restart browser periodically
    if (checked > 0 && checked % BROWSER_RESTART_EVERY === 0) {
      console.log(`\n--- Restarting browser (anti-detection) ---`);
      await browser.close();
      await sleep(5000);
      ({ browser, page } = await launchBrowser());
    }

    const name = entry.name;
    const urlToCheck = entry.verifiedUrl || entry.currentUrl;

    console.log(`\n[${checked + 1}/${Math.min(limit, entries.length)}] ${name}`);

    let result = null;
    let finalUrl = null;
    let finalStatus = 'not_found';

    // Step 1: Check existing URL if we have one
    if (urlToCheck && urlToCheck.includes('opentable.com')) {
      console.log(`  Checking: ${urlToCheck}`);
      const pageResult = await checkOTPage(page, urlToCheck);

      if (pageResult.error) {
        console.log(`  Error: ${pageResult.error}`);
      } else if (pageResult.is404 || pageResult.notOnNetwork || pageResult.isClosed) {
        console.log(`  ❌ ${pageResult.is404 ? '404' : pageResult.notOnNetwork ? 'Not on network' : 'Closed'}`);
      } else if (pageResult.hasReserve) {
        const nm = nameMatch(name, pageResult.pageName);
        if (nm.match) {
          console.log(`  ✅ Bookable! Page: "${pageResult.pageName}" (${Math.round(nm.ratio*100)}% match)`);
          finalUrl = pageResult.finalUrl || urlToCheck;
          finalStatus = 'verified';
          result = pageResult;
        } else {
          console.log(`  ⚠️  Bookable but NAME MISMATCH: "${pageResult.pageName}" (${Math.round(nm.ratio*100)}% match)`);
          finalStatus = 'mismatch';
          result = pageResult;
        }
      } else {
        console.log(`  ❌ No reservation widget found. Page: "${pageResult.pageName}"`);
      }
    }

    // Step 2: Search OT if no good URL yet
    if (finalStatus !== 'verified') {
      console.log(`  Searching OT...`);
      await sleep(1500);
      const searchResults = await searchOT(page, name);
      console.log(`  Found ${searchResults.length} search results`);

      const nycKeywords = ['new-york', 'brooklyn', 'queens', 'bronx', 'manhattan', 'nyc',
        'jersey-city', 'hoboken', 'harlem', 'tribeca', 'soho', 'chelsea', 'midtown',
        'williamsburg', 'greenpoint', 'bushwick', 'astoria', 'flushing', 'park-slope'];

      for (const sr of searchResults) {
        const nm = nameMatch(name, sr.name);
        if (nm.ratio < 0.4) continue;

        console.log(`  Checking match: "${sr.name}" (${Math.round(nm.ratio*100)}%) -> ${sr.href}`);
        await sleep(2000);
        const pageResult = await checkOTPage(page, sr.href);

        if (pageResult.hasReserve && !pageResult.is404 && !pageResult.notOnNetwork) {
          const pageName = pageResult.pageName || sr.name;
          const nm2 = nameMatch(name, pageName);
          const slug = sr.href.split('/r/')[1] || '';
          const isNYC = nycKeywords.some(k => slug.includes(k)) ||
                       (pageResult.address && (pageResult.address.includes('NY') || pageResult.address.includes('NJ')));

          if (nm2.match && isNYC) {
            console.log(`  ✅ Found: "${pageName}" at ${sr.href}`);
            finalUrl = pageResult.finalUrl || sr.href;
            finalStatus = 'verified';
            result = pageResult;
            break;
          } else if (!isNYC) {
            console.log(`    Wrong location`);
          } else {
            console.log(`    Name mismatch (${Math.round(nm2.ratio*100)}%)`);
          }
        }
      }
    }

    // Save result
    results[key] = {
      name,
      previousUrl: urlToCheck || null,
      previousStatus: entry.status,
      puppeteerStatus: finalStatus,
      verifiedUrl: finalUrl,
      pageName: result?.pageName || null,
      rid: result?.rid || null,
      address: result?.address || null,
      checkedAt: new Date().toISOString()
    };

    if (finalStatus === 'verified') verified++;
    else if (finalStatus === 'mismatch') mismatch++;
    else { notFound++; }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    checked++;

    // Rate limit - random delay
    await sleep(2000 + Math.random() * 3000);
  }

  await browser.close();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`SUMMARY`);
  console.log(`  Total: ${entries.length}`);
  console.log(`  ✅ Verified bookable: ${verified}`);
  console.log(`  ⚠️  Name mismatch: ${mismatch}`);
  console.log(`  ❌ Not found: ${notFound}`);
  console.log(`\nResults saved to: ${OUTPUT_FILE}`);
}

main().catch(console.error);
