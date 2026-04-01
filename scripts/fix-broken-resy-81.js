/**
 * fix-broken-resy-81.js
 *
 * For Resy restaurants with broken slugs that can't be resolved:
 * 1. Search OpenTable by name — if found, switch to OT with correct URL
 * 2. If OT says "not on reservation network" — use their website
 * 3. If not on OT — Google Places lookup for website or closed status
 * 4. Last resort — existing website or mark as walk_in
 *
 * Takes its time — long waits between requests to avoid rate limiting
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BM_PATH = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const GOOGLE_API_KEY = 'AIzaSyDrtbSIA_BvJIzq1_-3pfQ_RgP2DiM_TKo';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function norm(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }

async function main() {
  const master = JSON.parse(fs.readFileSync(BM_PATH, 'utf8'));

  // Find all resy without avg_bill (broken slugs)
  const broken = [];
  for (const [name, entry] of Object.entries(master)) {
    if (entry.platform !== 'resy' || entry.avg_bill) continue;
    broken.push({ name, entry });
  }

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  🔧 FIX BROKEN RESY ENTRIES — ${broken.length} restaurants`);
  console.log(`${'═'.repeat(55)}\n`);

  if (broken.length === 0) {
    console.log('Nothing to fix!');
    return;
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  let switchedOT = 0, switchedWebsite = 0, switchedWalkin = 0, errors = 0;

  for (let i = 0; i < broken.length; i++) {
    const { name, entry } = broken[i];
    console.log(`\n[${i + 1}/${broken.length}] ${name}`);
    console.log(`  Current URL: ${(entry.booking_url || entry.url || 'none').slice(0, 60)}`);

    // ── Step 1: Search OpenTable ──
    console.log('  📍 Searching OpenTable...');
    let otResult = null;
    try {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
      await page.setRequestInterception(true);
      page.on('request', req => {
        if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
        else req.continue();
      });

      const searchUrl = `https://www.opentable.com/s?term=${encodeURIComponent(name + ' NYC')}&metroId=4`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(4000);

      otResult = await page.evaluate((searchName) => {
        const n = searchName.toLowerCase().replace(/[^a-z0-9]/g, '');

        // Look for restaurant cards with links
        const links = document.querySelectorAll('a[href*="/r/"]');
        for (const a of links) {
          const text = (a.textContent || '').trim();
          const tn = text.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (tn.includes(n) || n.includes(tn)) {
            return { found: true, name: text, href: a.href, type: 'bookable' };
          }
        }

        // Check if page shows "not on reservation network" or similar
        const bodyText = document.body.innerText || '';
        if (bodyText.includes('not currently taking reservations') ||
            bodyText.includes('not on our reservation network')) {
          return { found: false, type: 'no_reservations' };
        }

        return { found: false, type: 'not_found' };
      }, name);

      await page.close();
    } catch (e) {
      console.log('  ⚠️ OT search error: ' + (e.message || '').slice(0, 50));
    }

    await sleep(90000); // ~90 sec between OT searches — spread over 2 hours

    if (otResult && otResult.found && otResult.href) {
      console.log(`  ✅ Found on OT: ${otResult.name}`);
      console.log(`     URL: ${otResult.href}`);
      entry.platform = 'opentable';
      entry.booking_url = otResult.href;
      switchedOT++;

      // Save after each find
      fs.writeFileSync(BM_PATH, JSON.stringify(master, null, 2));
      await sleep(60000);
      continue;
    }

    // ── Step 2: Google Places lookup ──
    console.log('  📍 Searching Google Places...');
    try {
      const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.websiteUri,places.businessStatus,places.formattedAddress,places.rating,places.userRatingCount',
        },
        body: JSON.stringify({ textQuery: `${name} restaurant NYC`, maxResultCount: 1 }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const p = data.places?.[0];

        if (p) {
          const status = p.businessStatus || 'UNKNOWN';
          const website = p.websiteUri || null;
          const isNYC = (p.formattedAddress || '').match(/\bN\.?Y\.?\b|New York|Brooklyn|Queens|Bronx/i);

          console.log(`  Google: ${p.displayName?.text || '?'} — ${status}`);
          console.log(`  Address: ${p.formattedAddress || '?'}`);
          console.log(`  Website: ${website || 'none'}`);
          console.log(`  Rating: ${p.rating || '?'}★ (${p.userRatingCount || 0} reviews)`);

          if (status === 'CLOSED_TEMPORARILY' || status === 'CLOSED_PERMANENTLY') {
            console.log(`  → CLOSED — removing booking link`);
            entry.platform = 'website';
            entry.closed = true;
            if (website) entry.website = website;
            delete entry.booking_url;
            switchedWebsite++;
          } else if (website && isNYC) {
            console.log(`  → Switching to website`);
            entry.platform = 'website';
            entry.website = website;
            delete entry.booking_url;
            // Update Google data while we're here
            if (p.rating) entry.google_rating = p.rating;
            if (p.userRatingCount) entry.google_reviews = p.userRatingCount;
            if (p.id) entry.place_id = p.id;
            switchedWebsite++;
          } else if (!isNYC) {
            console.log(`  → Not NYC, switching to website`);
            entry.platform = 'website';
            delete entry.booking_url;
            switchedWebsite++;
          } else {
            console.log(`  → No website, marking as walk-in`);
            entry.platform = 'walkin';
            delete entry.booking_url;
            switchedWalkin++;
          }
        } else {
          console.log('  → Not found on Google either');
          // Use existing website if available
          if (entry.website) {
            entry.platform = 'website';
            delete entry.booking_url;
            switchedWebsite++;
          } else {
            entry.platform = 'walkin';
            delete entry.booking_url;
            switchedWalkin++;
          }
        }
      }
    } catch (e) {
      console.log('  ⚠️ Google error: ' + (e.message || '').slice(0, 50));
      errors++;
    }

    await sleep(30000);

    // Save progress every 10
    if ((i + 1) % 10 === 0) {
      fs.writeFileSync(BM_PATH, JSON.stringify(master, null, 2));
      console.log(`\n  💾 Progress saved (${i + 1}/${broken.length})`);
    }
  }

  await browser.close();
  fs.writeFileSync(BM_PATH, JSON.stringify(master, null, 2));

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  📊 RESULTS`);
  console.log(`  ✅ Switched to OpenTable: ${switchedOT}`);
  console.log(`  📄 Switched to website: ${switchedWebsite}`);
  console.log(`  🚶 Switched to walk-in: ${switchedWalkin}`);
  console.log(`  ⚠️ Errors: ${errors}`);
  console.log(`${'═'.repeat(55)}\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
