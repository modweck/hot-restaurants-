/**
 * verify-sevenrooms-live.js
 *
 * Puppeteer check: visit actual SevenRooms reservation pages to see
 * which return a live booking page vs "off the menu" (404).
 *
 * RUN: node scripts/verify-sevenrooms-live.js
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'sevenrooms_live_check.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 22 SevenRooms restaurants — try multiple slug guesses for each
const TO_CHECK = [
  { name: 'Albertos Cocina', slugs: ['albertoscocina', 'albertos-cocina'] },
  { name: 'American Cut Steakhouse Tribeca', slugs: ['americancuttribeca', 'american-cut-tribeca', 'americancutsteakhousetribeca'] },
  { name: 'C Italian Restaurant', slugs: ['citalianrestaurant', 'c-italian-restaurant', 'citalian'] },
  { name: 'Dhania Fine Indian', slugs: ['dhaniafineindian', 'dhania-fine-indian', 'dhania'] },
  { name: 'Fine & Rare', slugs: ['fineandrare', 'fine-and-rare', 'finerare'] },
  { name: "Friedman's West End", slugs: ['friedmanswestend', 'friedmans-west-end', 'friedmans'] },
  { name: 'Pilot', slugs: ['pilot', 'pilotnyc', 'pilot-nyc'] },
  { name: 'Ponte Modern American', slugs: ['pontemodernamerican', 'ponte-modern-american', 'ponte'] },
  { name: 'Portale Restaurant', slugs: ['portalerestaurant', 'portale-restaurant', 'portale'] },
  { name: 'The View', slugs: ['theview', 'the-view', 'theviewnyc', 'theviewrestaurant'] },
  { name: 'VYBES CUISINE', slugs: ['vybescuisine', 'vybes-cuisine', 'vybes'] },
  { name: 'city island yacht club', slugs: ['cityislandyachtclub', 'city-island-yacht-club'] },
  { name: 'close up', slugs: ['closeup', 'close-up', 'closeupnyc'] },
  { name: 'corner store', slugs: ['cornerstore', 'corner-store', 'thecornerstore', 'cornerstoresoho'] },
  { name: 'drift in', slugs: ['driftin', 'drift-in', 'driftinnyc'] },
  { name: 'el lugar cantina', slugs: ['ellugarcantina', 'el-lugar-cantina', 'ellugar'] },
  { name: 'momofuku ko', slugs: ['momofukuko', 'momofuku-ko', 'ko', 'komomofuku'] },
  { name: 'nerai', slugs: ['nerai', 'nerainyc', 'nerai-nyc'] },
  { name: "or'esh", slugs: ['oresh', 'or-esh', 'oreshnyc'] },
  { name: 'redfarm', slugs: ['redfarm', 'red-farm', 'redfarmnyc', 'redfarmhudson', 'redfarmhudsonyards', 'redfarmwestvillage', 'redfarm-hudson-yards', 'redfarm-west-village'] },
  { name: 'scarpetta', slugs: ['scarpetta', 'scarpettanyc'] },
  { name: 'the eighty six', slugs: ['theeightysix', 'the-eighty-six', 'eightysix', '86nyc'] },
];

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1366, height: 768 });

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔍 Checking ${TO_CHECK.length} restaurants on SevenRooms`);
  console.log(`${'═'.repeat(60)}\n`);

  const results = {};

  for (let i = 0; i < TO_CHECK.length; i++) {
    const { name, slugs } = TO_CHECK[i];
    let found = false;
    let workingSlug = null;

    for (const slug of slugs) {
      const url = `https://www.sevenrooms.com/reservations/${slug}`;
      try {
        const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
        await sleep(2000);

        const status = response?.status();
        const body = await page.evaluate(() => document.body?.innerText || '');

        const isOffMenu = body.includes('off the menu') || body.includes('page not found') ||
                          body.includes('no longer available') || status === 404;

        // Check for actual reservation UI
        const hasBooking = body.includes('Find a Table') || body.includes('Reserve') ||
                          body.includes('Party Size') || body.includes('Select a Date') ||
                          body.includes('Make a Reservation') || body.includes('Guests');

        if (!isOffMenu && (hasBooking || status === 200)) {
          // Double check it's not the generic 404 page
          const finalUrl = page.url();
          if (!finalUrl.includes('/explore') && hasBooking) {
            found = true;
            workingSlug = slug;
            break;
          }
        }
      } catch (e) {
        // timeout or navigation error, try next slug
      }
      await sleep(1500);
    }

    results[name] = { found, slug: workingSlug, triedSlugs: slugs };

    if (found) {
      console.log(`  ✅ [${i+1}/${TO_CHECK.length}] ${name} — LIVE at sevenrooms.com/reservations/${workingSlug}`);
    } else {
      console.log(`  ❌ [${i+1}/${TO_CHECK.length}] ${name} — NOT FOUND (tried: ${slugs.join(', ')})`);
    }

    await sleep(1500);
  }

  await browser.close();

  // Summary
  const live = Object.entries(results).filter(([,r]) => r.found);
  const dead = Object.entries(results).filter(([,r]) => !r.found);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 RESULTS: ${live.length} LIVE / ${dead.length} NOT FOUND`);
  console.log(`${'═'.repeat(60)}\n`);

  if (live.length > 0) {
    console.log('LIVE:');
    live.forEach(([n, r]) => console.log(`  ✅ ${n} → ${r.slug}`));
  }
  if (dead.length > 0) {
    console.log('\nNOT FOUND:');
    dead.forEach(([n]) => console.log(`  ❌ ${n}`));
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\n💾 Saved to ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
