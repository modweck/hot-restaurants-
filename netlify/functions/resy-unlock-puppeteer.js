/**
 * resy-unlock-puppeteer.js — Check locked Resy restaurants for future availability
 * Loads resy.com page at +7 days, intercepts API response for venue ID + slots.
 * Saves venue IDs to BOOKING_MASTER. Updates availability data.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const MASTER_FILE = path.join(__dirname, 'BOOKING_MASTER.json');
const BOOKING_FILE = path.join(__dirname, 'booking_lookup.json');
const OUTPUT_FILE = path.join(__dirname, 'tonight_availability.json');

const API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const AUTH_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzg4OTg1MTMsInVpZCI6NjQ2NDA0MzcsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTMyNTg0MDZ9fQ.AOMbosBxAd5CvHh8g-YD8NfkXQahDSrZ0asmRrU1CaOb5muBMcw44ujG_W1LWRbiw285t1Kv3BaFyjj2xQ-n-HGbAX1GTaB-pd6wSoNvTdT5so9pAeAIsoRDrbrPQEPx_qqZtDVlkJokmDFEsZc_TlwKTnQlIlsHWAIrnE7v4hfn8n5s';
const HEADERS = {
  'Authorization': `ResyAPI api_key="${API_KEY}"`,
  'X-Resy-Auth-Token': AUTH_TOKEN,
  'X-Resy-Universal-Auth': AUTH_TOKEN,
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Origin': 'https://resy.com',
  'Referer': 'https://resy.com/',
  'Accept': 'application/json, text/plain, */*',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function extractResySlug(url) {
  if (!url) return null;
  const m1 = url.match(/resy\.com\/cities\/[a-z-]+\/([a-z0-9_-]+)\/?$/i);
  if (m1) return m1[1].toLowerCase();
  const m2 = url.match(/venues\/([a-z0-9_-]+)\/?$/i);
  if (m2) return m2[1].toLowerCase();
  return null;
}

function futureDate(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

(async () => {
  const master = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
  const bl = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));
  const output = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));

  // Find locked resy restaurants
  const locked = [];
  for (const [k, v] of Object.entries(output)) {
    if (k.startsWith('_')) continue;
    if (!v.fully_locked) continue;
    const info = bl[k];
    if (!info || info.platform !== 'resy') continue;
    const mk = Object.keys(master).find(mk => mk.toLowerCase() === k);
    const slug = extractResySlug(info.url);
    if (!slug) continue;
    locked.push({ name: k, masterKey: mk, slug });
  }

  console.log(`🔓 Checking ${locked.length} locked Resy restaurants for future availability`);
  console.log(`   Method: Puppeteer → intercept API → get venue ID + check +3/+7 days`);
  console.log(`   Delay: 8s between restaurants, browser restart every 25\n`);

  let browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  let unlocked = 0, stillLocked = 0, failed = 0, venueIdsFound = 0;

  for (let i = 0; i < locked.length; i++) {
    if (i > 0 && i % 25 === 0) {
      await browser.close();
      fs.writeFileSync(MASTER_FILE, JSON.stringify(master, null, 2));
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
      console.log(`\n    💾 Saved (${unlocked} unlocked, ${venueIdsFound} venue IDs)\n`);
      await sleep(5000);
      browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
    }

    const r = locked[i];
    let page;
    let foundFuture = false;

    try {
      page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36');
      await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });

      let venueId = null;

      // Check +7 days first (more likely to have availability than +3)
      for (const offset of [7, 3]) {
        if (foundFuture) break;
        const date = futureDate(offset);

        let slots = [];
        const handler = async (resp) => {
          if (resp.url().includes('/4/find') && resp.status() === 200 && resp.request().method() !== 'OPTIONS') {
            try {
              const text = await resp.text();
              if (text && text.length > 10) {
                const data = JSON.parse(text);
                const venue = data?.results?.venues?.[0];
                if (venue?.venue?.id?.resy) venueId = venue.venue.id.resy;
                slots = venue?.slots || [];
              }
            } catch {}
          }
        };
        page.on('response', handler);

        await page.goto(`https://resy.com/cities/ny/${r.slug}?date=${date}&seats=2`, { waitUntil: 'networkidle2', timeout: 15000 });
        await sleep(3000);
        page.off('response', handler);

        // Save venue ID if found
        if (venueId && r.masterKey && master[r.masterKey]) {
          if (!master[r.masterKey].venue_id) {
            master[r.masterKey].venue_id = venueId;
            venueIdsFound++;
          }
        }

        // Check if dinner slots exist
        const dinnerSlots = slots.filter(s => {
          const t = s.date?.start || '';
          const hm = t.match(/(\d{2}):(\d{2})/);
          return hm && parseInt(hm[1]) >= 17;
        }).length;

        if (dinnerSlots > 0) {
          delete output[r.name].fully_locked;
          output[r.name].opens_in = offset;
          unlocked++;
          foundFuture = true;
          console.log(`  🟢 [${i+1}/${locked.length}] ${r.name}: opens +${offset}d (${dinnerSlots} slots) ${venueId ? 'ID:'+venueId : ''}`);
        }

        await sleep(3000);
      }

      await page.close().catch(() => {});

      if (!foundFuture) {
        stillLocked++;
        console.log(`  🔒 [${i+1}/${locked.length}] ${r.name}: still locked ${venueId ? 'ID:'+venueId : ''}`);
      }
    } catch (e) {
      failed++;
      console.log(`  ❌ [${i+1}/${locked.length}] ${r.name}: ${e.message?.slice(0, 50)}`);
      if (page) await page.close().catch(() => {});
    }

    await sleep(5000 + Math.floor(Math.random() * 3000));
  }

  await browser.close();
  fs.writeFileSync(MASTER_FILE, JSON.stringify(master, null, 2));
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`\n✅ Done:`);
  console.log(`   Unlocked: ${unlocked}`);
  console.log(`   Still locked: ${stillLocked}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Venue IDs saved: ${venueIdsFound}`);
})();
