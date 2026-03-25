/**
 * search-dead-resy-v3.js
 *
 * Uses Puppeteer to type into Resy's search bar and capture autocomplete results.
 * Also intercepts network requests to catch the API responses.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const VERIFIED_FILE = path.join(__dirname, '..', 'data', 'resy_puppeteer_verification.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'resy_dead_search_v2.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function norm(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }

function similarity(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const triA = new Set(), triB = new Set();
  for (let i = 0; i <= na.length - 3; i++) triA.add(na.slice(i, i + 3));
  for (let i = 0; i <= nb.length - 3; i++) triB.add(nb.slice(i, i + 3));
  if (triA.size === 0 || triB.size === 0) return 0;
  const intersection = [...triA].filter(t => triB.has(t)).length;
  const union = new Set([...triA, ...triB]).size;
  return intersection / union;
}

function loadJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } }

async function searchResy(page, name) {
  let apiResults = [];

  // Intercept API responses
  const handler = async (response) => {
    const url = response.url();
    if (url.includes('api.resy.com') && (url.includes('search') || url.includes('find') || url.includes('autocomplete'))) {
      try {
        const data = await response.json();
        const venues = data?.results?.venues || data?.search?.hits || data?.hits || [];
        for (const item of venues) {
          const v = item.venue || item;
          if (v.name) {
            apiResults.push({
              name: v.name,
              slug: v.url_slug || v.slug || '',
              id: v.id?.resy || v.venue_id || v.id || null,
              location: v.location?.name || '',
            });
          }
        }
      } catch {}
    }
  };
  page.on('response', handler);

  try {
    // Navigate to Resy homepage
    await page.goto('https://resy.com/cities/ny', { waitUntil: 'networkidle2', timeout: 25000 });
    await sleep(2000);

    // Find and click the search input
    const searchSelectors = [
      'input[type="search"]',
      'input[placeholder*="Search"]',
      'input[placeholder*="search"]',
      'input[data-test*="search"]',
      '[class*="Search"] input',
      '[class*="search"] input',
      'input[name="query"]',
      'input[aria-label*="Search"]',
      'input[aria-label*="search"]',
    ];

    let searchInput = null;
    for (const sel of searchSelectors) {
      searchInput = await page.$(sel);
      if (searchInput) break;
    }

    if (!searchInput) {
      // Try clicking a search button/icon first
      const searchBtn = await page.$('[class*="Search"],[class*="search"],[data-test*="search"],button[aria-label*="Search"]');
      if (searchBtn) {
        await searchBtn.click();
        await sleep(1500);
        for (const sel of searchSelectors) {
          searchInput = await page.$(sel);
          if (searchInput) break;
        }
      }
    }

    if (!searchInput) {
      // Last resort: get all inputs and try first visible one
      const inputs = await page.$$('input');
      for (const inp of inputs) {
        const bb = await inp.boundingBox();
        if (bb && bb.width > 0 && bb.height > 0) { searchInput = inp; break; }
      }
    }

    if (!searchInput) {
      // Take debug screenshot
      await page.screenshot({ path: path.join(__dirname, '..', 'data', 'resy_search_debug.png') });
      return { venues: [], error: 'no search input found' };
    }

    // Clear and type the search term
    try {
      const box = await searchInput.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: 3 });
      } else {
        await searchInput.focus();
      }
    } catch {
      await searchInput.focus();
    }
    await sleep(500);
    await page.keyboard.down('Meta');
    await page.keyboard.press('a');
    await page.keyboard.up('Meta');
    await page.keyboard.press('Backspace');
    await sleep(300);
    await page.keyboard.type(name, { delay: 80 });
    await sleep(3000); // Wait for autocomplete

    // Try to read autocomplete dropdown results from the DOM
    const domResults = await page.evaluate(() => {
      const venues = [];
      // Look for autocomplete results
      const selectors = [
        '[class*="autocomplete"] a',
        '[class*="Autocomplete"] a',
        '[class*="dropdown"] a[href*="/cities/"]',
        '[class*="Dropdown"] a[href*="/cities/"]',
        '[class*="search-result"] a',
        '[class*="SearchResult"] a',
        '[role="listbox"] [role="option"]',
        '[class*="suggestion"] a',
        'ul[class*="result"] li a',
      ];

      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const text = el.textContent.trim().split('\n')[0].trim();
          const href = el.href || el.closest('a')?.href || '';
          if (text && text.length > 1 && text.length < 100) {
            venues.push({ name: text, url: href });
          }
        }
      }

      // Also try getting all links that appeared
      if (venues.length === 0) {
        const allLinks = document.querySelectorAll('a[href*="/cities/"][href*="/venues/"], a[href*="/cities/ny/"]');
        for (const link of allLinks) {
          const text = link.textContent.trim().split('\n')[0].trim();
          if (text && text.length > 1 && text.length < 80 && !text.includes('Nearby') && !text.includes('New on')) {
            venues.push({ name: text, url: link.href });
          }
        }
      }

      return venues;
    });

    // Combine API and DOM results
    const allVenues = [];
    const seen = new Set();

    for (const v of apiResults) {
      const key = norm(v.name);
      if (!seen.has(key)) {
        seen.add(key);
        allVenues.push(v);
      }
    }
    for (const v of domResults) {
      const key = norm(v.name);
      if (!seen.has(key)) {
        seen.add(key);
        allVenues.push(v);
      }
    }

    return { venues: allVenues };
  } finally {
    page.off('response', handler);
    apiResults = [];
  }
}

async function main() {
  const verified = loadJSON(VERIFIED_FILE);

  const dead = Object.entries(verified).filter(([, v]) => {
    const vname = v.venueName || '';
    return vname.includes('Sorry') || vname.includes("can't find") || v.result === 'error';
  });

  // Deduplicate by URL
  const seenUrls = new Set();
  const deduped = [];
  for (const [name, data] of dead) {
    if (!seenUrls.has(data.url)) {
      seenUrls.add(data.url);
      deduped.push([name, data]);
    }
  }

  console.log(`\n🔍 Searching resy.com (autocomplete) for ${deduped.length} dead entries...\n`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800', '--disable-blink-features=AutomationControlled'],
  });

  const output = { found: [], maybe: [], dead: [], error: [] };

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    for (let i = 0; i < deduped.length; i++) {
      const [name, data] = deduped[i];
      process.stdout.write(`  [${i + 1}/${deduped.length}] ${name} ... `);

      const { venues, error } = await searchResy(page, name);

      if (error) {
        console.log(`❌ ${error}`);
        output.error.push({ name, oldUrl: data.url, error });
      } else if (venues.length === 0) {
        console.log(`💀 no results`);
        output.dead.push({ name, oldUrl: data.url });
      } else {
        // Find best match
        let bestMatch = null;
        let bestScore = 0;
        for (const v of venues) {
          const score = similarity(name, v.name);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = { ...v, score };
          }
        }

        if (bestMatch && bestScore >= 0.55) {
          const url = bestMatch.url || (bestMatch.slug ? `https://resy.com/cities/new-york-ny/venues/${bestMatch.slug}` : '');
          console.log(`✅ ${bestMatch.name} → ${url} (${bestScore.toFixed(2)})`);
          output.found.push({ name, oldUrl: data.url, newName: bestMatch.name, newUrl: url, slug: bestMatch.slug, score: bestScore });
        } else if (bestMatch && bestScore >= 0.3) {
          console.log(`🤔 ${bestMatch.name} (${bestScore.toFixed(2)})`);
          output.maybe.push({ name, oldUrl: data.url, candidateName: bestMatch.name, candidateUrl: bestMatch.url || '', score: bestScore });
        } else {
          console.log(`💀 no match (closest: ${bestMatch?.name} @ ${bestScore.toFixed(2)})`);
          output.dead.push({ name, oldUrl: data.url, closest: bestMatch?.name, closestScore: bestScore });
        }
      }

      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

      if (i < deduped.length - 1) {
        const delay = 10000 + Math.random() * 8000;
        await sleep(delay);
      }
    }

    await page.close();
  } finally {
    await browser.close();
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`✅ Found new link:   ${output.found.length}`);
  console.log(`🤔 Maybe match:      ${output.maybe.length}`);
  console.log(`💀 Truly dead:       ${output.dead.length}`);
  console.log(`❌ Errors:           ${output.error.length}`);
  console.log(`${'═'.repeat(60)}`);

  if (output.found.length) {
    console.log(`\n✅ FOUND:`);
    for (const f of output.found) console.log(`  ${f.name} → ${f.newName} (${f.newUrl})`);
  }
  if (output.maybe.length) {
    console.log(`\n🤔 MAYBE:`);
    for (const m of output.maybe) console.log(`  ${m.name} → ${m.candidateName}?`);
  }
  if (output.dead.length) {
    console.log(`\n💀 DEAD:`);
    for (const d of output.dead) console.log(`  ${d.name}${d.closest ? ` (closest: ${d.closest})` : ''}`);
  }

  console.log(`\n💾 Saved to ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
