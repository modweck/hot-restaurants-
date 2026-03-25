#!/usr/bin/env node
/**
 * FIND BOOKING LINKS FOR REMAINING RESTAURANTS
 * =============================================
 * Checks website-only and no-platform entries against OpenTable and Resy
 * using Puppeteer (OT) and Resy API.
 *
 * Goes slow to avoid getting flagged. Saves progress so it can resume.
 *
 * Usage: node scripts/utilities/find-booking-for-remaining.js
 * Resume: node scripts/utilities/find-booking-for-remaining.js --resume
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const https = require('https');

const MASTER_PATH = path.join(__dirname, '../../netlify/functions/BOOKING_MASTER.json');
const PROGRESS_PATH = path.join(__dirname, '../../data/booking_search_progress.json');

const RESUME = process.argv.includes('--resume');

function loadProgress() {
  if (RESUME && fs.existsSync(PROGRESS_PATH)) {
    return JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
  }
  return { checked: {}, started_at: new Date().toISOString() };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
}

// Check Resy API for a restaurant name
function checkResy(name) {
  return new Promise(resolve => {
    const slug = name.toLowerCase()
      .replace(/[''""`]/g, '')
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    const slugs = [slug, slug + '-new-york', slug + '-nyc', slug + '-brooklyn'];

    let found = false;
    let idx = 0;

    function tryNext() {
      if (idx >= slugs.length || found) {
        if (!found) resolve(null);
        return;
      }
      const s = slugs[idx++];
      const url = 'https://api.resy.com/3/venue?url_slug=' + s + '&location=ny';
      https.get(url, {
        headers: {
          'authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
          'origin': 'https://resy.com',
          'referer': 'https://resy.com/',
        }
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const j = JSON.parse(data);
              if (j.id?.resy) {
                found = true;
                resolve({
                  platform: 'resy',
                  url: 'https://resy.com/cities/ny/' + (j.url_slug || s),
                  apiName: j.name,
                  venueId: j.id.resy
                });
                return;
              }
            } catch (e) {}
          }
          setTimeout(tryNext, 200);
        });
      }).on('error', () => setTimeout(tryNext, 200));
    }
    tryNext();
  });
}

async function main() {
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'));
  const progress = loadProgress();

  // Get entries to check
  const toCheck = [];
  for (const [name, entry] of Object.entries(master)) {
    if (entry.platform === 'website' || !entry.platform || entry.platform === 'None') {
      if (!RESUME || !progress.checked[name]) {
        toCheck.push({ name, lat: entry.lat, lng: entry.lng });
      }
    }
  }

  const alreadyDone = Object.keys(progress.checked).length;
  console.log(`\n🔍 BOOKING LINK FINDER`);
  console.log(`${'='.repeat(60)}`);
  console.log(`📊 To check: ${toCheck.length}`);
  if (RESUME) console.log(`📊 Already done: ${alreadyDone}`);
  console.log(`📊 Strategy: Resy API first, then OT Puppeteer\n`);

  if (toCheck.length === 0) {
    console.log('Nothing to check!');
    return;
  }

  // Phase 1: Check all against Resy API (fast, no puppeteer needed)
  const needOTCheck = [];
  if (progress.resy_done) {
    console.log('--- PHASE 1: Resy already done, skipping ---\n');
    needOTCheck.push(...toCheck);
  } else {
    console.log('--- PHASE 1: Resy API check ---\n');
    let resyFound = 0;

    for (let i = 0; i < toCheck.length; i++) {
      const item = toCheck[i];
      const result = await checkResy(item.name);

      if (result) {
        console.log(`✅ [${i + 1}/${toCheck.length}] ${item.name} -> RESY: ${result.apiName} (${result.url})`);
        progress.checked[item.name] = { status: 'found', platform: 'resy', url: result.url, apiName: result.apiName };
        resyFound++;
      } else {
        needOTCheck.push(item);
      }

      if ((i + 1) % 50 === 0) {
        saveProgress(progress);
        console.log(`  💾 Progress saved (${i + 1}/${toCheck.length}, ${resyFound} found on Resy)`);
      }

      await new Promise(r => setTimeout(r, 150));
    }

    console.log(`\nResy check done: ${resyFound} found, ${needOTCheck.length} remaining for OT\n`);
    progress.resy_done = true;
    saveProgress(progress);
  }

  // Phase 2: Check remaining against OpenTable via Puppeteer
  if (needOTCheck.length === 0) {
    console.log('All found on Resy!');
    return;
  }

  console.log('--- PHASE 2: OpenTable Puppeteer search ---\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  // Block only images and media (not stylesheets/fonts — OT needs them to render)
  await page.setRequestInterception(true);
  page.on('request', req => {
    const type = req.resourceType();
    if (['image', 'media'].includes(type)) req.abort();
    else req.continue();
  });

  function namesMatch(a, b) {
    const aNorm = a.toLowerCase().replace(/[^a-z0-9]/g, '');
    const bNorm = b.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (aNorm === bNorm) return true;
    // One must contain the other, but only if the shorter one is at least 4 chars
    if (aNorm.length >= 4 && bNorm.includes(aNorm)) return true;
    if (bNorm.length >= 4 && aNorm.includes(bNorm)) return true;
    // Word overlap — require high match (80%+)
    const wa = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2));
    const wb = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2));
    if (wa.size < 2 || wb.size < 2) return false;
    let overlap = 0;
    for (const w of wa) { if (wb.has(w)) overlap++; }
    return overlap / Math.min(wa.size, wb.size) >= 0.8;
  }

  let otFound = 0;
  let notFound = 0;

  for (let i = 0; i < needOTCheck.length; i++) {
    const item = needOTCheck[i];

    // Skip if already checked (resume mode)
    if (progress.checked[item.name]) continue;

    // Clean search term — remove location suffixes for better search
    const searchName = item.name
      .replace(/ - .*$/, '')
      .replace(/\(.*\)/, '')
      .replace(/ nyc$/i, '')
      .replace(/ new york$/i, '')
      .trim();

    const searchUrl = 'https://www.opentable.com/s?term=' + encodeURIComponent(searchName + ' new york') + '&covers=2&dateTime=2026-03-24T19%3A00';

    let found = false;
    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await new Promise(r => setTimeout(r, 3500));

      // Extract restaurant cards from search results
      const results = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/r/"]'));
        const seen = new Set();
        const out = [];
        for (const a of links) {
          const href = a.href;
          if (seen.has(href) || href.includes('#')) continue;
          seen.add(href);
          // Get the card container text
          const card = a.closest('li, article, div') || a.parentElement;
          const cardText = card?.textContent?.trim()?.substring(0, 200) || '';
          if (cardText.length > 5) {
            out.push({ href, cardText });
          }
        }
        return out.slice(0, 5);
      });

      // Find best match by name
      for (const r of results) {
        // Extract restaurant name from card text (it's usually the first part)
        const cardName = r.cardText.split(/\d\.\d/)[0]?.trim() || r.cardText.substring(0, 50);
        if (namesMatch(searchName, cardName)) {
          console.log(`✅ [${i + 1}/${needOTCheck.length}] ${item.name} -> OT: ${r.href}`);
          progress.checked[item.name] = { status: 'found', platform: 'opentable', url: r.href, matchedName: cardName };
          otFound++;
          found = true;
          break;
        }
      }
    } catch (e) {
      // timeout or error
    }

    if (!found) {
      console.log(`❌ [${i + 1}/${needOTCheck.length}] ${item.name} — not on OT`);
      progress.checked[item.name] = { status: 'not_found' };
      notFound++;
    }

    // Save progress every 20 entries
    if ((i + 1) % 20 === 0) {
      saveProgress(progress);
      console.log(`  💾 Progress saved (${i + 1}/${needOTCheck.length}, OT found: ${otFound})`);
    }

    // Longer delay between restaurants to avoid flagging
    await new Promise(r => setTimeout(r, 3000));
  }

  await browser.close();
  saveProgress(progress);

  // Final summary
  const allFound = Object.values(progress.checked).filter(c => c.status === 'found');
  const resyResults = allFound.filter(c => c.platform === 'resy');
  const otResults = allFound.filter(c => c.platform === 'opentable');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULTS:`);
  console.log(`  🍽️  Found on Resy: ${resyResults.length}`);
  console.log(`  🍽️  Found on OT: ${otResults.length}`);
  console.log(`  ❌ Not found: ${Object.values(progress.checked).filter(c => c.status === 'not_found').length}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`\nResults saved to ${PROGRESS_PATH}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
