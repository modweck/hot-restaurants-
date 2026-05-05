/**
 * ot-recheck-booked.js — Fast recheck of ONLY booked OT restaurants.
 *
 * Reads from booked-limited recheck file, only processes tier=booked.
 * Slug-first, minimal delays, VPN rotation only after 3+ consecutive blocks.
 *
 * RUN:   node scripts/ot-recheck-booked.js
 * OPTIONS:
 *   --quick         First 10 only
 *   --no-future     Skip future availability
 *   --party 2       Party size (default 2)
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { execSync } = require('child_process');

// ── VPN rotation with connectivity check ──
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

// ── Args ──
const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i+1] ? args[i+1] : d; };
const QUICK = args.includes('--quick');
const NO_FUTURE = args.includes('--no-future');
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);

// Local date
const now = new Date();
const ld = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const pad = n => String(n).padStart(2, '0');
const TODAY = `${ld.getFullYear()}-${pad(ld.getMonth()+1)}-${pad(ld.getDate())}`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Load data ──
const FUNCS = path.join(__dirname, '..', 'netlify', 'functions');
const BM = JSON.parse(fs.readFileSync(path.join(FUNCS, 'BOOKING_MASTER.json'), 'utf8'));
const RECHECK = JSON.parse(fs.readFileSync(path.join(FUNCS, 'ot-recheck-limited-booked-april7.json'), 'utf8'));
const OUTPUT = path.join(FUNCS, 'ot-recheck-booked-results.json');

// Only booked restaurants
const toCheck = [];
for (const [name, info] of Object.entries(RECHECK)) {
  if (info.tier !== 'booked') continue;
  const bmEntry = BM[name] || BM[Object.keys(BM).find(k => k.toLowerCase() === name.toLowerCase())];
  const url = bmEntry?.url || '';
  const slugMatch = url.match(/opentable\.com\/r\/([^?/]+)/);
  toCheck.push({ name, slug: slugMatch ? slugMatch[1] : null, url });
}

console.log(`🔍 ${toCheck.length} booked restaurants to recheck`);
console.log(`   Date: ${TODAY}, Party: ${PARTY_SIZE}\n`);

// ── Puppeteer ──
const VIEWPORTS = [
  { width: 1280, height: 800 }, { width: 1366, height: 768 },
  { width: 1440, height: 900 }, { width: 1536, height: 864 },
];

async function launchBrowser() {
  return puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
}

async function newPage(browser) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setViewport(VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)]);
  return page;
}

// ── Check direct /r/ page ──
async function checkSlug(page, slug, date) {
  const url = `https://www.opentable.com/r/${slug}?dateTime=${date}T19%3A30%3A00&covers=${PARTY_SIZE}&lang=en-US`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(1200);

  return page.evaluate(() => {
    const text = document.body?.innerText || '';
    if (text.includes('Access Denied') || text.length < 300) return { blocked: true };

    const noAvail = text.includes('no online availability') || text.includes('No tables') || text.includes('fully booked');
    const notify = text.includes('Notify me') || text.includes('Get notified');
    const waitlist = text.includes('Join waitlist');

    // Proper selectors
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

    return { blocked: false, noAvail, notify, waitlist, slots: [...new Set(slots)] };
  });
}

function parseTimes(slots) {
  let early = 0, prime = 0, late = 0;
  const parsed = [];
  for (const t of slots) {
    const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) continue;
    let h = parseInt(m[1]); const min = parseInt(m[2]);
    if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
    const hr = h + min / 60;
    if (hr < 17 || hr >= 24) continue;
    parsed.push(t.trim());
    if (hr < 18.5) early++; else if (hr < 20.5) prime++; else late++;
  }
  return { parsed, early, prime, late, total: parsed.length };
}

// ── Main ──
async function main() {
  let list = QUICK ? toCheck.slice(0, 10) : toCheck;
  let browser = await launchBrowser();
  let page = await newPage(browser);
  let sessCount = 0, consecutiveBlocks = 0;
  const results = {};
  let checked = 0, flipped = 0, blocked = 0;
  const counts = { open: 0, limited: 0, booked: 0 };

  for (const r of list) {
    // Restart browser every 60
    if (sessCount >= 60) {
      await browser.close(); await sleep(2000);
      browser = await launchBrowser(); page = await newPage(browser); sessCount = 0;
    }

    let result = null;

    try {
      if (r.slug) {
        const data = await checkSlug(page, r.slug, TODAY);
        if (data.blocked) {
          consecutiveBlocks++;
          // Only rotate after 3 consecutive blocks
          if (consecutiveBlocks >= 3) {
            console.log(`  ⚠️  ${consecutiveBlocks} blocks — rotating VPN...`);
            await browser.close(); await rotateVPN();
            browser = await launchBrowser(); page = await newPage(browser); sessCount = 0;
            consecutiveBlocks = 0;
            // Retry once
            const retry = await checkSlug(page, r.slug, TODAY);
            if (!retry.blocked) {
              result = retry;
            }
          }
        } else {
          consecutiveBlocks = 0;
          result = data;
        }
      }
    } catch (e) {
      // timeout or crash — restart browser, don't count as block
      try { await browser.close(); } catch {}
      await sleep(2000);
      browser = await launchBrowser(); page = await newPage(browser); sessCount = 0;
    }

    checked++; sessCount++;

    if (!result) {
      blocked++;
      results[r.name] = { ...RECHECK[r.name], recheck_blocked: true };
      console.log(`  🚫 [${checked}/${list.length}] ${r.name}: blocked`);
    } else {
      const times = parseTimes(result.slots);
      const tier = times.total === 0 ? (result.noAvail || result.notify || result.waitlist ? 'booked' : 'booked') : (times.total <= 3 ? 'limited' : 'open');
      const eS = tier === 'open' ? 'available' : times.early > 0 ? 'limited' : 'booked';
      const pS = tier === 'open' ? 'available' : times.prime > 0 ? 'limited' : 'booked';
      const lS = tier === 'open' ? 'available' : times.late > 0 ? 'limited' : 'booked';

      results[r.name] = {
        tier, dinner_slots: times.total, early: eS, prime: pS, late: lS,
        has_early: eS !== 'booked', has_prime: pS !== 'booked', has_late: lS !== 'booked',
        sample_times: times.parsed.slice(0, 5), platform: 'opentable',
        checked_date: new Date().toISOString(), source: 'direct_slug'
      };

      counts[tier] = (counts[tier] || 0) + 1;
      if (tier !== 'booked') flipped++;

      const icon = tier === 'open' ? '🟢' : tier === 'limited' ? '🟡' : '🔴';
      const slots = times.parsed.length > 0 ? ` → ${times.parsed.slice(0, 4).join(', ')}` : '';
      console.log(`  ${icon} [${checked}/${list.length}] ${r.name}: ${tier} (${times.total})${slots}`);
    }

    // Save every 15
    if (checked % 15 === 0) fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));

    // Short delay — 1-2s instead of 2-5s
    await sleep(1000 + Math.floor(Math.random() * 1500));
  }

  // ── Future availability for still-booked ──
  if (!NO_FUTURE) {
    const stillBooked = Object.entries(results).filter(([, v]) => v.tier === 'booked' && !v.recheck_blocked);
    if (stillBooked.length > 0) {
      console.log(`\n${'─'.repeat(40)}`);
      console.log(`🔮 Future check: ${stillBooked.length} still booked\n`);

      const OFFSETS = [3, 7, 14];
      let hasFuture = 0, locked = 0, futureBlocked = 0;

      for (let i = 0; i < stillBooked.length; i++) {
        if (sessCount >= 60) {
          await browser.close(); await sleep(2000);
          browser = await launchBrowser(); page = await newPage(browser); sessCount = 0;
        }

        const [name, info] = stillBooked[i];
        const r = toCheck.find(t => t.name === name);
        if (!r?.slug) { locked++; results[name].fully_locked = true; results[name].lock_reason = 'no_slug'; continue; }

        let opensIn = null, wasBlocked = false;

        for (const offset of OFFSETS) {
          if (opensIn) break;
          const d = new Date(ld); d.setDate(d.getDate() + offset);
          const date = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
          try {
            const data = await checkSlug(page, r.slug, date);
            sessCount++;
            if (data.blocked) {
              wasBlocked = true;
              // Don't rotate on every future block — just skip
              break;
            }
            const times = parseTimes(data.slots);
            if (times.total >= 2) { opensIn = offset; break; }
          } catch {
            try { await browser.close(); } catch {}
            await sleep(2000);
            browser = await launchBrowser(); page = await newPage(browser); sessCount = 0;
          }
          await sleep(1000 + Math.floor(Math.random() * 1500));
        }

        if (opensIn) {
          results[name].opens_in = opensIn;
          hasFuture++;
          console.log(`  🟢 [${i+1}/${stillBooked.length}] ${name}: +${opensIn}d`);
        } else if (wasBlocked) {
          results[name].fully_locked = true;
          results[name].lock_reason = 'blocked';
          futureBlocked++;
          console.log(`  ⏭️  [${i+1}/${stillBooked.length}] ${name}: blocked`);
        } else {
          results[name].fully_locked = true;
          results[name].lock_reason = 'confirmed';
          locked++;
          console.log(`  🔒 [${i+1}/${stillBooked.length}] ${name}: locked`);
        }

        if ((i+1) % 15 === 0) fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
        await sleep(1000 + Math.floor(Math.random() * 1500));
      }

      console.log(`\n  🟢 Future: ${hasFuture}  🔒 Locked: ${locked}  ⏭️ Blocked: ${futureBlocked}`);
    }
  }

  await browser.close();
  fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));

  console.log(`\n${'═'.repeat(40)}`);
  console.log(`✅ Done! ${checked} restaurants`);
  console.log(`   🟢 ${counts.open}  🟡 ${counts.limited}  🔴 ${counts.booked}  🚫 ${blocked} blocked`);
  console.log(`   🔄 ${flipped} flipped from booked`);
  console.log(`   → ${OUTPUT}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
