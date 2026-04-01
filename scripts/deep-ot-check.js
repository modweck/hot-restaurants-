/**
 * deep-ot-check.js
 *
 * Thorough OT check for remaining 650 restaurants:
 * 1. Search OT by name → get correct slug/URL from search card
 * 2. If found with booking slots → update BOOKING_MASTER with correct OT URL
 * 3. If found but "not on reservation network" → switch to website
 * 4. If not found on OT → try Google Places for website
 * 5. Save full report
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const INPUT_FILE = path.join(__dirname, '..', 'data', 'ot_remaining_check.json');
const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const REPORT_FILE = path.join(__dirname, '..', 'data', 'ot_deep_check_report.json');
const GOOGLE_KEY = 'AIzaSyDrtbSIA_BvJIzq1_-3pfQ_RgP2DiM_TKo';

const sleep = ms => new Promise(r => setTimeout(r, ms));
function randomDelay() { return 3000 + Math.floor(Math.random() * 5000); }

const CHECK_DATE = new Date(Date.now() + 86400000).toISOString().split('T')[0]; // tomorrow
const BROWSER_RESTART_EVERY = 75;
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
];

function matchScore(search, found) {
  const c = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const sc = c(search), fc = c(found);
  if (sc === fc) return 1.0;
  if (fc.includes(sc) || sc.includes(fc)) return 0.9;
  const stop = ['the', 'and', 'restaurant', 'bar', 'grill', 'cafe', 'kitchen', 'nyc', 'new', 'york'];
  const sw = sc.split(' ').filter(w => w.length > 2 && !stop.includes(w));
  const fw = fc.split(' ').filter(w => w.length > 2 && !stop.includes(w));
  if (sw.length === 0) return 0;
  const overlap = sw.filter(w => fw.some(f => f.includes(w) || w.includes(f)));
  return overlap.length / sw.length;
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });
}

async function setupPage(browser) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };
  });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  const vp = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
  await page.setViewport(vp);
  return page;
}

async function searchOT(page, name) {
  const cleanName = name.replace(/\(.*\)/g, '').replace(/[^\w\s'-]/g, '').replace(/\s+/g, ' ').trim();
  const url = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName)}&dateTime=${CHECK_DATE}T20%3A00%3A00&covers=2&metroId=8`;

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });

    const cards = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-test="pinned-restaurant-card"],[data-test="restaurant-card"]'))
        .slice(0, 5)
        .map(card => {
          const cardText = card.innerText;
          const nameEl = card.querySelector('a[data-test="res-card-name"]');
          const profileLink = card.querySelector('a[data-test^="restaurant-card-profile-link"]');
          const n = nameEl ? nameEl.textContent.trim() : '';
          const rid = card.getAttribute('data-rid') || '';
          const href = profileLink ? profileLink.href : '';

          // Get time slots
          const slots = Array.from(card.querySelectorAll('li[data-test^="time-slot"]'))
            .map(s => { const m = s.textContent.match(/(\d{1,2}:\d{2}\s*[AP]M)/i); return m ? m[1] : null; })
            .filter(Boolean);

          const notOnOT = cardText.includes('not on the OpenTable reservation network');
          const noAvail = cardText.includes('no online availability') || cardText.includes('Find next available');
          const bookedMatch = cardText.match(/Booked (\d+) times/);

          return {
            name: n, rid, href, slots,
            notOnOT, noAvail,
            bookedToday: bookedMatch ? parseInt(bookedMatch[1]) : 0,
          };
        });
    });

    return cards;
  } catch (e) {
    return null;
  }
}

async function googleLookup(name) {
  try {
    const searchUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(name + ' new york restaurant')}&inputtype=textquery&fields=name,place_id,business_status&key=${GOOGLE_KEY}`;
    const res = await fetch(searchUrl);
    const data = await res.json();
    if (!data.candidates || data.candidates.length === 0) return null;

    const candidate = data.candidates[0];
    if (candidate.business_status === 'CLOSED_PERMANENTLY') return { closed: true, name: candidate.name };

    const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${candidate.place_id}&fields=name,website,business_status&key=${GOOGLE_KEY}`;
    const detailRes = await fetch(detailUrl);
    const detail = await detailRes.json();

    return {
      closed: detail.result?.business_status === 'CLOSED_PERMANENTLY',
      name: detail.result?.name,
      website: detail.result?.website || null,
    };
  } catch { return null; }
}

async function main() {
  const toCheck = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  const master = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));

  console.log(`🔍 Deep OT check for ${toCheck.length} restaurants\n`);
  console.log(`   Searching OT for correct slugs + checking Google for websites\n`);

  let browser = await launchBrowser();
  let page = await setupPage(browser);
  let sessionCount = 0;
  let consecutiveUnknowns = 0;

  const report = [];
  let stats = { foundOnOT: 0, notOnOTNetwork: 0, notFoundOnOT: 0, closedGoogle: 0, foundWebsite: 0, walkIn: 0, errors: 0 };
  let checked = 0;

  for (const r of toCheck) {
    // Restart browser every N
    if (sessionCount >= BROWSER_RESTART_EVERY) {
      await browser.close();
      await sleep(5000);
      browser = await launchBrowser();
      page = await setupPage(browser);
      sessionCount = 0;
      console.log(`\n  🔄 Browser restarted\n`);
    }

    // Step 1: Search OT
    const cards = await searchOT(page, r.name);
    checked++;
    sessionCount++;

    const key = Object.keys(master).find(k => k.toLowerCase() === r.name.toLowerCase());
    if (!key) { checked++; continue; }

    let action = 'unknown';
    let newUrl = '';
    let newPlatform = '';
    let matchedName = '';
    let icon = '❓';

    if (cards && cards.length > 0) {
      // Find best match
      let bestCard = null, bestScore = 0;
      for (const card of cards) {
        const score = matchScore(r.name, card.name);
        if (score > bestScore) { bestScore = score; bestCard = card; }
      }

      if (bestCard && bestScore >= 0.5) {
        matchedName = bestCard.name;
        consecutiveUnknowns = 0;

        if (bestCard.slots.length > 0) {
          // Found on OT with availability! Get correct URL
          action = 'found_on_ot';
          newPlatform = 'opentable';
          newUrl = bestCard.href || r.currentUrl;
          icon = '🟢';
          stats.foundOnOT++;
          master[key].platform = 'opentable';
          if (bestCard.href) master[key].url = bestCard.href;

        } else if (bestCard.notOnOT) {
          // Not on OT reservation network
          action = 'not_on_ot_network';
          icon = '🚫';
          stats.notOnOTNetwork++;

          // Switch to website if available
          if (master[key].website && master[key].website.startsWith('http')) {
            master[key].platform = 'website';
            master[key].url = master[key].website;
            newPlatform = 'website';
            newUrl = master[key].website;
          }

        } else if (bestCard.noAvail || bestCard.bookedToday > 0) {
          // Found on OT, genuinely booked — keep as OT, fix URL if needed
          action = 'on_ot_booked';
          icon = '🔴';
          stats.foundOnOT++;
          if (bestCard.href) master[key].url = bestCard.href;

        } else {
          // Found but no clear status
          action = 'on_ot_unclear';
          icon = '🟠';
          stats.foundOnOT++;
          if (bestCard.href) master[key].url = bestCard.href;
        }
      } else {
        // No good match in search
        action = 'no_match';
        consecutiveUnknowns++;
      }
    } else {
      // Search returned nothing or error
      action = 'search_failed';
      consecutiveUnknowns++;
      stats.errors++;
    }

    // Step 2: If not found on OT, try Google for website
    if (action === 'no_match' || action === 'search_failed' || (action === 'not_on_ot_network' && !newUrl)) {
      const google = await googleLookup(r.name);
      await sleep(200);

      if (google?.closed) {
        action = 'closed_permanently';
        icon = '💀';
        stats.closedGoogle++;
        delete master[key];
      } else if (google?.website) {
        if (action === 'not_on_ot_network' || action === 'no_match' || action === 'search_failed') {
          master[key].platform = 'website';
          master[key].url = google.website;
          newPlatform = 'website';
          newUrl = google.website;
          stats.foundWebsite++;
          if (action !== 'not_on_ot_network') { action = 'google_website'; icon = '🌐'; }
        }
      } else if (action !== 'not_on_ot_network') {
        // No website found either — check if existing website in master
        if (master[key].website && master[key].website.startsWith('http')) {
          master[key].platform = 'website';
          master[key].url = master[key].website;
          action = 'fallback_website';
          icon = '🌐';
          stats.foundWebsite++;
        } else {
          action = 'walk_in';
          icon = '🚶';
          master[key].platform = 'walk_in';
          master[key].url = '';
          stats.walkIn++;
        }
      }
      stats.notFoundOnOT++;
    }

    // Auto-restart if blocked
    if (consecutiveUnknowns >= 15) {
      console.log(`\n  ⚠️  15 unknowns — restarting browser + cooldown\n`);
      await browser.close();
      await sleep(15000);
      browser = await launchBrowser();
      page = await setupPage(browser);
      sessionCount = 0;
      consecutiveUnknowns = 0;
    }

    report.push({ name: r.name, action, matchedName, newPlatform, newUrl, icon });
    console.log(`  ${icon} [${checked}/${toCheck.length}] ${r.name}: ${action}${matchedName ? ' → ' + matchedName : ''}${newUrl ? ' (' + newUrl.substring(0, 50) + ')' : ''}`);

    // Save every 25
    if (checked % 25 === 0) {
      fs.writeFileSync(MASTER_FILE, JSON.stringify(master, null, 2));
      fs.writeFileSync(REPORT_FILE, JSON.stringify({ stats, report }, null, 2));
    }

    await sleep(randomDelay());
  }

  await browser.close();

  // Final save
  fs.writeFileSync(MASTER_FILE, JSON.stringify(master, null, 2));
  fs.writeFileSync(REPORT_FILE, JSON.stringify({ stats, report }, null, 2));

  // Platform summary
  const byPlatform = {};
  for (const [_, info] of Object.entries(master)) {
    byPlatform[info.platform] = (byPlatform[info.platform] || 0) + 1;
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Deep check complete! ${checked} restaurants\n`);
  console.log(`   🟢 Found on OT (correct slug): ${stats.foundOnOT}`);
  console.log(`   🚫 Not on OT network: ${stats.notOnOTNetwork}`);
  console.log(`   💀 Closed (Google): ${stats.closedGoogle}`);
  console.log(`   🌐 Found website (Google): ${stats.foundWebsite}`);
  console.log(`   🚶 Walk-in (no booking): ${stats.walkIn}`);
  console.log(`   ⚠️  Errors: ${stats.errors}`);
  console.log(`\n   Platform breakdown:`, byPlatform);
  console.log(`   Total: ${Object.keys(master).length}`);
  console.log(`\n   Report: ${REPORT_FILE}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
