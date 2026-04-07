/**
 * resy-tonight-puppeteer-only.js
 *
 * Puppeteer-only Resy availability checker. No direct API calls.
 * Use when Imperva is blocking the Resy API.
 *
 * RUN:   node resy-tonight-puppeteer-only.js
 * OPTIONS:
 *   --quick        First 50 only
 *   --all          Re-check even ones already checked today
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
const QUICK_MODE = args.includes('--quick');
const CHECK_ALL  = args.includes('--all');

function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);
const TODAY      = new Date().toISOString().split('T')[0];
const CHECK_DATE = getArg('date', TODAY);

const MASTER_FILE   = path.join(__dirname, 'BOOKING_MASTER.json');
const BOOKING_FILE  = path.join(__dirname, 'booking_lookup.json');
const OUTPUT_FILE   = path.join(__dirname, 'tonight_availability.json');

// ── Auto-sync booking_lookup from BOOKING_MASTER ─────────────────────────────
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
} catch (e) { console.log('⚠️ booking_lookup sync skipped:', e.message); }

let BOOKING_LOOKUP = {};
try { BOOKING_LOOKUP = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8')); }
catch (e) { console.error('❌ Cannot load booking_lookup.json'); process.exit(1); }

let EXISTING = {};
try { EXISTING = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch (e) {}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
    const min = parseInt(ampm[2]);
    const pm = /pm/i.test(ampm[3]);
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    return h + min / 60;
  }
  return null;
}

function buildTimeFlags(slots) {
  let early_count = 0, prime_count = 0, late_count = 0;
  for (const slot of (slots || [])) {
    const hour = slotToHour(slot.time);
    if (hour === null) continue;
    if (hour >= 17.0 && hour < 18.5) early_count++;
    if (hour >= 18.5 && hour < 20.5) prime_count++;
    if (hour >= 20.5 && hour < 24.0) late_count++;
  }
  function windowStatus(count) {
    if (count <= 1) return 'booked';
    if (count <= 3) return 'limited';
    return 'available';
  }
  return { early: windowStatus(early_count), prime: windowStatus(prime_count), late: windowStatus(late_count) };
}

function toAvailTier(internalTier, totalSlots) {
  if (totalSlots === 0 || internalTier === 'sold_out') return 'booked';
  if (internalTier === 'nearly_full' || internalTier === 'limited') return 'limited';
  return 'open';
}

// ── Puppeteer check ──
let _browser = null;

async function checkOne(slug, date, partySize) {
  if (!_browser || !_browser.isConnected()) {
    _browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
    });
  }

  let page;
  try {
    page = await _browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    let apiSlots = null;
    page.on('response', async (resp) => {
      if (resp.url().includes('/4/find') && resp.request().method() === 'POST') {
        try {
          const data = await resp.json();
          const slots = data?.results?.venues?.[0]?.slots || [];
          apiSlots = slots.map(s => ({ time: s.date?.start || s.date?.end || '', type: s.config?.type || 'dining_room' }));
        } catch (e) {}
      }
    });

    await page.goto(`https://resy.com/cities/ny/${slug}?date=${date}&seats=${partySize}`, {
      waitUntil: 'networkidle2', timeout: 20000
    });
    await sleep(4000);

    if (apiSlots && apiSlots.length > 0) return apiSlots;

    const scraped = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button, [role=button]')];
      return btns
        .map(b => b.textContent?.trim())
        .filter(t => t && /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(t));
    });
    if (scraped.length > 0) return scraped.map(t => ({ time: t, type: 'dining_room' }));

    const isBooked = await page.evaluate(() =>
      document.body?.innerText?.includes('Notify Me') || document.body?.innerText?.includes('no availability')
    );
    if (isBooked) return [];

    return null;
  } catch (e) {
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ── Main ──
async function main() {
  console.log('\n🟣 RESY PUPPETEER-ONLY CHECKER');
  console.log(`📅 Date: ${CHECK_DATE}  👥 Party: ${PARTY_SIZE}`);
  console.log('─────────────────────────────────────\n');

  const resyMap = new Map();
  for (const [name, info] of Object.entries(BOOKING_LOOKUP)) {
    if (info.platform !== 'resy' || !info.url) continue;
    const slug = extractResySlug(info.url);
    if (!slug || resyMap.has(slug)) continue;
    resyMap.set(slug, { name, url: info.url, slug });
  }

  let list = Array.from(resyMap.values());
  console.log(`📊 Total unique Resy restaurants: ${list.length}`);

  if (!CHECK_ALL) {
    const alreadyDone = new Set(
      Object.entries(EXISTING)
        .filter(([k, v]) => !k.startsWith('_') && v._checked_date === TODAY)
        .map(([k]) => k)
    );
    const before = list.length;
    list = list.filter(r => !alreadyDone.has(r.name.toLowerCase().trim()));
    console.log(`⏭️  Skipping ${before - list.length} already checked today`);
  }

  if (QUICK_MODE) {
    list = list.slice(0, 50);
    console.log(`⚡ Quick mode: first 50 only`);
  }

  console.log(`🎯 Checking: ${list.length} restaurants\n`);

  const output = { ...EXISTING };
  let success = 0, fail = 0;
  let browserRestarts = 0;

  for (let i = 0; i < list.length; i++) {
    const r = list[i];

    // Restart browser every 25
    if (i > 0 && i % 25 === 0) {
      if (_browser) { await _browser.close().catch(() => {}); _browser = null; }
      browserRestarts++;
      console.log(`\n  🔄 Browser restart #${browserRestarts}\n`);
      await sleep(3000);
    }

    process.stdout.write(`  [${i + 1}/${list.length}] ${r.name.substring(0, 38).padEnd(38)} `);

    const slots = await checkOne(r.slug, CHECK_DATE, PARTY_SIZE);
    const key = r.name.toLowerCase().trim();

    if (slots !== null) {
      const dinnerSlots = slots.filter(s => {
        const h = slotToHour(s.time);
        return h !== null && h >= 17 && h < 23;
      }).length;

      const primeSlots = slots.filter(s => {
        const h = slotToHour(s.time);
        return h !== null && h >= 18.5 && h < 20.5;
      }).length;

      let internalTier;
      if (slots.length === 0) internalTier = 'sold_out';
      else if (primeSlots === 0 && dinnerSlots <= 1) internalTier = 'nearly_full';
      else if (primeSlots <= 1 && dinnerSlots <= 3) internalTier = 'limited';
      else if (dinnerSlots <= 6) internalTier = 'moderate';
      else internalTier = 'available';

      const tier = toAvailTier(internalTier, slots.length);
      const windows = tier === 'booked'
        ? { early: 'booked', prime: 'booked', late: 'booked' }
        : buildTimeFlags(slots);

      output[key] = {
        tier, dinner_slots: dinnerSlots,
        early: windows.early, prime: windows.prime, late: windows.late,
        _checked_date: TODAY
      };

      const EMOJI = { booked: '⚫', limited: '🟠', open: '🟢' };
      console.log(`${EMOJI[tier] || '⚪'} ${tier.padEnd(7)} [${windows.early}/${windows.prime}/${windows.late}] (${dinnerSlots} dinner slots)`);
      success++;
    } else {
      console.log(`❌ failed`);
      fail++;
    }

    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
      console.log(`    💾 Progress saved (${i + 1}/${list.length})`);
    }

    await sleep(3000 + Math.floor(Math.random() * 2000)); // 3-5s delay
  }

  // Final save
  output._meta = {
    last_run: TODAY, checked_date: CHECK_DATE,
    party_size: PARTY_SIZE, checked: success, failed: fail
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`\n${'═'.repeat(45)}`);
  console.log('📊 RESULTS');
  console.log(`   ✅ Success: ${success}  ❌ Failed: ${fail}`);
  console.log(`💾 Saved → ${OUTPUT_FILE}`);

  if (_browser) await _browser.close().catch(() => {});
}

main().catch(e => { console.error('❌', e); process.exit(1); });
