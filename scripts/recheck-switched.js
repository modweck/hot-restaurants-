/**
 * Recheck restaurants switched from OT to website.
 * First checks Resy API, then OT via Puppeteer.
 * Saves results for review.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const LIST_FILE = path.join(__dirname, '..', 'data', 'ot_switched_recheck.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'recheck_results.json');

const AUTH = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzg0OTgyMTksInVpZCI6Mzk4MTc5NDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxMzE1NzU1OTh9fQ.ATA70GJaKhFagX1Gp22JvXmOQOt4jn93nqenmNTJI53JrCb7fukcXykqrn9AJ1dzLBzvVnWbWt4gdRVgY-Vh6vo4Ac6IH0XvAebptK-iTb0MqvfKMx1t0vUAeCLk43iiZ0tle5UaPthjph0f-9f-J3PruLprzEOE8rX_v9OnYjBs5NC_';
const KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const H = { 'Authorization': `ResyAPI api_key="${KEY}"`, 'X-Resy-Auth-Token': AUTH, 'Origin': 'https://resy.com', 'Accept': 'application/json' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const QUICK = process.argv.includes('--quick');

function generateSlugs(name) {
  const base = name.toLowerCase().replace(/[''\"]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9 -]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const slugs = [base, base.replace(/-/g, '')];
  const parts = base.split('-');
  if (parts[0].length > 2) slugs.push(parts[0]);
  if (parts.length >= 2) slugs.push(parts.slice(0, 2).join('-'));
  if (base.startsWith('the-')) slugs.push(base.slice(4));
  const noType = base.replace(/-(restaurant|ristorante|trattoria|bistro|cafe|bar|grill|kitchen|steakhouse)$/g, '').replace(/-$/, '');
  if (noType !== base && noType.length > 2) slugs.push(noType);
  return [...new Set(slugs)].filter(s => s.length > 1);
}

function isNYC(lat) { return lat && lat >= 40.48 && lat <= 40.95; }

function matchScore(search, found) {
  const c = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const sc = c(search), fc = c(found);
  if (sc === fc) return 1.0;
  if (fc.includes(sc) || sc.includes(fc)) return 0.9;
  const stop = ['the', 'and', 'restaurant', 'bar', 'grill', 'cafe', 'kitchen', 'nyc', 'new', 'york'];
  const sw = sc.split(' ').filter(w => w.length > 2 && !stop.includes(w));
  const fw = fc.split(' ').filter(w => w.length > 2 && !stop.includes(w));
  if (sw.length === 0) return 0;
  return sw.filter(w => fw.some(f => f.includes(w) || w.includes(f))).length / sw.length;
}

async function checkResy(name) {
  const slugs = generateSlugs(name);
  for (const slug of slugs) {
    try {
      const res = await fetch('https://api.resy.com/3/venue?url_slug=' + slug + '&location=ny', { headers: H });
      const d = await res.json();
      if (d.name && d.is_active === 1 && isNYC(d.location?.latitude)) {
        return { platform: 'resy', name: d.name, slug: d.url_slug, url: 'https://resy.com/cities/new-york-ny/venues/' + d.url_slug };
      }
    } catch {}
    await sleep(300);
  }
  return null;
}

async function checkOT(page, name) {
  try {
    const cleanName = name.replace(/\(.*\)/g, '').replace(/[^\w\s'-]/g, '').replace(/\s+/g, ' ').trim();
    await page.goto('https://www.opentable.com/s?term=' + encodeURIComponent(cleanName) + '&dateTime=2026-03-28T19%3A30%3A00&covers=2&metroId=8', { waitUntil: 'networkidle2', timeout: 20000 });

    const result = await page.evaluate(() => {
      const card = document.querySelector('[data-test="pinned-restaurant-card"],[data-test="restaurant-card"]');
      if (!card) return null;
      const cardName = card.querySelector('a[data-test="res-card-name"]')?.textContent?.trim() || '';
      const link = card.querySelector('a[data-test^="restaurant-card-profile-link"]')?.href || '';
      const notOnOT = card.innerText.includes('not on the OpenTable reservation network');
      const slots = Array.from(card.querySelectorAll('li[data-test^="time-slot"]')).length;
      return { name: cardName, link, notOnOT, slots };
    });

    if (!result || result.notOnOT) return null;
    if (matchScore(name, result.name) < 0.7) return null;
    if (result.slots > 0 || result.link) {
      return { platform: 'opentable', name: result.name, url: result.link, slots: result.slots };
    }
  } catch {}
  return null;
}

async function main() {
  const list = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8'));
  const toCheck = QUICK ? list.slice(0, 20) : list;
  console.log(`Rechecking ${toCheck.length} restaurants — Resy first, then OT\n`);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });

  const results = { resy: [], opentable: [], neither: [] };
  let checked = 0;

  for (const name of toCheck) {
    checked++;

    // Step 1: Check Resy
    const resy = await checkResy(name);
    if (resy) {
      results.resy.push({ name, ...resy });
      console.log(`✅ [${checked}/${toCheck.length}] ${name} → RESY: ${resy.name}`);
      await sleep(1000);
      continue;
    }

    // Step 2: Check OT
    const ot = await checkOT(page, name);
    if (ot) {
      results.opentable.push({ name, ...ot });
      console.log(`✅ [${checked}/${toCheck.length}] ${name} → OT: ${ot.name} (${ot.slots} slots)`);
      await sleep(3000);
      continue;
    }

    results.neither.push(name);
    if (checked % 50 === 0) console.log(`   [${checked}/${toCheck.length}] ... resy: ${results.resy.length} | ot: ${results.opentable.length} | neither: ${results.neither.length}`);

    await sleep(1500);

    // Save progress every 50
    if (checked % 50 === 0) fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  }

  await browser.close();
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Done! Checked: ${checked}`);
  console.log(`  ✅ Found on Resy: ${results.resy.length}`);
  console.log(`  ✅ Found on OT: ${results.opentable.length}`);
  console.log(`  ❌ Neither: ${results.neither.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
