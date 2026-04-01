const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const OUTPUT = path.join(__dirname, '..', 'data', 'ot_nyc_directory.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEARCHES = [
  // Price levels
  '$ cheap restaurants Manhattan',
  '$$ moderate restaurants Manhattan',
  '$$$ upscale restaurants Manhattan',
  '$$$$ fine dining Manhattan',
  // Collections / occasions
  'best new restaurants NYC',
  'outdoor dining NYC',
  'date night NYC',
  'birthday dinner NYC',
  'anniversary dinner NYC',
  'group dining NYC',
  'private dining NYC',
  'brunch NYC',
  'late night dining NYC',
  'prix fixe NYC',
  'tasting menu NYC',
  'celebrity chef NYC',
  'michelin star NYC',
  'rooftop restaurant NYC',
  'waterfront dining NYC',
  'romantic restaurant NYC',
  'business dinner NYC',
  'family friendly restaurant NYC',
  'happy hour NYC',
  'wine bar NYC',
  'craft cocktails NYC',
  // Underrepresented cuisines
  'Portuguese restaurant Manhattan',
  'Moroccan restaurant Manhattan',
  'Georgian restaurant Manhattan',
  'Colombian restaurant Manhattan',
  'Argentinian restaurant Manhattan',
  'Filipino restaurant Manhattan',
  'Malaysian restaurant Manhattan',
  'Burmese restaurant Manhattan',
  'Uzbek restaurant Manhattan',
  'Hawaiian restaurant Manhattan',
  'Jamaican restaurant Manhattan',
  'Afghan restaurant Manhattan',
  'Senegalese restaurant Manhattan',
  'Israeli restaurant Manhattan',
  'Polish restaurant Manhattan',
  'German restaurant Manhattan',
  'Austrian restaurant Manhattan',
  'Scandinavian restaurant Manhattan',
];

async function main() {
  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(OUTPUT, 'utf8')); } catch {}
  const seenRids = new Set(existing.map(r => r.rid).filter(Boolean));
  const seenNames = new Set(existing.map(r => (r.name || '').toLowerCase()));
  console.log('Starting with ' + existing.length + ' existing restaurants\n');

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });

  let totalNew = 0;

  for (const term of SEARCHES) {
    try {
      const url = 'https://www.opentable.com/s?term=' + encodeURIComponent(term) + '&dateTime=2026-03-28T19%3A30%3A00&covers=2&metroId=8';
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });

      await page.evaluate(async () => {
        for (let i = 0; i < 15; i++) { window.scrollBy(0, 500); await new Promise(r => setTimeout(r, 300)); }
      });
      await sleep(1000);

      const cards = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('[data-test="restaurant-card"],[data-test="pinned-restaurant-card"]')).map(card => {
          const name = card.querySelector('a[data-test="res-card-name"]')?.textContent?.trim();
          const link = card.querySelector('a[data-test^="restaurant-card-profile-link"]')?.href;
          const rid = card.getAttribute('data-rid');
          const cuisine = card.querySelector('[data-test="cuisine-and-location"]')?.textContent?.trim();
          return { name, link, rid, cuisine };
        }).filter(r => r.name);
      });

      let newCount = 0;
      for (const card of cards) {
        if (seenRids.has(card.rid) || seenNames.has((card.name || '').toLowerCase())) continue;
        seenRids.add(card.rid);
        seenNames.add((card.name || '').toLowerCase());
        existing.push({ ...card, searchTerm: term });
        newCount++;
        totalNew++;
      }

      console.log(term + ': ' + cards.length + ' results, ' + newCount + ' new (total new: ' + totalNew + ')');
      fs.writeFileSync(OUTPUT, JSON.stringify(existing, null, 2));
    } catch (e) {
      console.log(term + ': error — ' + e.message.substring(0, 50));
    }

    await sleep(4000);
  }

  await browser.close();
  console.log('\nDone! Total in directory: ' + existing.length + ' | New found: ' + totalNew);
}

main().catch(e => { console.error(e); process.exit(1); });
