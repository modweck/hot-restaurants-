/**
 * FIND OPENTABLE LINKS FOR WEBSITE-ONLY RESTAURANTS
 * ==================================================
 * Uses Puppeteer to search OpenTable for each website-only restaurant,
 * then verifies each match actually has a real booking page.
 *
 * Safety:
 * - Searches one at a time with 3-4s delay between searches
 * - Every 50 restaurants: 60s cooldown
 * - Blocks images/css/fonts to reduce footprint
 * - Saves progress throughout so it can resume
 *
 * Usage:
 *   node scripts/find-ot-for-website.mjs                # Full run
 *   node scripts/find-ot-for-website.mjs --resume       # Resume from saved progress
 *   node scripts/find-ot-for-website.mjs --apply        # Apply verified matches to BOOKING_MASTER
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import puppeteer from 'puppeteer';

const MASTER_PATH = './netlify/functions/BOOKING_MASTER.json';
const PROGRESS_PATH = './data/ot_website_search_progress.json';
const RESULTS_PATH = './data/ot_website_search_results.json';

const RESUME = process.argv.includes('--resume');
const APPLY = process.argv.includes('--apply');

const SEARCH_DELAY_MS = 3500;       // delay between individual searches
const BATCH_SIZE = 50;               // cooldown every N searches
const COOLDOWN_MS = 60000;           // 60s cooldown between batches
const VERIFY_DELAY_MS = 2500;        // delay between verification page loads

const sleep = ms => new Promise(r => setTimeout(r, ms));

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const DATE_STR = tomorrow.toISOString().split('T')[0];

// ─── Name matching ───────────────────────────────────────────────────────────

function norm(s) {
  return s.toLowerCase().replace(/[''`]/g, '').replace(/[^a-z0-9]/g, '');
}

function similarity(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;

  const triA = new Set(), triB = new Set();
  for (let i = 0; i <= na.length - 3; i++) triA.add(na.slice(i, i + 3));
  for (let i = 0; i <= nb.length - 3; i++) triB.add(nb.slice(i, i + 3));
  if (triA.size === 0 || triB.size === 0) return 0;
  const intersection = [...triA].filter(t => triB.has(t)).length;
  const union = new Set([...triA, ...triB]).size;
  return intersection / union;
}

const STOP_WORDS = new Set(['the', 'and', 'of', 'restaurant', 'bar', 'grill', 'cafe', 'kitchen', 'nyc', 'new', 'york', 'city', 'a', 'an']);

function wordOverlap(a, b) {
  const wa = a.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w));
  const wb = b.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w));
  if (wa.length === 0 || wb.length === 0) return 0;
  const matches = wa.filter(w => wb.some(w2 => w2.includes(w) || w.includes(w2)));
  return matches.length / Math.max(wa.length, wb.length);
}

function combinedScore(a, b) {
  return Math.max(similarity(a, b), wordOverlap(a, b) * 0.95);
}

// ─── Puppeteer Search ────────────────────────────────────────────────────────

async function searchOT(page, name) {
  const clean = name.replace(/\(.*\)/g, '').replace(/[^\w\s'-]/g, '').replace(/\s+/g, ' ').trim();
  const url = `https://www.opentable.com/s?term=${encodeURIComponent(clean)}&dateTime=${DATE_STR}T19%3A00%3A00&covers=2&metroId=8`;

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2500);

    const items = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-test="pinned-restaurant-card"],[data-test="restaurant-card"]');
      const seen = new Set(), out = [];
      for (const card of cards) {
        const rid = card.getAttribute('data-rid') || '';
        if (seen.has(rid) && rid) continue;
        if (rid) seen.add(rid);
        const nl = card.querySelector('a[data-test="res-card-name"]');
        const pl = card.querySelector('a[data-test^="restaurant-card-profile-link"]');
        const n = nl ? nl.textContent.trim() : '';
        const u = pl ? pl.getAttribute('href') : (nl ? nl.getAttribute('href') : '');
        if (!n || !u) continue;

        // Check for time slots (indicates bookable)
        const slots = [];
        const sc = card.querySelector('ul[data-test="time-slots"]');
        if (sc) {
          for (const li of sc.querySelectorAll('li[data-test^="time-slot"]')) {
            const m = li.textContent.trim().match(/^(\d{1,2}:\d{2}\s*[AP]M)/i);
            if (m) slots.push(m[1]);
          }
        }

        // Get neighborhood if available
        const metaEls = card.querySelectorAll('[data-test="res-card-cuisine"], [data-test="res-card-neighborhood"]');
        let neighborhood = '';
        for (const el of metaEls) {
          const txt = el.textContent.trim();
          if (!txt.includes('$')) neighborhood = txt;
        }

        out.push({ name: n, url: u, rid, slots, neighborhood });
      }
      return out;
    });

    // Find best match
    let best = null, bestScore = 0;
    for (const item of items) {
      const score = combinedScore(clean, item.name);
      if (score > bestScore) {
        bestScore = score;
        best = { ...item, score };
      }
    }

    // Require score >= 0.65 for search results
    return best && bestScore >= 0.65 ? best : null;
  } catch (e) {
    return null;
  }
}

// ─── Puppeteer Verification ──────────────────────────────────────────────────

async function verifyOTPage(page, name, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(2000);

    const finalUrl = page.url();

    const result = await page.evaluate(() => {
      const title = document.title || '';
      const body = document.body?.innerText || '';
      const html = document.documentElement?.innerHTML || '';

      const hasRestaurantId = html.includes('data-restaurant-id') || html.includes('"restaurantId"') || html.includes('"rid"');
      const hasReservationForm = body.includes('Make a reservation') || body.includes('Find a time') ||
                                  body.includes('Find next available') || html.includes('ReservationForm') ||
                                  html.includes('reservation-form') || html.includes('dtp-picker') ||
                                  html.includes('covers-selector') || html.includes('date-selector');
      const hasTimeSlots = html.includes('time-slot') || html.includes('TimeSlot') || html.includes('timeslot');
      const hasRestaurantProfile = html.includes('RestaurantProfile') || html.includes('restaurant-profile');

      const is404 = title.includes('Page Not Found') || title.includes('404') ||
                     body.includes('page you requested cannot be found') ||
                     body.includes("we can't find that page") ||
                     body.includes('Page not found');
      const isRedirectToHome = title === 'OpenTable' || title === 'Restaurants Near Me' ||
                                title.includes('Restaurant Reservations | OpenTable');
      const isSearchPage = html.includes('search-results') && !html.includes('restaurant-profile');

      const nameEl = document.querySelector('h1');
      const pageName = nameEl ? nameEl.textContent.trim() : '';

      return {
        title: title.substring(0, 150),
        pageName,
        is404,
        isRedirectToHome,
        isSearchPage,
        hasRestaurantId,
        hasReservationForm,
        hasTimeSlots,
        hasRestaurantProfile,
        isBookable: hasReservationForm || hasTimeSlots,
      };
    });

    if (result.is404 || result.isRedirectToHome) {
      return { status: 'dead', reason: result.is404 ? '404 page' : 'redirected to home' };
    }
    if (result.isSearchPage) {
      return { status: 'dead', reason: 'redirected to search' };
    }

    // Cross-check page name against our restaurant name
    if (result.pageName) {
      const pageScore = combinedScore(name, result.pageName);
      if (pageScore < 0.45) {
        return { status: 'wrong_restaurant', reason: `page shows "${result.pageName}" (score ${pageScore.toFixed(2)})` };
      }
    }

    if (result.hasRestaurantProfile || result.hasRestaurantId) {
      return {
        status: result.isBookable ? 'verified_bookable' : 'verified_profile',
        pageName: result.pageName,
        finalUrl,
      };
    }

    // Check if URL redirected away
    const originalSlug = url.replace(/https?:\/\/www\.opentable\.com\/?/, '');
    const finalSlug = finalUrl.replace(/https?:\/\/www\.opentable\.com\/?/, '');
    if (finalSlug !== originalSlug && (finalSlug === '' || finalSlug === '/' || finalSlug.startsWith('s?'))) {
      return { status: 'dead', reason: 'redirected away' };
    }

    return { status: 'uncertain', finalUrl };
  } catch (e) {
    return { status: 'error', reason: e.message?.substring(0, 100) };
  }
}

// ─── Progress Management ─────────────────────────────────────────────────────

function loadProgress() {
  if (RESUME && existsSync(PROGRESS_PATH)) {
    const p = JSON.parse(readFileSync(PROGRESS_PATH, 'utf8'));
    // Reset the old api_searched format if present
    if (!p.searched) p.searched = {};
    if (!p.verified) p.verified = {};
    return p;
  }
  return {
    searched: {},     // name -> { match: {otName, otUrl, otSlug, rid, score, slots} | null }
    verified: {},     // otUrl -> { name, otName, otUrl, status, ... }
    started_at: new Date().toISOString(),
  };
}

function saveProgress(progress) {
  progress.updated_at = new Date().toISOString();
  writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const master = JSON.parse(readFileSync(MASTER_PATH, 'utf8'));
  const progress = loadProgress();

  const websiteOnly = Object.entries(master)
    .filter(([, v]) => v.platform === 'website')
    .map(([name, v]) => ({ name, lat: v.lat || 40.7128, lng: v.lng || -74.006 }));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  FIND OPENTABLE FOR WEBSITE-ONLY RESTAURANTS`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Total website-only: ${websiteOnly.length}`);
  console.log(`  Date for search: ${DATE_STR}`);

  // Launch browser
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
           '--disable-blink-features=AutomationControlled', '--window-size=1280,800'],
  });

  // Create search page (no resource blocking — OT needs full page to render cards)
  const searchPage = await browser.newPage();
  await searchPage.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  await searchPage.setViewport({ width: 1280, height: 800 });
  await searchPage.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  // ── PHASE 1: Search ─────────────────────────────────────────────────────

  const toSearch = websiteOnly.filter(r => !progress.searched[r.name]);
  console.log(`\n-- PHASE 1: Puppeteer Search --`);
  console.log(`  Already searched: ${Object.keys(progress.searched).length}`);
  console.log(`  To search: ${toSearch.length}`);
  console.log(`  Delay: ${SEARCH_DELAY_MS}ms between searches`);
  console.log(`  Cooldown: ${COOLDOWN_MS / 1000}s every ${BATCH_SIZE} searches\n`);

  let searchCount = 0, found = 0, notFound = 0;

  for (let i = 0; i < toSearch.length; i++) {
    const r = toSearch[i];
    searchCount++;

    const result = await searchOT(searchPage, r.name);

    if (result && result.url) {
      const fullUrl = result.url.startsWith('http') ? result.url : `https://www.opentable.com${result.url}`;
      progress.searched[r.name] = {
        match: {
          otName: result.name,
          otUrl: fullUrl,
          otSlug: fullUrl.replace('https://www.opentable.com/r/', '').replace('https://www.opentable.com/', ''),
          rid: result.rid,
          score: result.score,
          slots: result.slots?.length || 0,
          neighborhood: result.neighborhood || '',
        }
      };
      found++;
      const slotInfo = result.slots?.length > 0 ? ` (${result.slots.length} slots)` : '';
      console.log(`  [${searchCount}/${toSearch.length}] "${r.name}" -> "${result.name}" (${result.score.toFixed(2)})${slotInfo}`);
    } else {
      progress.searched[r.name] = { match: null };
      notFound++;
      console.log(`  [${searchCount}/${toSearch.length}] "${r.name}" -> not found`);
    }

    // Save every 25
    if (searchCount % 25 === 0) {
      saveProgress(progress);
    }

    // Delay between searches
    await sleep(SEARCH_DELAY_MS);

    // Cooldown every BATCH_SIZE
    if (searchCount % BATCH_SIZE === 0 && i < toSearch.length - 1) {
      const totalFound = Object.values(progress.searched).filter(v => v.match).length;
      console.log(`\n  -- Batch ${searchCount / BATCH_SIZE} complete. Found so far: ${totalFound}. Cooling down ${COOLDOWN_MS / 1000}s...\n`);
      saveProgress(progress);
      await sleep(COOLDOWN_MS);
    }
  }

  saveProgress(progress);
  const totalFound = Object.values(progress.searched).filter(v => v.match).length;
  console.log(`\n  Search complete: ${totalFound} matches found out of ${Object.keys(progress.searched).length} searched\n`);

  // ── PHASE 2: Verify each match ──────────────────────────────────────────

  const matches = Object.entries(progress.searched)
    .filter(([, v]) => v.match && !progress.verified[v.match.otUrl])
    .map(([name, v]) => ({ name, ...v.match }));

  console.log(`-- PHASE 2: Verify Matches --`);
  console.log(`  Total matches: ${totalFound}`);
  console.log(`  Already verified: ${Object.keys(progress.verified).length}`);
  console.log(`  To verify: ${matches.length}\n`);

  if (matches.length > 0) {
    // Create verify page with resource blocking for speed
    const verifyPage = await browser.newPage();
    await verifyPage.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await verifyPage.setViewport({ width: 1280, height: 800 });
    await verifyPage.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    await verifyPage.setRequestInterception(true);
    verifyPage.on('request', req => {
      const type = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    let verifyCount = 0, bookable = 0, profile = 0, dead = 0, wrong = 0;

    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const result = await verifyOTPage(verifyPage, m.name, m.otUrl);
      progress.verified[m.otUrl] = { name: m.name, otName: m.otName, otUrl: m.otUrl, otSlug: m.otSlug, rid: m.rid, score: m.score, ...result };
      verifyCount++;

      const icon = result.status === 'verified_bookable' ? '[OK]' :
                   result.status === 'verified_profile' ? '[PROFILE]' :
                   result.status === 'dead' ? '[DEAD]' :
                   result.status === 'wrong_restaurant' ? '[WRONG]' :
                   result.status === 'uncertain' ? '[??]' : '[ERR]';

      if (result.status === 'verified_bookable') bookable++;
      else if (result.status === 'verified_profile') profile++;
      else if (result.status === 'dead') dead++;
      else if (result.status === 'wrong_restaurant') wrong++;

      console.log(`  ${icon} [${verifyCount}/${matches.length}] "${m.name}" -> "${m.otName}" -- ${result.status}${result.reason ? ` (${result.reason})` : ''}`);

      if (verifyCount % 25 === 0) saveProgress(progress);

      await sleep(VERIFY_DELAY_MS);

      if (verifyCount % BATCH_SIZE === 0 && i < matches.length - 1) {
        console.log(`\n  -- Verify batch done. Cooling down ${COOLDOWN_MS / 1000}s...\n`);
        saveProgress(progress);
        await sleep(COOLDOWN_MS);
      }
    }

    console.log(`\n  Verification: ${bookable} bookable, ${profile} profile-only, ${dead} dead, ${wrong} wrong restaurant`);
    await verifyPage.close();
  }

  await searchPage.close();
  await browser.close();
  saveProgress(progress);

  // ── Results ─────────────────────────────────────────────────────────────

  const goodMatches = Object.values(progress.verified)
    .filter(v => v.status === 'verified_bookable' || v.status === 'verified_profile');

  const results = {
    generated_at: new Date().toISOString(),
    total_website_restaurants: websiteOnly.length,
    searched: Object.keys(progress.searched).length,
    search_matches: totalFound,
    verified_bookable: Object.values(progress.verified).filter(v => v.status === 'verified_bookable').length,
    verified_profile: Object.values(progress.verified).filter(v => v.status === 'verified_profile').length,
    dead: Object.values(progress.verified).filter(v => v.status === 'dead').length,
    wrong_restaurant: Object.values(progress.verified).filter(v => v.status === 'wrong_restaurant').length,
    good_matches: goodMatches.map(v => ({
      name: v.name, otName: v.otName, otUrl: v.otUrl, otSlug: v.otSlug, rid: v.rid, score: v.score, status: v.status,
    })),
  };

  writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  FINAL RESULTS`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Searched: ${results.searched}`);
  console.log(`  Search matches: ${results.search_matches}`);
  console.log(`  Verified bookable: ${results.verified_bookable}`);
  console.log(`  Verified profile: ${results.verified_profile}`);
  console.log(`  Dead: ${results.dead}`);
  console.log(`  Wrong restaurant: ${results.wrong_restaurant}`);
  console.log(`${'='.repeat(60)}`);

  if (goodMatches.length > 0) {
    console.log(`\n  GOOD MATCHES (${goodMatches.length}):`);
    for (const m of goodMatches) {
      console.log(`    "${m.name}" -> "${m.otName}" -- ${m.otUrl} [${m.status}]`);
    }
  }

  console.log(`\n  Results: ${RESULTS_PATH}`);
  console.log(`  Progress: ${PROGRESS_PATH}`);

  // ── Apply ───────────────────────────────────────────────────────────────

  if (APPLY && goodMatches.length > 0) {
    console.log(`\n-- APPLYING ${goodMatches.length} matches to BOOKING_MASTER --`);
    const freshMaster = JSON.parse(readFileSync(MASTER_PATH, 'utf8'));
    let applied = 0;

    for (const m of goodMatches) {
      if (freshMaster[m.name] && freshMaster[m.name].platform === 'website') {
        freshMaster[m.name].platform = 'opentable';
        freshMaster[m.name].url = m.otUrl;
        applied++;
        console.log(`  ${m.name} -> opentable (${m.otUrl})`);
      }
    }

    writeFileSync(MASTER_PATH, JSON.stringify(freshMaster, null, 2));
    console.log(`\n  Applied ${applied} changes to BOOKING_MASTER.json`);
  } else if (!APPLY && goodMatches.length > 0) {
    console.log(`\n  To apply: node scripts/find-ot-for-website.mjs --resume --apply`);
  }

  console.log('');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
