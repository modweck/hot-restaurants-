/**
 * fix-resy-771-puppeteer.js
 *
 * One-time cleanup: visits each "fully_locked" Resy restaurant page with Puppeteer.
 * - If page loads with slots → fixes availability data
 * - If page loads with "Notify Me" → genuinely booked, marks correct
 * - If 404/redirect → wrong slug, tries search to find correct one
 * Updates booking_lookup.json and tonight_availability.json.
 *
 * RUN:   node scripts/fix-resy-771-puppeteer.js
 * OPTIONS:
 *   --quick       First 10 only
 *   --batch N     Check N then stop
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const LOOKUP_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'booking_lookup.json');
const AVAIL_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'tonight_availability.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'resy_771_cleanup.json');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
function getArg(name, def) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}
const BATCH_LIMIT = parseInt(getArg('batch', '0'), 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } }
function saveJSON(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

async function checkResyPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(2500);

    return await page.evaluate(() => {
      const body = document.body?.innerText || '';
      const h1 = document.querySelector('h1');
      const finalUrl = window.location.href;

      const is404 = body.includes('page you were looking for') || body.includes("can't find") ||
                     body.includes('can\u2019t find') || body.includes('Sorry, but we') ||
                     window.location.pathname === '/' || window.location.pathname === '/cities/ny';

      const hasSlots = !!document.querySelector('[class*="TimeSlot"]') ||
                       !!document.querySelector('[class*="ReservationButton"]');
      const hasNotify = body.includes('Notify Me');
      const hasFindTime = body.includes('Find a Time');
      const hasReserve = body.includes('Reserve Now');

      // Count visible time slot buttons
      const timeButtons = [...document.querySelectorAll('button, [role=button]')]
        .map(b => b.textContent?.trim())
        .filter(t => t && /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(t));

      return {
        is404,
        venueName: h1?.textContent?.trim() || '',
        finalUrl,
        hasSlots: hasSlots || timeButtons.length > 0,
        hasNotify,
        hasFindTime,
        hasReserve,
        slotCount: timeButtons.length,
        timeButtons: timeButtons.slice(0, 6),
        bodyLen: body.length
      };
    });
  } catch (e) {
    return { is404: true, error: e.message };
  }
}

async function searchResyPage(page, name) {
  // Visit resy.com and use the search
  try {
    await page.goto('https://resy.com/cities/ny', { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(2000);

    // Type in the search box
    await page.keyboard.press('Escape'); // close any modals
    await sleep(500);

    // Find and click search input
    const typed = await page.evaluate((searchName) => {
      const inputs = document.querySelectorAll('input');
      for (const inp of inputs) {
        if (inp.placeholder?.toLowerCase().includes('search') || inp.type === 'search') {
          inp.focus();
          inp.value = searchName;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
      }
      return false;
    }, name);

    if (!typed) return null;
    await sleep(3000);

    // Get search results
    const results = await page.evaluate((searchName) => {
      const nameWords = searchName.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 1);
      const links = [];
      document.querySelectorAll('a[href*="/cities/"]').forEach(a => {
        const href = a.href;
        const text = a.textContent?.trim() || '';
        if (href.includes('/cities/') && !href.includes('?') && text.length > 1 && text.length < 100) {
          const linkWords = text.toLowerCase();
          const match = nameWords.filter(w => linkWords.includes(w)).length;
          const ratio = nameWords.length > 0 ? match / nameWords.length : 0;
          if (ratio >= 0.4) links.push({ href, text, ratio });
        }
      });
      return links.sort((a, b) => b.ratio - a.ratio).slice(0, 3);
    }, name);

    if (results.length > 0) {
      // Visit the best match
      await page.goto(results[0].href, { waitUntil: 'networkidle2', timeout: 15000 });
      await sleep(2000);

      const info = await page.evaluate(() => {
        const h1 = document.querySelector('h1');
        const finalUrl = window.location.href;
        const body = document.body?.innerText || '';
        const is404 = window.location.pathname === '/' || window.location.pathname === '/cities/ny';
        return { venueName: h1?.textContent?.trim() || '', finalUrl, is404, bodyLen: body.length };
      });

      if (!info.is404 && info.venueName) {
        const slugMatch = info.finalUrl.match(/\/cities\/[a-z-]+\/(?:venues\/)?([a-z0-9-]+)/i);
        return slugMatch ? { slug: slugMatch[1].toLowerCase(), venueName: info.venueName, url: info.finalUrl } : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  const lookup = loadJSON(LOOKUP_FILE);
  const avail = loadJSON(AVAIL_FILE);
  let results = loadJSON(OUTPUT_FILE);

  const locked = Object.entries(avail)
    .filter(([k, v]) => !k.startsWith('_') && v.fully_locked)
    .map(([name]) => name)
    .filter(name => {
      const entry = lookup[name] || lookup[Object.keys(lookup).find(k => k.toLowerCase() === name)];
      return entry && entry.platform === 'resy' && entry.url;
    })
    .filter(name => !results[name]);

  let todo = locked;
  if (QUICK) todo = todo.slice(0, 10);
  if (BATCH_LIMIT > 0) todo = todo.slice(0, BATCH_LIMIT);

  console.log(`\n🔧 Resy 771 Cleanup (Puppeteer)`);
  console.log(`📋 Locked restaurants: ${locked.length}`);
  console.log(`✅ Already checked: ${Object.keys(results).length}`);
  console.log(`📋 To check: ${todo.length}`);
  console.log(`${'═'.repeat(55)}\n`);

  if (todo.length === 0) { printSummary(results); return; }

  let browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1280,800']
  });
  let page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  let slugOk = 0, hasAvail = 0, genuinelyBooked = 0, wrongSlugFixed = 0, dead = 0;

  for (let i = 0; i < todo.length; i++) {
    const name = todo[i];
    const lookupKey = Object.keys(lookup).find(k => k.toLowerCase() === name.toLowerCase()) || name;
    const entry = lookup[lookupKey];
    const currentUrl = entry.url;

    process.stdout.write(`  [${i + 1}/${todo.length}] ${name.substring(0, 35).padEnd(35)} `);

    const result = await checkResyPage(page, currentUrl);

    if (!result.is404 && result.venueName && result.bodyLen > 500) {
      // Page loaded — slug is correct
      const slugMatch = result.finalUrl.match(/\/cities\/[a-z-]+\/(?:venues\/)?([a-z0-9-]+)/i);
      const finalSlug = slugMatch ? slugMatch[1].toLowerCase() : '';

      if (result.hasSlots || result.hasFindTime || result.hasReserve) {
        // HAS AVAILABILITY — was wrongly marked as booked
        results[name] = {
          status: 'has_availability',
          slug: finalSlug,
          venueName: result.venueName,
          url: result.finalUrl,
          slotCount: result.slotCount,
          sampleTimes: result.timeButtons
        };
        hasAvail++;
        console.log(`🟢 HAS SLOTS (${result.slotCount}) — ${result.venueName}`);

        // Fix availability data
        const key = name.toLowerCase();
        if (avail[key]) {
          delete avail[key].fully_locked;
          avail[key].tier = result.slotCount > 3 ? 'open' : result.slotCount > 0 ? 'limited' : 'open';
        }
      } else if (result.hasNotify) {
        // Genuinely booked
        results[name] = {
          status: 'genuinely_booked',
          slug: finalSlug,
          venueName: result.venueName
        };
        genuinelyBooked++;
        console.log(`🔒 genuinely booked (${result.venueName})`);
      } else {
        // Page loaded but unclear
        results[name] = {
          status: 'slug_ok_unclear',
          slug: finalSlug,
          venueName: result.venueName
        };
        slugOk++;
        console.log(`✅ page loads — ${result.venueName}`);
      }

      // Update slug if redirected
      if (finalSlug && result.finalUrl !== currentUrl) {
        lookup[lookupKey].url = result.finalUrl;
        wrongSlugFixed++;
      }
    } else {
      // 404 or dead — try search
      process.stdout.write(`🔍 `);
      await sleep(2000);
      const found = await searchResyPage(page, name);

      if (found) {
        results[name] = {
          status: 'slug_fixed',
          oldUrl: currentUrl,
          newSlug: found.slug,
          newUrl: found.url,
          venueName: found.venueName
        };
        lookup[lookupKey].url = found.url;
        wrongSlugFixed++;
        console.log(`🔧 → ${found.slug} (${found.venueName})`);
      } else {
        results[name] = { status: 'dead', oldUrl: currentUrl };
        dead++;
        console.log(`💀 dead`);
      }
    }

    // Save every 25
    if ((i + 1) % 25 === 0) {
      saveJSON(OUTPUT_FILE, results);
      saveJSON(LOOKUP_FILE, lookup);
      saveJSON(AVAIL_FILE, avail);
      console.log(`    💾 Progress saved`);
    }

    // Restart browser every 75
    if ((i + 1) % 75 === 0) {
      await browser.close();
      await sleep(3000);
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
      });
      page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
      await page.setViewport({ width: 1280, height: 800 });
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });
      console.log(`    🔄 Browser restarted`);
    }

    await sleep(3000 + Math.random() * 3000);
  }

  await browser.close();

  // Final save
  saveJSON(OUTPUT_FILE, results);
  saveJSON(LOOKUP_FILE, lookup);
  saveJSON(AVAIL_FILE, avail);

  printSummary(results);
}

function printSummary(results) {
  const entries = Object.values(results);
  const hasAvail = entries.filter(v => v.status === 'has_availability').length;
  const booked = entries.filter(v => v.status === 'genuinely_booked').length;
  const slugFixed = entries.filter(v => v.status === 'slug_fixed').length;
  const slugOk = entries.filter(v => v.status === 'slug_ok_unclear').length;
  const dead = entries.filter(v => v.status === 'dead').length;

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`📊 SUMMARY (${entries.length} checked)`);
  console.log(`   🟢 Has availability (was wrong): ${hasAvail}`);
  console.log(`   🔒 Genuinely booked: ${booked}`);
  console.log(`   🔧 Slug fixed via search: ${slugFixed}`);
  console.log(`   ✅ Slug OK (unclear avail): ${slugOk}`);
  console.log(`   💀 Dead / not on Resy: ${dead}`);
  console.log(`\n💾 All files updated`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
