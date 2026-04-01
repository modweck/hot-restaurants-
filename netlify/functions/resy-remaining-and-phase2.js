/**
 * resy-remaining-and-phase2.js
 *
 * ONE-TIME SCRIPT: Check remaining unchecked Resy restaurants + Phase 2 future availability
 * Puppeteer only, no API calls. Does not overwrite existing today data.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
const CHECK_ALL = args.includes('--all');
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}
const SPLIT_TOTAL = parseInt(getArg('split', '1'), 10);
const SPLIT_HALF  = parseInt(getArg('half', '1'), 10);

const TODAY = new Date().toISOString().split('T')[0];
const CHECK_DATE = getArg('date', TODAY);
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);

const MASTER_FILE  = path.join(__dirname, 'BOOKING_MASTER.json');
const BOOKING_FILE = path.join(__dirname, 'booking_lookup.json');
const OUTPUT_FILE  = SPLIT_TOTAL > 1
  ? path.join(__dirname, `tonight_availability_resy_half${SPLIT_HALF}.json`)
  : path.join(__dirname, 'tonight_availability.json');

// ── Sync booking_lookup ──
try {
  const master = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
  const old = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));
  const synced = {};
  for (const [name, v] of Object.entries(master)) {
    if (!v.platform || !v.url) continue;
    const k = name.toLowerCase();
    synced[k] = { platform: v.platform, url: v.url };
    if (v.lat) synced[k].lat = v.lat;
    if (v.lng) synced[k].lng = v.lng;
    if (v.website) synced[k].website = v.website;
    if (v.venue_id) synced[k].venue_id = v.venue_id;
    const o = old[name] || old[k];
    if (o) for (const [k2, v2] of Object.entries(o)) if (!(k2 in synced[k])) synced[k][k2] = v2;
  }
  fs.writeFileSync(BOOKING_FILE, JSON.stringify(synced, null, 2));
  console.log(`🔄 booking_lookup synced: ${Object.keys(synced).length} entries`);
} catch (e) { console.log('⚠️ sync skipped:', e.message); }

const BOOKING_LOOKUP = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));
let output = {};
try { output = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}
// For split mode, also load main file to check what's already done
if (SPLIT_TOTAL > 1) {
  try {
    const main = JSON.parse(fs.readFileSync(path.join(__dirname, 'tonight_availability.json'), 'utf8'));
    for (const [k, v] of Object.entries(main)) { if (!output[k]) output[k] = v; }
  } catch {}
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function extractResySlug(url) {
  if (!url) return null;
  const m1 = url.match(/resy\.com\/cities\/[a-z-]+\/([a-z0-9_-]+)\/?$/i);
  if (m1) return m1[1].toLowerCase();
  const m2 = url.match(/venues\/([a-z0-9_-]+)\/?$/i);
  if (m2) return m2[1].toLowerCase();
  return null;
}

function slotToHour(timeStr) {
  if (!timeStr) return null;
  const iso = timeStr.match(/\d{4}-\d{2}-\d{2}\s+(\d{1,2}):(\d{2})/);
  if (iso) return parseInt(iso[1]) + parseInt(iso[2]) / 60;
  const hm = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) return parseInt(hm[1]) + parseInt(hm[2]) / 60;
  const ampm = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    if (/pm/i.test(ampm[3]) && h !== 12) h += 12;
    if (/am/i.test(ampm[3]) && h === 12) h = 0;
    return h + parseInt(ampm[2]) / 60;
  }
  return null;
}

function buildTimeFlags(slots) {
  let e = 0, p = 0, l = 0;
  for (const s of slots) {
    const h = slotToHour(s.time);
    if (h === null) continue;
    if (h >= 17.0 && h < 18.5) e++;
    if (h >= 18.5 && h < 20.5) p++;
    if (h >= 20.5 && h < 24.0) l++;
  }
  const ws = c => c <= 1 ? 'booked' : c <= 3 ? 'limited' : 'available';
  return { early: ws(e), prime: ws(p), late: ws(l) };
}

let _browser = null;

async function checkPuppeteer(slug, date, partySize) {
  if (!_browser || !_browser.isConnected()) {
    _browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  }
  let page;
  try {
    page = await _browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });
    await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });

    let apiSlots = null;
    page.on('response', async (resp) => {
      if (resp.url().includes('/4/find') && resp.request().method() === 'POST') {
        try {
          const data = await resp.json();
          apiSlots = (data?.results?.venues?.[0]?.slots || []).map(s => ({ time: s.date?.start || s.date?.end || '', type: s.config?.type || 'dining_room' }));
        } catch {}
      }
    });

    await page.goto(`https://resy.com/cities/ny/${slug}?date=${date}&seats=${partySize}`, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(4000);

    if (apiSlots && apiSlots.length > 0) return apiSlots;

    const scraped = await page.evaluate(() => {
      return [...document.querySelectorAll('button, [role=button]')]
        .map(b => b.textContent?.trim())
        .filter(t => t && /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(t));
    });
    if (scraped.length > 0) return scraped.map(t => ({ time: t, type: 'dining_room' }));

    const isBooked = await page.evaluate(() =>
      document.body?.innerText?.includes('Notify Me') || document.body?.innerText?.includes('no availability')
    );
    if (isBooked) return [];
    return null;
  } catch { return null; }
  finally { if (page) await page.close().catch(() => {}); }
}

async function main() {
  // ── Phase 1: Remaining unchecked ──
  const resyMap = new Map();
  for (const [name, info] of Object.entries(BOOKING_LOOKUP)) {
    if (info.platform !== 'resy' || !info.url) continue;
    const slug = extractResySlug(info.url);
    if (!slug || resyMap.has(slug)) continue;
    resyMap.set(slug, { name, url: info.url, slug });
  }

  let toCheck;
  if (CHECK_ALL) {
    toCheck = Array.from(resyMap.values());
  } else {
    toCheck = Array.from(resyMap.values()).filter(r => {
      const key = r.name.toLowerCase().trim();
      const e = output[key];
      return !e || e._checked_date !== TODAY;
    });
  }

  // Split mode
  if (SPLIT_TOTAL > 1) {
    const chunkSize = Math.ceil(toCheck.length / SPLIT_TOTAL);
    const start = (SPLIT_HALF - 1) * chunkSize;
    toCheck = toCheck.slice(start, start + chunkSize);
  }

  console.log(`\n🟣 RESY ${CHECK_ALL ? 'FULL RECHECK' : 'REMAINING'} + PHASE 2 (Puppeteer only)`);
  console.log(`📊 To check: ${toCheck.length}${SPLIT_TOTAL > 1 ? ` (half ${SPLIT_HALF}/${SPLIT_TOTAL})` : ''}  |  Date: ${CHECK_DATE}\n`);

  let success = 0, fail = 0;

  for (let i = 0; i < toCheck.length; i++) {
    if (i > 0 && i % 25 === 0) {
      if (_browser) { await _browser.close().catch(() => {}); _browser = null; }
      console.log(`\n  🔄 Browser restart\n`);
      await sleep(3000);
    }

    const r = toCheck[i];
    const key = r.name.toLowerCase().trim();
    process.stdout.write(`  [${i+1}/${toCheck.length}] ${r.name.substring(0, 38).padEnd(38)} `);

    const slots = await checkPuppeteer(r.slug, CHECK_DATE, PARTY_SIZE);

    if (slots !== null) {
      const dinnerSlots = slots.filter(s => { const h = slotToHour(s.time); return h !== null && h >= 17 && h < 23; }).length;
      const primeSlots = slots.filter(s => { const h = slotToHour(s.time); return h !== null && h >= 18.5 && h < 20.5; }).length;
      let tier;
      if (slots.length === 0) tier = 'booked';
      else if (primeSlots === 0 && dinnerSlots <= 1) tier = 'limited';
      else if (primeSlots <= 1 && dinnerSlots <= 3) tier = 'limited';
      else tier = 'open';

      const windows = tier === 'booked' ? { early: 'booked', prime: 'booked', late: 'booked' } : buildTimeFlags(slots);
      output[key] = { tier, dinner_slots: dinnerSlots, early: windows.early, prime: windows.prime, late: windows.late, _checked_date: TODAY };

      const icon = tier === 'booked' ? '⚫' : tier === 'limited' ? '🟠' : '🟢';
      console.log(`${icon} ${tier} [${windows.early}/${windows.prime}/${windows.late}] (${dinnerSlots} slots)`);
      success++;
    } else {
      console.log('❌ failed');
      fail++;
    }

    if ((i + 1) % 25 === 0) fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    await sleep(3000 + Math.floor(Math.random() * 2000));
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n✅ Phase 1 done: ${success} success, ${fail} failed`);

  // ── Phase 2: Future availability for booked ──
  const bookedList = [];
  for (const [k, v] of Object.entries(output)) {
    if (k.startsWith('_')) continue;
    if (v._checked_date !== TODAY || v.tier !== 'booked') continue;
    if (v.opens_in || v.fully_locked) continue;
    const info = BOOKING_LOOKUP[k];
    if (!info || info.platform !== 'resy') continue;
    const slug = extractResySlug(info.url);
    if (slug) bookedList.push({ name: k, slug });
  }

  if (bookedList.length === 0) {
    console.log('\n🔮 Phase 2: No booked restaurants to check');
  } else {
    const OFFSETS = [3, 7, 14];
    console.log(`\n🔮 Phase 2: Checking future availability for ${bookedList.length} booked restaurants\n`);

    let hasFuture = 0, locked = 0;

    for (let i = 0; i < bookedList.length; i++) {
      if (i > 0 && i % 25 === 0) {
        if (_browser) { await _browser.close().catch(() => {}); _browser = null; }
        await sleep(3000);
      }

      const r = bookedList[i];
      let opensIn = null;

      for (const offset of OFFSETS) {
        if (opensIn) break;
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + offset);
        const date = futureDate.toISOString().split('T')[0];

        const slots = await checkPuppeteer(r.slug, date, PARTY_SIZE);
        if (slots !== null && slots.length > 0) {
          const dinnerSlots = slots.filter(s => { const h = slotToHour(s.time); return h !== null && h >= 17; }).length;
          if (dinnerSlots > 0) opensIn = offset;
        }
        await sleep(3000 + Math.floor(Math.random() * 2000));
      }

      if (opensIn) {
        output[r.name].opens_in = opensIn;
        hasFuture++;
        console.log(`  🟢 [${i+1}/${bookedList.length}] ${r.name}: opens in +${opensIn}d`);
      } else {
        output[r.name].fully_locked = true;
        locked++;
        console.log(`  🔒 [${i+1}/${bookedList.length}] ${r.name}: locked`);
      }

      if ((i + 1) % 10 === 0) fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`\n✅ Phase 2 done: ${hasFuture} have future, ${locked} locked`);
  }

  if (_browser) await _browser.close().catch(() => {});
  console.log('\n💾 Saved → ' + OUTPUT_FILE);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
