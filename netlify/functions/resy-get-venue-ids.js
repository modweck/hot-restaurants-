/**
 * resy-get-venue-ids.js — One-time Puppeteer pass to get venue IDs
 * Loads each restaurant's Resy page, intercepts /4/find API response to extract venue ID.
 * Saves venue IDs to BOOKING_MASTER for future API-only runs.
 * Then checks future dates (+3, +7) via API using the new venue IDs.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const MASTER_FILE = path.join(__dirname, 'BOOKING_MASTER.json');
const BOOKING_FILE = path.join(__dirname, 'booking_lookup.json');
const OUTPUT_FILE = path.join(__dirname, 'tonight_availability.json');
const TODAY = new Date().toISOString().split('T')[0];

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

(async () => {
  const master = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
  const bl = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));
  const output = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));

  // Find locked restaurants without venue IDs
  const toFix = [];
  for (const [k, v] of Object.entries(output)) {
    if (k.startsWith('_')) continue;
    if (!v.fully_locked) continue;
    const info = bl[k];
    if (!info || info.platform !== 'resy') continue;
    const masterKey = Object.keys(master).find(mk => mk.toLowerCase() === k);
    if (masterKey && master[masterKey].venue_id) continue; // already has venue ID
    const slug = extractResySlug(info.url);
    if (!slug) continue;
    toFix.push({ name: k, masterKey, slug });
  }

  console.log(`🔍 Getting venue IDs for ${toFix.length} locked restaurants via Puppeteer\n`);

  let browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  let found = 0, notFound = 0, unlocked = 0, stillLocked = 0;

  for (let i = 0; i < toFix.length; i++) {
    if (i > 0 && i % 25 === 0) {
      await browser.close();
      await sleep(3000);
      browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
      fs.writeFileSync(MASTER_FILE, JSON.stringify(master, null, 2));
      console.log(`    💾 Saved BOOKING_MASTER (${found} IDs so far)\n`);
    }

    const r = toFix[i];
    let page;
    try {
      page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36');
      await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });

      let venueId = null;
      page.on('response', async (resp) => {
        if (resp.url().includes('/4/find') && resp.request().method() === 'POST') {
          try {
            const data = await resp.json();
            const vid = data?.results?.venues?.[0]?.venue?.id?.resy;
            if (vid) venueId = vid;
          } catch {}
        }
      });

      await page.goto(`https://resy.com/cities/ny/${r.slug}?date=${TODAY}&seats=2`, { waitUntil: 'networkidle2', timeout: 15000 });
      await sleep(3000);

      if (venueId) {
        // Save venue ID to BOOKING_MASTER
        if (r.masterKey && master[r.masterKey]) {
          master[r.masterKey].venue_id = venueId;
        }
        found++;

        // Now check future dates via API with the venue ID
        let opensIn = null;
        for (const offset of [3, 7]) {
          const futureDate = new Date();
          futureDate.setDate(futureDate.getDate() + offset);
          const date = futureDate.toISOString().split('T')[0];
          try {
            const resp = await fetch(`https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${date}&party_size=2&venue_id=${venueId}`, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
            if (resp.ok) {
              const data = await resp.json();
              const slots = data?.results?.venues?.[0]?.slots || [];
              const dinner = slots.filter(s => { const hm = (s.date?.start||'').match(/(\d{2})/); return hm && parseInt(hm[0]) >= 17; }).length;
              if (dinner > 0) { opensIn = offset; break; }
            }
          } catch {}
          await sleep(3000);
        }

        if (opensIn) {
          delete output[r.name].fully_locked;
          output[r.name].opens_in = opensIn;
          unlocked++;
          console.log(`  🟢 [${i+1}/${toFix.length}] ${r.name}: ID=${venueId} → opens +${opensIn}d`);
        } else {
          stillLocked++;
          console.log(`  🔒 [${i+1}/${toFix.length}] ${r.name}: ID=${venueId} → still locked`);
        }
      } else {
        notFound++;
        console.log(`  ❌ [${i+1}/${toFix.length}] ${r.name}: no venue ID found`);
      }
    } catch (e) {
      notFound++;
      console.log(`  ❌ [${i+1}/${toFix.length}] ${r.name}: error`);
    } finally {
      if (page) await page.close().catch(() => {});
    }

    await sleep(5000 + Math.floor(Math.random() * 3000));
  }

  await browser.close();

  // Save everything
  fs.writeFileSync(MASTER_FILE, JSON.stringify(master, null, 2));
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`\n✅ Done:`);
  console.log(`   Venue IDs found: ${found}`);
  console.log(`   Not found: ${notFound}`);
  console.log(`   Unlocked: ${unlocked}`);
  console.log(`   Still locked: ${stillLocked}`);
})();
