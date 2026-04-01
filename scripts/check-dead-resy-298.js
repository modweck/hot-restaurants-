/**
 * check-dead-resy-298.js
 *
 * For 298 dead Resy restaurants:
 *   1. Check Google Places if permanently closed
 *   2. Check if on OpenTable, Tock, SevenRooms via website
 *   3. Update BOOKING_MASTER accordingly
 *
 * RUN:   node scripts/check-dead-resy-298.js
 * OPTIONS:
 *   --quick       First 20 only
 *   --batch N     Check N then stop
 */

const fs = require('fs');
const path = require('path');

const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const CLEANUP_FILE = path.join(__dirname, '..', 'data', 'resy_771_cleanup.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'dead_resy_298_results.json');
const GOOGLE_KEY = 'AIzaSyDrtbSIA_BvJIzq1_-3pfQ_RgP2DiM_TKo';

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

// Check Google Places for business status
async function checkGoogle(name) {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(name + ' restaurant NYC')}&key=${GOOGLE_KEY}`;
    const resp = await fetch(url);
    const data = await resp.json();
    const result = data.results?.[0];
    if (!result) return { found: false };

    // Get details for website
    const detUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${result.place_id}&fields=name,business_status,website,formatted_address&key=${GOOGLE_KEY}`;
    const detResp = await fetch(detUrl);
    const det = (await detResp.json()).result || {};

    return {
      found: true,
      googleName: det.name || result.name,
      status: det.business_status || result.business_status || 'UNKNOWN',
      website: det.website || null,
      address: det.formatted_address || result.formatted_address || null,
      placeId: result.place_id
    };
  } catch {
    return { found: false };
  }
}

// Check a website for booking platform embeds
async function checkWebsiteForPlatform(website) {
  if (!website) return null;
  try {
    const resp = await fetch(website, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    const platforms = {};
    if (html.includes('resy.com') || html.includes('resyWidget')) platforms.resy = true;
    if (html.includes('opentable.com')) platforms.opentable = true;
    if (html.includes('exploretock.com') || html.includes('tock.com')) platforms.tock = true;
    if (html.includes('sevenrooms.com')) platforms.sevenrooms = true;
    if (html.includes('yelp.com/reservations')) platforms.yelp = true;

    // Try to extract booking URLs
    const otMatch = html.match(/https:\/\/www\.opentable\.com\/r\/([a-z0-9-]+)/i);
    const resyMatch = html.match(/resy\.com\/cities\/[a-z-]+\/(?:venues\/)?([a-z0-9-]+)/i);
    const tockMatch = html.match(/exploretock\.com\/([a-z0-9-]+)/i);
    const srMatch = html.match(/sevenrooms\.com\/reservations\/([a-z0-9-]+)/i);

    return {
      platforms,
      urls: {
        opentable: otMatch ? `https://www.opentable.com/r/${otMatch[1]}` : null,
        resy: resyMatch ? `https://resy.com/cities/ny/${resyMatch[1]}` : null,
        tock: tockMatch ? `https://www.exploretock.com/${tockMatch[1]}` : null,
        sevenrooms: srMatch ? `https://www.sevenrooms.com/reservations/${srMatch[1]}` : null
      }
    };
  } catch {
    return null;
  }
}

async function main() {
  const master = loadJSON(MASTER_FILE);
  const cleanup = loadJSON(CLEANUP_FILE);
  let results = loadJSON(OUTPUT_FILE);

  const dead = Object.entries(cleanup)
    .filter(([, v]) => v.status === 'dead')
    .map(([name]) => name)
    .filter(name => !results[name]);

  let todo = dead;
  if (QUICK) todo = todo.slice(0, 20);
  if (BATCH_LIMIT > 0) todo = todo.slice(0, BATCH_LIMIT);

  console.log(`\n🔍 Dead Resy 298 — Check Closed + Platform`);
  console.log(`📋 Dead Resy restaurants: ${dead.length}`);
  console.log(`✅ Already checked: ${Object.keys(results).length}`);
  console.log(`📋 To check: ${todo.length}`);
  console.log(`${'═'.repeat(55)}\n`);

  if (todo.length === 0) { printSummary(results); return; }

  let closed = 0, switched = 0, websiteOnly = 0, walkIn = 0, notFound = 0;

  for (let i = 0; i < todo.length; i++) {
    const name = todo[i];
    const masterKey = Object.keys(master).find(k => k.toLowerCase() === name.toLowerCase()) || name;
    const entry = master[masterKey];

    process.stdout.write(`  [${i + 1}/${todo.length}] ${name.substring(0, 35).padEnd(35)} `);

    // Step 1: Check Google
    const google = await checkGoogle(name);
    await sleep(200);

    if (google.found && google.status === 'CLOSED_PERMANENTLY') {
      results[name] = { status: 'closed', googleName: google.googleName, action: 'remove' };
      closed++;
      console.log(`💀 CLOSED (${google.googleName})`);

      // Remove from BOOKING_MASTER
      if (master[masterKey]) delete master[masterKey];
    } else {
      // Step 2: Check website for other platforms
      const website = entry?.website || google.website;
      const webCheck = await checkWebsiteForPlatform(website);
      await sleep(200);

      if (webCheck && Object.keys(webCheck.platforms).length > 0) {
        // Found a booking platform
        const plats = webCheck.platforms;
        let newPlatform = null;
        let newUrl = null;

        if (plats.opentable && webCheck.urls.opentable) {
          newPlatform = 'opentable';
          newUrl = webCheck.urls.opentable;
        } else if (plats.resy && webCheck.urls.resy) {
          newPlatform = 'resy';
          newUrl = webCheck.urls.resy;
        } else if (plats.tock && webCheck.urls.tock) {
          newPlatform = 'tock';
          newUrl = webCheck.urls.tock;
        } else if (plats.sevenrooms && webCheck.urls.sevenrooms) {
          newPlatform = 'sevenrooms';
          newUrl = webCheck.urls.sevenrooms;
        }

        if (newPlatform && newUrl) {
          results[name] = {
            status: 'switched',
            newPlatform,
            newUrl,
            oldUrl: entry?.url,
            website
          };
          switched++;
          console.log(`🔄 → ${newPlatform} (${newUrl.substring(0, 50)})`);

          if (master[masterKey]) {
            master[masterKey].platform = newPlatform;
            master[masterKey].url = newUrl;
          }
        } else {
          // Has platform on website but couldn't extract URL
          results[name] = {
            status: 'website',
            platforms: Object.keys(plats),
            website,
            action: 'switch_to_website'
          };
          websiteOnly++;
          console.log(`🌐 website (has ${Object.keys(plats).join(', ')})`);

          if (master[masterKey]) {
            master[masterKey].platform = 'website';
            master[masterKey].url = website;
          }
        }
      } else if (website) {
        // Has a website but no booking platform detected
        results[name] = { status: 'website_only', website, action: 'switch_to_website' };
        websiteOnly++;
        console.log(`🌐 website only`);

        if (master[masterKey]) {
          master[masterKey].platform = 'website';
          master[masterKey].url = website;
        }
      } else {
        // No website, not closed — walk-in
        results[name] = { status: 'walk_in', action: 'switch_to_walk_in' };
        walkIn++;
        console.log(`🚶 walk-in`);

        if (master[masterKey]) {
          master[masterKey].platform = 'walk_in';
          master[masterKey].url = '';
        }
      }
    }

    // Save every 25
    if ((i + 1) % 25 === 0) {
      saveJSON(OUTPUT_FILE, results);
      saveJSON(MASTER_FILE, master);
      console.log(`    💾 Progress saved`);
    }

    await sleep(300 + Math.random() * 300);
  }

  saveJSON(OUTPUT_FILE, results);
  saveJSON(MASTER_FILE, master);

  printSummary(results);
}

function printSummary(results) {
  const entries = Object.values(results);
  const closed = entries.filter(v => v.status === 'closed').length;
  const switched = entries.filter(v => v.status === 'switched').length;
  const website = entries.filter(v => v.status === 'website' || v.status === 'website_only').length;
  const walkIn = entries.filter(v => v.status === 'walk_in').length;

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`📊 SUMMARY (${entries.length} checked)`);
  console.log(`   💀 Permanently closed (removed): ${closed}`);
  console.log(`   🔄 Switched to other platform: ${switched}`);
  console.log(`   🌐 Switched to website: ${website}`);
  console.log(`   🚶 Switched to walk-in: ${walkIn}`);
  console.log(`\n💾 BOOKING_MASTER updated`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
