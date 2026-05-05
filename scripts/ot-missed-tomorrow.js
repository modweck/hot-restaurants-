/**
 * ot-missed-tomorrow.js — Check all missed/blocked OT restaurants for TOMORROW.
 * VPN rotates on every single block. Output to separate file.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { execSync } = require('child_process');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const ld = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const tomorrow = new Date(ld); tomorrow.setDate(ld.getDate() + 1);
const TOMORROW = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth()+1)}-${pad(tomorrow.getDate())}`;
const PARTY_SIZE = 2;

const FUNCS = path.join(__dirname, '..', 'netlify', 'functions');
const BM = JSON.parse(fs.readFileSync(path.join(FUNCS, 'BOOKING_MASTER.json'), 'utf8'));
const OUTPUT = path.join(FUNCS, 'ot-missed-tomorrow-results.json');

// ── Gather all missed restaurants ──
const r1 = JSON.parse(fs.readFileSync(path.join(FUNCS, 'ot-recheck-booked-results.json'), 'utf8'));
const r2 = JSON.parse(fs.readFileSync(path.join(FUNCS, 'tonight_availability_ot_recheck.json'), 'utf8'));

const missed = new Set();
for (const [k, v] of Object.entries(r1)) { if (v.lock_reason === 'blocked' || v.recheck_blocked) missed.add(k); }
for (const [k, v] of Object.entries(r2)) { if (v.tier === 'error') missed.add(k); }

const toCheck = [];
for (const name of missed) {
  const bmEntry = BM[name] || BM[Object.keys(BM).find(k => k.toLowerCase() === name.toLowerCase())];
  if (!bmEntry?.url) continue;
  const url = bmEntry.url;
  const rMatch = url.match(/opentable\.com\/r\/([^?/]+)/);
  const plainMatch = url.match(/opentable\.com\/([^?/]+)$/);
  const slug = rMatch ? rMatch[1] : (plainMatch ? plainMatch[1] : null);
  if (slug) toCheck.push({ name, slug });
}

console.log(`🔍 ${toCheck.length} missed restaurants to check for TOMORROW (${TOMORROW})`);
console.log(`   VPN rotates on every block\n`);

// ── VPN ──
async function rotateVPN() {
  const regions = ['us', 'us', 'us', 'ca', 'uk'];
  const region = regions[Math.floor(Math.random() * regions.length)];
  try {
    execSync('open -g "nordvpn://disconnect"', { timeout: 5000 });
    await sleep(2000);
    execSync(`open -g "nordvpn://connect/${region}"`, { timeout: 5000 });
    for (let i = 0; i < 10; i++) {
      await sleep(3000);
      try {
        const ip = execSync('curl -s --max-time 4 https://api.ipify.org', { timeout: 8000 }).toString().trim();
        if (ip && ip.length > 6) { console.log(`  🔄 VPN → ${region} (${ip})`); return true; }
      } catch {}
    }
  } catch {}
  return false;
}

// ── Puppeteer ──
const VPS = [{ width: 1280, height: 800 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }];
async function launchBrowser() { return puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] }); }
async function newPage(browser) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setViewport(VPS[Math.floor(Math.random() * VPS.length)]);
  return page;
}

async function checkSlug(page, slug, date) {
  await page.goto(`https://www.opentable.com/r/${slug}?dateTime=${date}T19%3A30%3A00&covers=${PARTY_SIZE}&lang=en-US`, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(1200);
  return page.evaluate(() => {
    const text = document.body?.innerText || '';
    if (text.includes('Access Denied') || text.length < 300) return { blocked: true };
    const noAvail = text.includes('no online availability') || text.includes('No tables') || text.includes('fully booked');
    const notify = text.includes('Notify me') || text.includes('Get notified');
    let slots = Array.from(document.querySelectorAll('li[data-test^="time-slot"], button[data-test^="time-slot"], [data-test="timeslot"]'))
      .map(s => { const m = s.textContent.trim().match(/(\d{1,2}:\d{2}\s*[AP]M)/i); return m ? m[1] : null; }).filter(Boolean);
    if (!slots.length) {
      slots = Array.from(document.querySelectorAll('.timeslot, .time-slot, [class*="TimeSlot"], [class*="timeslot"]'))
        .map(s => { const m = s.textContent.trim().match(/(\d{1,2}:\d{2}\s*[AP]M)/i); return m ? m[1] : null; }).filter(Boolean);
    }
    if (!slots.length) {
      const w = document.querySelector('#availability, [data-test="availability"], [class*="Availability"], [class*="reservation"]');
      if (w) slots = [...new Set(w.innerText.match(/\d{1,2}:\d{2}\s*[AP]M/gi) || [])];
    }
    return { blocked: false, noAvail, notify, slots: [...new Set(slots)] };
  });
}

function parseTimes(slots) {
  let early = 0, prime = 0, late = 0; const parsed = [];
  for (const t of slots) {
    const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i); if (!m) continue;
    let h = parseInt(m[1]); if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12; if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
    const hr = h + parseInt(m[2]) / 60; if (hr < 17 || hr >= 24) continue;
    parsed.push(t.trim()); if (hr < 18.5) early++; else if (hr < 20.5) prime++; else late++;
  }
  return { parsed, early, prime, late, total: parsed.length };
}

async function main() {
  let browser = await launchBrowser();
  let page = await newPage(browser);
  let sess = 0;
  const results = {};
  let checked = 0, blocked = 0;
  const counts = { open: 0, limited: 0, booked: 0 };

  for (const r of toCheck) {
    if (sess >= 60) {
      await browser.close(); await sleep(2000);
      browser = await launchBrowser(); page = await newPage(browser); sess = 0;
    }

    let data = null;
    try {
      data = await checkSlug(page, r.slug, TOMORROW);
      if (data.blocked) {
        // Rotate immediately on every block
        console.log(`  🚫 Blocked — rotating VPN...`);
        await browser.close(); await rotateVPN();
        browser = await launchBrowser(); page = await newPage(browser); sess = 0;
        // Retry once
        data = await checkSlug(page, r.slug, TOMORROW);
        if (data.blocked) {
          // One more rotation
          console.log(`  🚫 Still blocked — rotating again...`);
          await browser.close(); await rotateVPN();
          browser = await launchBrowser(); page = await newPage(browser); sess = 0;
          data = await checkSlug(page, r.slug, TOMORROW);
        }
      }
    } catch {
      try { await browser.close(); } catch {}
      await sleep(2000);
      browser = await launchBrowser(); page = await newPage(browser); sess = 0;
    }

    checked++; sess++;

    if (!data || data.blocked) {
      blocked++;
      results[r.name] = { tier: 'error', error: 'blocked', checked_date: new Date().toISOString() };
      console.log(`  🚫 [${checked}/${toCheck.length}] ${r.name}: blocked`);
    } else {
      const times = parseTimes(data.slots);
      const tier = times.total === 0 ? 'booked' : times.total <= 3 ? 'limited' : 'open';
      const eS = tier === 'open' ? 'available' : times.early > 0 ? 'limited' : 'booked';
      const pS = tier === 'open' ? 'available' : times.prime > 0 ? 'limited' : 'booked';
      const lS = tier === 'open' ? 'available' : times.late > 0 ? 'limited' : 'booked';

      results[r.name] = {
        tier, dinner_slots: times.total, early: eS, prime: pS, late: lS,
        has_early: eS !== 'booked', has_prime: pS !== 'booked', has_late: lS !== 'booked',
        sample_times: times.parsed.slice(0, 5), platform: 'opentable',
        checked_date: new Date().toISOString(), check_for_date: TOMORROW, source: 'direct_slug'
      };
      counts[tier]++;
      const icon = tier === 'open' ? '🟢' : tier === 'limited' ? '🟡' : '🔴';
      const slots = times.parsed.length > 0 ? ` → ${times.parsed.slice(0, 4).join(', ')}` : '';
      console.log(`  ${icon} [${checked}/${toCheck.length}] ${r.name}: ${tier} (${times.total})${slots}`);
    }

    if (checked % 15 === 0) fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
    await sleep(1000 + Math.floor(Math.random() * 1500));
  }

  await browser.close();
  fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));

  console.log(`\n${'═'.repeat(40)}`);
  console.log(`✅ Done! ${checked} restaurants for ${TOMORROW}`);
  console.log(`   🟢 ${counts.open}  🟡 ${counts.limited}  🔴 ${counts.booked}  🚫 ${blocked} blocked`);
  console.log(`   → ${OUTPUT}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
