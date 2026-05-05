// OT Puppeteer Availability Check — 77 booked restaurants
// Based on opentable-puppeteer-v3.js search approach
// Runs with VISIBLE browser to avoid bot detection

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const NAMES = ["big apple brunch","gallagher's steakhouse","le veau d'or","don angie","sushi by scratch restaurants","zou zou's","one if by land, two if by sea","fig & olive","crave fishbar upper east side","pure thai cookhouse","pure thai restaurant","peaches hothouse","bird pepper","rumba cubana","briciola harlem","alfie's","due amici","aria west village","birdy's","bruno's restaurant","cotenna","crystal","eagle trading co","eloise","fei ma","kyoto sushi","mamma rosa's","mizumi","mughlai indian cuisine","osteria 106","papi's grill","sapporo","attaboy","the vintage tea","l'incontro by rocco","little honey","salt hank's","flushing house","match 65 brasserie","burger club","via brasil restaurant","poke","grand view events","blue note","viva toro","han bat restaurant","china bar","sangarita's","craft","ploume","the brooklyn deli - times square","parklife","golden steer steakhouse nyc","pappas - new york","crave fishbar - uws","the parisian tea room- nyc","silver lining lounge","holiday cocktail lounge","shun lee cafe","lazzara's pizza cafe","trattoria l'incontro","bar fes","nino's 46","cô lạc","ocean prime - new york","fogo de chão - new york","corrado's cucina","tony's di napoli - upper east side","gyu-kaku japanese bbq - new york, ny | midtown manhattan","roberta's - bushwick","serafina long island city","serafina upper west","a la turka restaurant","sammy's smokehouse bbq & grill","musaafer - new york","da raffaele - nyc","savvy bistro & bar"];

const DATE_STR = '2026-04-14';
const OUTPUT = path.join(__dirname, '..', 'data', 'ot-review', 'ot_puppeteer_booked_77.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const randomDelay = (min, max) => sleep(min + Math.random() * (max - min));

function matchScore(search, found) {
  const c = s => s.toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const sc = c(search), fc = c(found);
  if (sc === fc) return 1.0;
  if (fc.includes(sc) || sc.includes(fc)) return 0.9;
  const stop = ['the','and','restaurant','bar','grill','cafe','kitchen','nyc','new','york'];
  const sw = sc.split(' ').filter(w => w.length > 2 && !stop.includes(w));
  const fw = fc.split(' ').filter(w => w.length > 2 && !stop.includes(w));
  if (sw.length === 0) return 0;
  return sw.filter(w => fw.some(f => f.includes(w) || w.includes(f))).length / sw.length;
}

async function searchOT(page, name) {
  const clean = name.replace(/\(.*\)/g,'').replace(/[–—]/g,'-').replace(/['']/g,"'").replace(/[^\w\s'-]/g,'').replace(/\s+/g,' ').trim();
  const url = `https://www.opentable.com/s?term=${encodeURIComponent(clean)}&dateTime=${DATE_STR}T19%3A00%3A00&covers=2&metroId=8`;
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await randomDelay(3000, 5000);

    const items = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-test="pinned-restaurant-card"],[data-test="restaurant-card"]');
      const seen = new Set(), out = [];
      for (const card of cards) {
        const rid = card.getAttribute('data-rid') || '';
        if (seen.has(rid)) continue; seen.add(rid);
        const nl = card.querySelector('a[data-test="res-card-name"]');
        const pl = card.querySelector('a[data-test^="restaurant-card-profile-link"]');
        const n = nl ? nl.textContent.trim() : '';
        const u = pl ? pl.getAttribute('href') : '';
        if (!n || !u) continue;
        const slots = [];
        const sc = card.querySelector('ul[data-test="time-slots"]');
        if (sc) { for (const li of sc.querySelectorAll('li[data-test^="time-slot"]')) { const m = li.textContent.trim().match(/^(\d{1,2}:\d{2}\s*[AP]M)/i); if (m) slots.push(m[1]); } }
        out.push({ name: n, url: u, rid: parseInt(rid) || 0, slots });
      }
      return out;
    });

    let best = null, bestS = 0;
    for (const it of items) { const s = matchScore(clean, it.name); if (s > bestS) { bestS = s; best = { ...it, score: s }; } }
    return best && bestS >= 0.5 ? best : null;
  } catch(e) { return null; }
}

(async () => {
  const results = {};
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900', '--start-maximized'],
    defaultViewport: null,
  });

  // Create a proper incognito context
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator,'webdriver',{get:()=>false}); });

  // Load OT first
  console.log('Loading OpenTable in incognito context...');
  await page.goto('https://www.opentable.com/', { waitUntil: 'networkidle2', timeout: 30000 });
  await randomDelay(3000, 5000);

  let open = 0, limited = 0, booked = 0, errors = 0;

  for (let i = 0; i < NAMES.length; i++) {
    const name = NAMES[i];

    // Pause every 15
    if (i > 0 && i % 15 === 0) {
      console.log(`⏸️  Pausing 60s at ${i}/${NAMES.length}`);
      await sleep(60000);
    }

    const r = await searchOT(page, name);

    if (r && r.slots.length > 0) {
      const tier = r.slots.length <= 3 ? 'limited' : 'open';
      results[name] = { rid: r.rid, tier, slots: r.slots.length, times: r.slots, matched: r.name, checked_date: DATE_STR };
      if (tier === 'open') open++; else limited++;
      console.log(`[${i+1}/${NAMES.length}] 🟢 ${name} → ${r.slots.length} slots (${r.slots.slice(0,3).join(', ')})`);
    } else if (r && r.url) {
      results[name] = { rid: r.rid, tier: 'booked', slots: 0, times: [], matched: r.name, checked_date: DATE_STR };
      booked++;
      console.log(`[${i+1}/${NAMES.length}] 🔴 ${name} — no slots`);
    } else {
      results[name] = { rid: null, tier: 'not_found', slots: 0, times: [], checked_date: DATE_STR };
      errors++;
      console.log(`[${i+1}/${NAMES.length}] ❌ ${name} — not found`);
    }

    await randomDelay(8000, 14000);
  }

  await browser.close();
  fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
  console.log(`\n[Done] 🟢${open} 🟡${limited} 🔴${booked} ❌${errors}`);
  console.log(`Saved to ${OUTPUT}`);
})();
