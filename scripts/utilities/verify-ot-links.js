#!/usr/bin/env node
/**
 * VERIFY OPENTABLE LINKS
 * ======================
 * Checks all OT URLs in BOOKING_MASTER.json using Puppeteer.
 * Identifies broken/dead links vs working ones.
 *
 * Saves progress as it goes so it can resume if interrupted.
 *
 * Usage: node scripts/utilities/verify-ot-links.js
 * Resume: node scripts/utilities/verify-ot-links.js --resume
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const MASTER_PATH = path.join(__dirname, '../../netlify/functions/BOOKING_MASTER.json');
const PROGRESS_PATH = path.join(__dirname, '../../data/ot_verify_progress.json');
const RESULTS_PATH = path.join(__dirname, '../../data/ot_verify_results.json');

const RESUME = process.argv.includes('--resume');
const CONCURRENCY = 3; // tabs at once
const TIMEOUT = 15000; // 15s per page

function loadProgress() {
  if (RESUME && fs.existsSync(PROGRESS_PATH)) {
    return JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
  }
  return { checked: {}, started_at: new Date().toISOString() };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
}

async function checkPage(page, name, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    // Wait a moment for any redirects
    await new Promise(r => setTimeout(r, 1500));

    const finalUrl = page.url();

    // Check for signs of a valid restaurant page
    const result = await page.evaluate(() => {
      const title = document.title || '';
      const body = document.body?.innerText || '';
      const html = document.documentElement?.innerHTML || '';

      // Signs it's a real restaurant page
      const hasRestaurantId = html.includes('data-restaurant-id') || html.includes('"restaurantId"');
      const hasReservation = body.includes('Make a reservation') || body.includes('Find a time') ||
                             body.includes('Reserve') || html.includes('ReservationForm');
      const hasMenu = body.includes('Menu') || body.includes('menu');
      const hasAddress = html.includes('streetAddress') || html.includes('postalCode');
      const hasRestaurantProfile = html.includes('RestaurantProfile') || html.includes('restaurant-profile');
      const hasOgRestaurant = html.includes('og:type" content="restaurant"');

      // Signs it's a dead/error page
      const is404 = title.includes('Page Not Found') || title.includes('404') ||
                     body.includes('page you requested cannot be found') ||
                     body.includes("we can't find that page") ||
                     body.includes('Page not found');
      const isGenericSearch = title.includes('Restaurant Reservations') && !title.includes(' - ');
      const isRedirectToHome = title === 'OpenTable' || title === 'Restaurants Near Me';

      return {
        title: title.substring(0, 120),
        is404,
        isGenericSearch,
        isRedirectToHome,
        hasRestaurantId,
        hasReservation,
        hasAddress,
        hasRestaurantProfile,
        hasOgRestaurant,
      };
    });

    // Determine status
    let status;
    if (result.is404 || result.isRedirectToHome) {
      status = 'dead';
    } else if (result.isGenericSearch) {
      status = 'redirected';
    } else if (result.hasRestaurantId || result.hasReservation || result.hasRestaurantProfile || result.hasOgRestaurant || result.hasAddress) {
      status = 'alive';
    } else {
      // Check if URL changed significantly (redirected away)
      const originalSlug = url.replace(/https?:\/\/www\.opentable\.com\/?/, '');
      const finalSlug = finalUrl.replace(/https?:\/\/www\.opentable\.com\/?/, '');
      if (finalSlug !== originalSlug && (finalSlug === '' || finalSlug === '/' || finalSlug.startsWith('s?'))) {
        status = 'redirected';
      } else {
        status = 'uncertain';
      }
    }

    return {
      name,
      url,
      finalUrl,
      status,
      title: result.title,
    };
  } catch (e) {
    return {
      name,
      url,
      status: 'error',
      error: e.message.substring(0, 100),
    };
  }
}

async function main() {
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'));
  const progress = loadProgress();

  // Get all OT entries
  const otEntries = [];
  for (const [name, entry] of Object.entries(master)) {
    if (entry.platform !== 'opentable') continue;
    if (!entry.url) continue;
    if (RESUME && progress.checked[name]) continue; // Skip already checked
    otEntries.push({ name, url: entry.url });
  }

  const alreadyChecked = Object.keys(progress.checked).length;
  console.log(`\n🔍 OPENTABLE LINK VERIFIER`);
  console.log(`${'='.repeat(60)}`);
  console.log(`📊 Total OT entries in master: ${Object.values(master).filter(e => e.platform === 'opentable').length}`);
  if (RESUME) console.log(`📊 Already checked: ${alreadyChecked}`);
  console.log(`📊 To check: ${otEntries.length}`);
  console.log(`📊 Concurrency: ${CONCURRENCY} tabs\n`);

  if (otEntries.length === 0) {
    console.log('Nothing to check!');
    return;
  }

  // Launch browser
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  let checked = 0;
  const total = otEntries.length;
  const startTime = Date.now();

  // Process in batches
  for (let i = 0; i < otEntries.length; i += CONCURRENCY) {
    const batch = otEntries.slice(i, i + CONCURRENCY);

    const results = await Promise.all(batch.map(async (entry) => {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      // Block images/css/fonts for speed
      await page.setRequestInterception(true);
      page.on('request', req => {
        const type = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      const result = await checkPage(page, entry.name, entry.url);
      await page.close();
      return result;
    }));

    // Record results
    for (const r of results) {
      checked++;
      progress.checked[r.name] = r;

      const icon = r.status === 'alive' ? '✅' : r.status === 'dead' ? '💀' : r.status === 'redirected' ? '↩️ ' : r.status === 'error' ? '⚠️ ' : '❓';
      const pct = ((checked + alreadyChecked) / (total + alreadyChecked) * 100).toFixed(1);
      process.stdout.write(`${icon} [${checked + alreadyChecked}/${total + alreadyChecked}] (${pct}%) ${r.name} — ${r.status}`);
      if (r.status !== 'alive') process.stdout.write(` | ${r.title || r.error || ''}`);
      process.stdout.write('\n');
    }

    // Save progress every 10 batches
    if (checked % (CONCURRENCY * 10) === 0) {
      saveProgress(progress);
      const elapsed = (Date.now() - startTime) / 1000 / 60;
      const rate = checked / elapsed;
      const remaining = (total - checked) / rate;
      console.log(`  💾 Progress saved. ${elapsed.toFixed(1)}m elapsed, ~${remaining.toFixed(1)}m remaining`);
    }

    // Small delay between batches to not hammer OT
    await new Promise(r => setTimeout(r, 800));
  }

  await browser.close();

  // Save final progress
  saveProgress(progress);

  // Compile results
  const allChecked = progress.checked;
  const stats = { alive: 0, dead: 0, redirected: 0, error: 0, uncertain: 0 };
  const deadList = [];
  const redirectedList = [];
  const uncertainList = [];
  const errorList = [];

  for (const [name, r] of Object.entries(allChecked)) {
    stats[r.status] = (stats[r.status] || 0) + 1;
    if (r.status === 'dead') deadList.push(r);
    if (r.status === 'redirected') redirectedList.push(r);
    if (r.status === 'uncertain') uncertainList.push(r);
    if (r.status === 'error') errorList.push(r);
  }

  const finalResults = {
    checked_at: new Date().toISOString(),
    total_checked: Object.keys(allChecked).length,
    stats,
    dead: deadList,
    redirected: redirectedList,
    uncertain: uncertainList,
    errors: errorList,
  };

  fs.writeFileSync(RESULTS_PATH, JSON.stringify(finalResults, null, 2));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULTS:`);
  console.log(`  ✅ Alive: ${stats.alive}`);
  console.log(`  💀 Dead: ${stats.dead}`);
  console.log(`  ↩️  Redirected: ${stats.redirected}`);
  console.log(`  ❓ Uncertain: ${stats.uncertain}`);
  console.log(`  ⚠️  Errors: ${stats.error}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`\nResults saved to ${RESULTS_PATH}`);

  if (deadList.length > 0) {
    console.log(`\n💀 DEAD LINKS:`);
    deadList.forEach(d => console.log(`  ${d.name}: ${d.url}`));
  }
  if (redirectedList.length > 0) {
    console.log(`\n↩️  REDIRECTED:`);
    redirectedList.forEach(d => console.log(`  ${d.name}: ${d.url} -> ${d.finalUrl || '?'}`));
  }
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
