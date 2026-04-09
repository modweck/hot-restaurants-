/**
 * upcoming-restaurants.js
 *
 * 1. Scrapes Eater NY (Puppeteer) + Infatuation (fetch) for upcoming openings
 * 2. Cross-references against BOOKING_MASTER.json
 * 3. Adds new ones as coming_soon: true
 * 4. Checks if any coming_soon restaurants now have Resy/OT bookings
 * 5. When bookable → flips to new_rising: true, removes coming_soon
 *
 * RUN:   node scripts/upcoming-restaurants.js
 *
 * OPTIONS:
 *   --scrape-only     Only scrape sources, don't check bookability
 *   --check-only      Only check existing coming_soon for bookability
 *   --dry-run         Don't write changes to BOOKING_MASTER
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const fetch = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args);
  try { return require('node-fetch')(...args); }
  catch (e) { throw new Error('fetch not available. Use Node 18+ or add node-fetch.'); }
};

const args = process.argv.slice(2);
const SCRAPE_ONLY = args.includes('--scrape-only');
const CHECK_ONLY  = args.includes('--check-only');
const DRY_RUN     = args.includes('--dry-run');

const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const UPCOMING_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'upcoming_restaurants.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Resy config ──────────────────────────────────────────────────────────────
const RESY_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const RESY_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzk0MDczOTEsInVpZCI6Mzk4MTc5NDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxMzE1NzU1OTh9fQ.AN9bvDSJhN41QD4qtXmyJJl6zopWWjCp7X12plmGyKf9s8_AFBdEBkF5uY2FJe6_KJ_WyBnrIVw2-lHkLvogVFN5APP0XXEoEenKBvmmgKA30lEeM1vJRY1LBLkKYYQ_1Ktb54No6aHlCeRXG6Cu1MAudtuRgxgQl4iJinqyEx8M6r68';

function resyHeaders() {
  return {
    'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
    'X-Resy-Auth-Token': RESY_TOKEN,
    'X-Resy-Universal-Auth': RESY_TOKEN,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Origin': 'https://resy.com',
    'Referer': 'https://resy.com/',
    'Accept': 'application/json, text/plain, */*'
  };
}

// ── Normalize names for matching ─────────────────────────────────────────────
function normalize(s) {
  return s.toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^a-z0-9' ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchScore(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) {
    const longer = Math.max(na.length, nb.length);
    const shorter = Math.min(na.length, nb.length);
    if (shorter < 4) return shorter / longer; // penalize tiny matches
    return 0.9;
  }
  const wa = na.split(' ').filter(w => w.length > 2);
  const wb = nb.split(' ').filter(w => w.length > 2);
  if (wa.length === 0 || wb.length === 0) return 0;
  const matches = wa.filter(w => wb.some(w2 => w2.includes(w) || w.includes(w2)));
  return matches.length / Math.max(wa.length, wb.length);
}

// ══════════════════════════════════════════════════════════════════════════════
// SCRAPE SOURCES
// ══════════════════════════════════════════════════════════════════════════════

// ── Eater NY via Puppeteer ───────────────────────────────────────────────────
async function scrapeEater(browser) {
  console.log('\n📰 Scraping Eater NY...');
  const restaurants = [];

  const urls = [
    'https://ny.eater.com/maps/best-new-nyc-restaurants-heatmap',
    'https://ny.eater.com/maps/nyc-coming-attractions-new-restaurant-openings',
  ];

  for (const url of urls) {
    try {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(3000);

      const HOODS = ['Williamsburg','Greenpoint','Bushwick','Park Slope','Carroll Gardens','Cobble Hill','Bed-Stuy','East Village','West Village','Lower East Side','LES','Nolita','Soho','SoHo','Tribeca','Chinatown','Flatiron','Chelsea','Midtown','Murray Hill','Upper East Side','UES','Upper West Side','UWS','Financial District','FiDi','NoHo','Greenwich Village','Crown Heights','Prospect Heights','Fort Greene','Dumbo','Brooklyn Heights','Two Bridges','Hudson Yards','Hells Kitchen'];
      const results = await page.evaluate((hoods) => {
        const items = [];
        const hoodRe = new RegExp('(' + hoods.join('|') + ')', 'i');

        // Junk patterns to filter out
        const junk = ['see more','download','take eater','skip to','get our','current eater','dining out','updated','visit website','best restaurants','every single','top chef','more maps','page not found','terms of use','privacy','cookie','do not sell','licensing','accessibility','platform status','archives','contact us','send us','community','masthead','about eater','ethics','newsletters','how to pitch','maps methodology','advertiser','no thanks','list','the best','where a','new greenpoint','from a new'];

        const cards = document.querySelectorAll('[class*="venue"], [class*="place"], [class*="card"], article, [data-venue]');
        for (const card of cards) {
          const nameEl = card.querySelector('h1, h2, h3, h4, [class*="name"], [class*="title"]');
          const name = nameEl?.textContent?.trim();
          if (!name || name.length < 3 || name.length > 50) continue;
          if (junk.some(j => name.toLowerCase().startsWith(j))) continue;
          if (/^[A-Z\s]{5,}$/.test(name)) continue; // ALL CAPS nav items
          if (name.includes('/') || name.includes('@') || name.includes('©')) continue;

          const text = card.textContent || '';
          // Must mention food/restaurant-related words or a neighborhood
          const hasAddress = /\d+\s+\w+\s+(St|Ave|Blvd)/i.test(text);
          const hasHood = hoodRe.test(text);
          const hasFoodWord = /(restaurant|chef|menu|dinner|lunch|brunch|cuisine|kitchen|bar|grill|cafe|pizza|sushi|tasting|reservation|opening|open)/i.test(text);
          if (!hasAddress && !hasHood && !hasFoodWord) continue;

          const nbMatch = text.match(hoodRe);
          const neighborhood = nbMatch ? nbMatch[1] : null;
          const addrMatch = text.match(/(\d+\s+[\w\s]+(?:St|Ave|Blvd|Rd|Pl|Way|Dr)[\w\s,]*)/i);
          const address = addrMatch ? addrMatch[1].trim() : null;

          items.push({ name, neighborhood, address, source: 'eater' });
        }

        return items;
      }, HOODS);

      restaurants.push(...results);
      console.log(`  ✅ ${url.split('/').pop()}: found ${results.length} restaurants`);
      await page.close();
    } catch (e) {
      console.log(`  ❌ ${url.split('/').pop()}: ${e.message?.slice(0, 60)}`);
    }
    await sleep(2000);
  }

  // Deduplicate
  const seen = new Set();
  return restaurants.filter(r => {
    const key = normalize(r.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Infatuation via fetch ────────────────────────────────────────────────────
async function scrapeInfatuation(browser) {
  console.log('\n📱 Scraping Infatuation...');
  const restaurants = [];

  const urls = [
    'https://www.theinfatuation.com/new-york/guides/nyc-restaurant-openings-2026',
    'https://www.theinfatuation.com/new-york/guides/nyc-spring-restaurant-openings-2026',
    'https://www.theinfatuation.com/new-york/guides/new-nyc-restaurants-openings',
    'https://www.theinfatuation.com/new-york/guides/nycs-most-exciting-new-restaurant-openings',
    'https://www.theinfatuation.com/new-york/guides/best-new-new-york-restaurants-hit-list',
  ];

  for (const url of urls) {
    try {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(3000);

      const HOODS = ['Williamsburg','Greenpoint','Bushwick','Park Slope','Carroll Gardens','Cobble Hill','Bed-Stuy','East Village','West Village','Lower East Side','LES','Nolita','Soho','SoHo','Tribeca','Chinatown','Flatiron','Chelsea','Midtown','Murray Hill','Upper East Side','UES','Upper West Side','UWS','Financial District','FiDi','NoHo','Greenwich Village','Crown Heights','Prospect Heights','Fort Greene','Dumbo','Brooklyn Heights','Two Bridges','Hudson Yards','Hells Kitchen'];
      const CUISINES = ['Italian','French','Japanese','Korean','Thai','Mexican','Chinese','Indian','American','Mediterranean','Seafood','Steakhouse','Pizza','BBQ','Vietnamese','Georgian','Palestinian','British','Brazilian','Southern'];
      const results = await page.evaluate((hoods, cuisines) => {
        const items = [];
        const hoodRe = new RegExp('(' + hoods.join('|') + ')', 'i');
        const cuisineRe = new RegExp('(' + cuisines.join('|') + ')', 'i');
        const cards = document.querySelectorAll('[class*="venue"], [class*="place"], [class*="card"], article');
        for (const card of cards) {
          const nameEl = card.querySelector('h1, h2, h3, h4, [class*="name"], [class*="title"]');
          const name = nameEl?.textContent?.trim();
          if (!name || name.length < 2 || name.length > 80) continue;

          const text = card.textContent || '';
          const addrMatch = text.match(/(\d+\s+[\w\s]+(?:St|Ave|Blvd|Rd|Pl|Way|Dr)[\w\s,]*)/i);
          const address = addrMatch ? addrMatch[1].trim() : null;
          const nbMatch = text.match(hoodRe);
          const neighborhood = nbMatch ? nbMatch[1] : null;
          const cuisineMatch = text.match(cuisineRe);
          const cuisine = cuisineMatch ? cuisineMatch[1] : null;

          items.push({ name, neighborhood, address, cuisine, source: 'infatuation' });
        }
        return items;
      }, HOODS, CUISINES);

      restaurants.push(...results);
      console.log(`  ✅ ${url.split('/').pop()}: found ${results.length} restaurants`);
      await page.close();
    } catch (e) {
      console.log(`  ❌ ${url.split('/').pop()}: ${e.message?.slice(0, 60)}`);
    }
    await sleep(2000);
  }

  const seen = new Set();
  return restaurants.filter(r => {
    const key = normalize(r.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Other sources via Puppeteer ───────────────────────────────────────────────
async function scrapeOtherSources(browser) {
  console.log('\n🌐 Scraping other sources (Resy blog, Hauteliving, Indagare)...');
  const restaurants = [];

  const urls = [
    { url: 'https://blog.resy.com/new-on-resy/best-new-openings-nyc/', source: 'resy_blog' },
    { url: 'https://hauteliving.com/2026/03/best-new-restaurants-nyc-2026/786201/', source: 'hauteliving' },
    { url: 'https://indagare.com/article/new-restaurants-in-new-york-city-spring-2026', source: 'indagare' },
    { url: 'https://secretnyc.co/new-restaurants-bars-nyc-march-2026/', source: 'secretnyc' },
  ];

  const HOODS = ['Williamsburg','Greenpoint','Bushwick','Park Slope','Carroll Gardens','Cobble Hill','Bed-Stuy','East Village','West Village','Lower East Side','LES','Nolita','Soho','SoHo','Tribeca','Chinatown','Flatiron','Chelsea','Midtown','Murray Hill','Upper East Side','UES','Upper West Side','UWS','Financial District','FiDi','NoHo','Greenwich Village','Crown Heights','Prospect Heights','Fort Greene','Dumbo','Brooklyn Heights','Two Bridges','Hudson Yards','Hells Kitchen','Meatpacking'];

  for (const { url, source } of urls) {
    try {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(3000);

      const results = await page.evaluate((hoods, src) => {
        const items = [];
        const hoodRe = new RegExp('(' + hoods.join('|') + ')', 'i');
        const junk = ['see more','download','skip','get our','privacy','terms','cookie','about','contact','newsletter','subscribe','sign in','log in','menu','search','share','follow'];

        // Look for headings that are restaurant names
        const headings = document.querySelectorAll('h1, h2, h3, h4, strong, b');
        for (const h of headings) {
          const name = h.textContent?.trim();
          if (!name || name.length < 3 || name.length > 50) continue;
          if (junk.some(j => name.toLowerCase().startsWith(j))) continue;
          if (/^[A-Z\s]{5,}$/.test(name)) continue;
          if (name.includes('/') || name.includes('@') || name.includes('©')) continue;

          // Check surrounding text for food context
          const parent = h.closest('article, section, div, p') || h.parentElement;
          const text = parent?.textContent || '';
          const hasFoodWord = /(restaurant|chef|menu|dinner|lunch|cuisine|kitchen|bar|grill|cafe|pizza|sushi|tasting|reservation|opening|open|seats|dishes)/i.test(text);
          if (!hasFoodWord) continue;

          const nbMatch = text.match(hoodRe);
          const neighborhood = nbMatch ? nbMatch[1] : null;
          const addrMatch = text.match(/(\d+\s+[\w\s]+(?:St|Ave|Blvd|Rd|Pl|Way|Dr))/i);
          const address = addrMatch ? addrMatch[1].trim() : null;

          items.push({ name, neighborhood, address, source: src });
        }
        return items;
      }, HOODS, source);

      restaurants.push(...results);
      console.log(`  ✅ ${source}: found ${results.length} restaurants`);
      await page.close();
    } catch (e) {
      console.log(`  ❌ ${source}: ${e.message?.slice(0, 60)}`);
    }
    await sleep(2000);
  }

  const seen = new Set();
  return restaurants.filter(r => {
    const key = normalize(r.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// CHECK BOOKABILITY
// ══════════════════════════════════════════════════════════════════════════════

async function checkResyByName(name, browser) {
  const slug = normalize(name).replace(/'/g, '').replace(/\s+/g, '-');

  // Try API first
  for (const loc of ['new-york-ny', 'ny']) {
    try {
      const resp = await fetch(`https://api.resy.com/3/venue?url_slug=${slug}&location=${loc}`, {
        headers: resyHeaders(),
        signal: AbortSignal.timeout(10000)
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.id?.resy) {
          return {
            platform: 'resy',
            venue_id: data.id.resy,
            url: `https://resy.com/cities/${loc}/${slug}`,
            bookable: true,
          };
        }
      }
    } catch {}
  }

  // Try Puppeteer search on Resy
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    await page.goto(`https://resy.com/cities/ny?query=${encodeURIComponent(name)}`, {
      waitUntil: 'networkidle2', timeout: 20000
    });
    await sleep(2000);

    const result = await page.evaluate((searchName) => {
      const cards = document.querySelectorAll('[class*="VenueCard"], [class*="venue"], a[href*="/cities/"]');
      for (const card of cards) {
        const text = card.textContent?.trim() || '';
        const link = card.href || card.querySelector('a')?.href || '';
        if (link.includes('/cities/') && text.toLowerCase().includes(searchName.toLowerCase().slice(0, 5))) {
          return { url: link, name: text.slice(0, 60) };
        }
      }
      return null;
    }, name);

    await page.close();
    if (result) return { platform: 'resy', url: result.url, bookable: true };
  } catch {}

  return null;
}

async function checkOpenTableByName(name, browser) {
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const date = tomorrow.toISOString().split('T')[0];

    await page.goto(
      `https://www.opentable.com/s?term=${encodeURIComponent(name)}&dateTime=${date}T19%3A30%3A00&covers=2&metroId=8`,
      { waitUntil: 'networkidle2', timeout: 25000 }
    );

    const blocked = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return text.includes('Access Denied') || text.includes("don't have permission");
    });
    if (blocked) { await page.close(); return null; }

    const result = await page.evaluate((searchName) => {
      const cards = document.querySelectorAll('[data-test="restaurant-card"],[data-test="pinned-restaurant-card"]');
      for (const card of cards) {
        const cardName = card.querySelector('a[data-test="res-card-name"]')?.textContent?.trim() || '';
        const cn = searchName.toLowerCase().replace(/[^a-z0-9 ]/g, '');
        const fk = cardName.toLowerCase().replace(/[^a-z0-9 ]/g, '');
        if (fk.includes(cn) || cn.includes(fk)) {
          const slots = card.querySelectorAll('li[data-test^="time-slot"]');
          const rid = card.getAttribute('data-rid');
          const link = card.querySelector('a[data-test="res-card-name"]')?.href;
          return { name: cardName, slots: slots.length, rid, url: link, bookable: slots.length > 0 };
        }
      }
      return null;
    }, name);

    await page.close();
    if (result) return { platform: 'opentable', url: result.url, bookable: result.bookable, rid: result.rid };
  } catch {}

  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('🍽️  UPCOMING RESTAURANTS TRACKER');
  console.log(`${'═'.repeat(50)}\n`);

  // Load data
  const master = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
  const masterKeys = Object.keys(master);
  let upcoming = {};
  try { upcoming = JSON.parse(fs.readFileSync(UPCOMING_FILE, 'utf8')); } catch {}

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  // ── PHASE 1: Scrape sources ──────────────────────────────────────────────
  if (!CHECK_ONLY) {
    const eaterResults = await scrapeEater(browser);
    const infatuationResults = await scrapeInfatuation(browser);
    const otherResults = await scrapeOtherSources(browser);

    // Merge, deduplicate, and filter junk
    const allScraped = [...eaterResults, ...infatuationResults, ...otherResults];
    const junkNames = ['see more','download','take eater','skip to','get our','current eater','dining out','updated','visit website','no thanks','list','more maps','page not found','terms of use','privacy','cookie','do not sell','licensing','accessibility','platform status','archives','contact us','send us','community','masthead','about eater','ethics','newsletters','how to pitch','maps methodology','advertiser','the best','every single','top chef','where a','new greenpoint','from a new','nadia','alex staniloff','evan sung','will hartman','molly fitzpatrick','sonal shah','willa moore','restaurant recommendations'];
    const seen = new Set();
    const unique = [];
    for (const r of allScraped) {
      const key = normalize(r.name);
      if (seen.has(key)) continue;
      // Clean up name — remove newlines, extra whitespace, trailing neighborhood names
      r.name = r.name.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      r.name = r.name.replace(/\s+(Williamsburg|Greenpoint|Bushwick|Park Slope|Carroll Gardens|Cobble Hill|East Village|West Village|Lower East Side|LES|Nolita|Soho|SoHo|Tribeca|Chinatown|Flatiron|Chelsea|Midtown|Murray Hill|Upper East Side|UES|Upper West Side|UWS|NoHo|Greenwich Village|Crown Heights|Prospect Heights|Fort Greene|Dumbo|Brooklyn Heights|Two Bridges|Hudson Yards|Meatpacking|Kips Bay|Theater District|Grand Central|Little Caribbean)\s*$/i, '').trim();

      if (key.length < 3 || key.length > 50) continue;
      if (junkNames.some(j => key.startsWith(j))) continue;
      if (/^[a-z\s]{1,3}$/.test(key)) continue; // too short
      if (/nyc|new york|restaurant opening|guide|explained|new openings|kelis knows|where nyc mayor/.test(key)) continue;
      // Filter phrases that aren't restaurant names
      if (/newly added|bonus|trending|our cities|more inspiration|enjoy \d|welcome back|exploring a|inspired by|closing its|breakfast and|takeaway|coffee bar|course menu|just \$|opened a|focusing on|contemporary|caviar &|prime hanger|france|rooted as|creme brulee|martinis|natural wines|coffee program|taste of los|wine bars|a new bar|now open|duck fat|kips bay|theater district|little caribbean|grand central/.test(key)) continue;
      // Must have at least one capitalized word (real restaurant name)
      if (!/[A-Z]/.test(r.name)) continue;
      // Filter out descriptions (more than 4 words without a proper noun feel)
      const words = r.name.split(' ');
      if (words.length > 5) continue;
      seen.add(key);
      unique.push(r);
    }

    console.log(`\n📊 Total unique restaurants scraped: ${unique.length}`);

    // Cross-reference against BOOKING_MASTER
    let newCount = 0, alreadyTracked = 0, alreadyInMaster = 0;

    for (const r of unique) {
      // Check if already in BOOKING_MASTER
      const inMaster = masterKeys.find(k => matchScore(k, r.name) >= 0.75);
      if (inMaster) {
        alreadyInMaster++;
        continue;
      }

      // Check if already in upcoming list
      const inUpcoming = Object.keys(upcoming).find(k => matchScore(k, r.name) >= 0.75);
      if (inUpcoming) {
        alreadyTracked++;
        continue;
      }

      // New restaurant — add to upcoming
      const key = r.name;
      upcoming[key] = {
        coming_soon: true,
        source: r.source,
        neighborhood: r.neighborhood || null,
        address: r.address || null,
        cuisine: r.cuisine || null,
        added_date: new Date().toISOString().split('T')[0],
        platform: null,
        url: null,
        bookable: false,
      };
      newCount++;
      console.log(`  🆕 ${r.name} (${r.neighborhood || 'unknown neighborhood'}) — added as coming_soon`);
    }

    console.log(`\n📊 Scrape results:`);
    console.log(`   Already in BOOKING_MASTER: ${alreadyInMaster}`);
    console.log(`   Already in upcoming list: ${alreadyTracked}`);
    console.log(`   New coming_soon added: ${newCount}`);
  }

  // ── PHASE 2: Check coming_soon for bookability ───────────────────────────
  if (!SCRAPE_ONLY) {
    const comingSoon = Object.entries(upcoming).filter(([k, v]) => v.coming_soon && !v.bookable);

    if (comingSoon.length > 0) {
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`🔍 Checking ${comingSoon.length} coming_soon restaurants for bookability\n`);

      let flipped = 0, notYet = 0;

      for (let i = 0; i < comingSoon.length; i++) {
        const [name, info] = comingSoon[i];

        // Check Resy
        const resyResult = await checkResyByName(name, browser);
        if (resyResult?.bookable) {
          console.log(`  🟢 [${i + 1}/${comingSoon.length}] ${name}: LIVE on Resy!`);

          // Add to BOOKING_MASTER
          if (!DRY_RUN) {
            master[name] = {
              platform: 'resy',
              url: resyResult.url,
              neighborhood: info.neighborhood,
              cuisine: info.cuisine,
              new_rising: true,
              coming_soon_source: info.source,
              opened_date: new Date().toISOString().split('T')[0],
            };
            if (resyResult.venue_id) master[name].resy_venue_id = resyResult.venue_id;
            upcoming[name].bookable = true;
            upcoming[name].platform = 'resy';
            upcoming[name].url = resyResult.url;
            upcoming[name].opened_date = new Date().toISOString().split('T')[0];
            delete upcoming[name].coming_soon;
          }
          flipped++;
          await sleep(5000);
          continue;
        }

        await sleep(3000);

        // Check OpenTable
        const otResult = await checkOpenTableByName(name, browser);
        if (otResult?.bookable) {
          console.log(`  🟢 [${i + 1}/${comingSoon.length}] ${name}: LIVE on OpenTable!`);

          if (!DRY_RUN) {
            master[name] = {
              platform: 'opentable',
              url: otResult.url,
              neighborhood: info.neighborhood,
              cuisine: info.cuisine,
              new_rising: true,
              coming_soon_source: info.source,
              opened_date: new Date().toISOString().split('T')[0],
            };
            if (otResult.rid) master[name].rid = parseInt(otResult.rid);
            upcoming[name].bookable = true;
            upcoming[name].platform = 'opentable';
            upcoming[name].url = otResult.url;
            upcoming[name].opened_date = new Date().toISOString().split('T')[0];
            delete upcoming[name].coming_soon;
          }
          flipped++;
        } else {
          console.log(`  ⏳ [${i + 1}/${comingSoon.length}] ${name}: not bookable yet`);
          notYet++;
        }

        await sleep(5000);
      }

      console.log(`\n📊 Bookability check:`);
      console.log(`   🟢 Now bookable (→ new_rising): ${flipped}`);
      console.log(`   ⏳ Still coming soon: ${notYet}`);
    } else {
      console.log('\n📊 No coming_soon restaurants to check');
    }
  }

  await browser.close();

  // ── Save ──────────────────────────────────────────────────────────────────
  if (!DRY_RUN) {
    fs.writeFileSync(UPCOMING_FILE, JSON.stringify(upcoming, null, 2));
    fs.writeFileSync(MASTER_FILE, JSON.stringify(master, null, 2));
    console.log(`\n💾 Saved upcoming_restaurants.json (${Object.keys(upcoming).length} entries)`);
    console.log(`💾 Saved BOOKING_MASTER.json (${Object.keys(master).length} entries)`);
  } else {
    console.log('\n🔒 Dry run — no files written');
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log('✅ Done!');
}

main().catch(e => { console.error('❌', e); process.exit(1); });
