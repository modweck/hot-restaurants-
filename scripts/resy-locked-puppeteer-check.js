/**
 * resy-locked-puppeteer-check.js
 *
 * Uses Puppeteer to check future availability for locked/failed Resy restaurants.
 * Loads actual Resy pages like a real user with long delays between requests.
 *
 * RUN:   node scripts/resy-locked-puppeteer-check.js
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const FUNCS = path.join(__dirname, '..', 'netlify', 'functions');
const AVAIL_FILE = path.join(FUNCS, 'tonight_availability.json');
const BOOKING_FILE = path.join(FUNCS, 'booking_lookup.json');

const PARTY_SIZE = 2;
const TODAY = new Date().toISOString().split('T')[0];

function futureDate(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

const DATES_TO_CHECK = [
  { date: futureDate(14), label: '+14d' },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractResySlug(url) {
  if (!url) return null;
  const m1 = url.match(/resy\.com\/cities\/[a-z-]+\/([a-z0-9_-]+)\/?$/i);
  if (m1) return m1[1].toLowerCase();
  const m2 = url.match(/venues\/([a-z0-9_-]+)\/?$/i);
  if (m2) return m2[1].toLowerCase();
  return null;
}

// Load data
let availability = JSON.parse(fs.readFileSync(AVAIL_FILE, 'utf8'));
const BOOKING_LOOKUP = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));

// Only check the 37 that failed API checks (not the 45 already confirmed locked)
const FAILED_NAMES = new Set(["third kingdom","nizuc","koon taste of siam","ferdi","mountain house midtown","estancia piola 288","martha's","hwaro nyc times square","time out market - union square","sushi sho - nyc","icca","yoshino omakase","baar baar","sushi sho","momoya upper west","le bilboquet ny","urban vegan roots","pitt's","barbes restaurant","city bistro","crabtree's restaurant","ddobar","elia restaurant - brooklyn","faubourg weehawken","giacomo pizzería & restaurant","jiang nan - fort lee","jiang nan - jersey city","la boheme-hoboken","sweet t's southern eatery - montclair","take care","tha phraya","harvey's at union station","hwaro","habibi the restaurant","chemistry room at sushi lab","mr. sun","sushi by bou times square"]);

const toCheck = [];
for (const [k, v] of Object.entries(availability)) {
  if (k.startsWith('_')) continue;
  if (!FAILED_NAMES.has(k)) continue;
  const info = BOOKING_LOOKUP[k] || BOOKING_LOOKUP[Object.keys(BOOKING_LOOKUP).find(x => x.toLowerCase() === k)];
  if (!info || info.platform !== 'resy' || !info.url) continue;
  const slug = extractResySlug(info.url);
  if (!slug) continue;
  toCheck.push({ name: k, slug, url: info.url });
}

// Try multiple URL patterns for a slug
function getUrlVariants(slug) {
  const short = slug.replace(/-new-york$/, '');
  const variants = new Set([
    `https://resy.com/cities/new-york-ny/${slug}`,
    `https://resy.com/cities/ny/${slug}`,
    `https://resy.com/cities/new-york-ny/${short}`,
    `https://resy.com/cities/ny/${short}`,
  ]);
  return [...variants];
}

async function checkRestaurant(browser, slug, date, partySize, bookingUrl) {
  let page;
  try {
    page = await browser.newPage();

    const widths = [1280, 1366, 1440, 1536, 1920];
    const w = widths[Math.floor(Math.random() * widths.length)];
    await page.setViewport({ width: w, height: 900 });

    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36');

    // Intercept /4/find API response
    let apiSlots = null;
    page.on('response', async (resp) => {
      if (resp.url().includes('/4/find') && resp.request().method() === 'POST') {
        try {
          const data = await resp.json();
          const slots = data?.results?.venues?.[0]?.slots || [];
          apiSlots = slots.filter(s => {
            const t = s.date?.start || '';
            const hm = t.match(/(\d{2}):(\d{2})/);
            return hm && parseInt(hm[1]) >= 17;
          });
        } catch {}
      }
    });

    // Try the booking URL first, then variants
    const urls = [bookingUrl + `?date=${date}&seats=${partySize}`];
    for (const base of getUrlVariants(slug)) {
      urls.push(`${base}?date=${date}&seats=${partySize}`);
    }
    // Dedupe
    const seen = new Set();
    const uniqueUrls = urls.filter(u => { const k = u.split('?')[0]; if (seen.has(k)) return false; seen.add(k); return true; });

    let foundPage = false;
    for (const url of uniqueUrls) {
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
        await sleep(3000 + Math.floor(Math.random() * 2000));

        const pageText = await page.evaluate(() => document.body?.innerText || '');
        if (pageText.includes("can't find that page") || pageText.includes('Page not found')) {
          continue; // try next URL
        }
        foundPage = true;
        break;
      } catch { continue; }
    }

    if (!foundPage) return { available: false, slots: 0, notFound: true };

    // Check intercepted API first
    if (apiSlots && apiSlots.length > 0) return { available: true, slots: apiSlots.length };

    // Scrape page for time buttons
    const scraped = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button, [role=button]')];
      return btns
        .map(b => b.textContent?.trim())
        .filter(t => t && /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(t));
    });
    if (scraped.length > 0) return { available: true, slots: scraped.length };

    // Check for "Notify Me" = fully booked
    const pageText = await page.evaluate(() => document.body?.innerText || '');
    if (pageText.includes('Notify') || pageText.includes('no availability') || pageText.includes('No availability')) {
      return { available: false, slots: 0 };
    }

    return { available: false, slots: 0 };
  } catch (e) {
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

async function main() {
  console.log('\n🌐 RESY LOCKED PUPPETEER CHECK');
  console.log(`📅 Today: ${TODAY}  👥 Party: ${PARTY_SIZE}`);
  console.log(`🎯 Checking: ${toCheck.length} restaurants × ${DATES_TO_CHECK.length} future dates`);
  console.log(`⏱️  ~15-20s per restaurant (spacing out like a real user)`);
  console.log('─────────────────────────────────────\n');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });

  let found = 0, stillLocked = 0, failed = 0;

  for (let i = 0; i < toCheck.length; i++) {
    const r = toCheck[i];
    process.stdout.write(`  [${i + 1}/${toCheck.length}] ${r.name.substring(0, 38).padEnd(38)} `);

    let opensIn = null;
    let lastResult = null;

    for (const { date, label } of DATES_TO_CHECK) {
      const result = await checkRestaurant(browser, r.slug, date, PARTY_SIZE, r.url);
      lastResult = result;

      if (result === null) {
        process.stdout.write(`${label}:err `);
      } else if (result.notFound) {
        process.stdout.write(`${label}:💀 `);
        break;
      } else if (result.available) {
        const diffMs = new Date(date) - new Date(TODAY);
        opensIn = Math.round(diffMs / 86400000);
        process.stdout.write(`${label}:✅${result.slots} `);
        break;
      } else {
        process.stdout.write(`${label}:❌ `);
      }

      // Space out between date checks for same restaurant
      await sleep(2000 + Math.floor(Math.random() * 1000));
    }

    if (opensIn) {
      availability[r.name].opens_in = opensIn;
      delete availability[r.name].fully_locked;
      found++;
      console.log(`→ 🟢 opens +${opensIn}d`);
    } else if (lastResult && lastResult.notFound) {
      availability[r.name].broken_resy = true;
      failed++;
      console.log(`→ 💀 broken page (not on Resy)`);
    } else {
      availability[r.name].fully_locked = true;
      stillLocked++;
      console.log(`→ 🔒 locked`);
    }

    // Save every 10
    if ((i + 1) % 10 === 0) {
      fs.writeFileSync(AVAIL_FILE, JSON.stringify(availability, null, 2));
      console.log(`    💾 Progress saved (${i + 1}/${toCheck.length})`);
    }

    // Long delay between restaurants — act human
    const delay = 10000 + Math.floor(Math.random() * 8000); // 10-18s
    await sleep(delay);
  }

  await browser.close();

  // Final save
  fs.writeFileSync(AVAIL_FILE, JSON.stringify(availability, null, 2));

  console.log(`\n${'═'.repeat(45)}`);
  console.log(`📊 RESULTS`);
  console.log(`   🟢 Opens up: ${found}`);
  console.log(`   🔒 Still locked: ${stillLocked}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`\n💾 Saved → ${AVAIL_FILE}`);
}

main().catch(console.error);
