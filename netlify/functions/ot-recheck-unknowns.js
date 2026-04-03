/**
 * ot-recheck-unknowns.js — Quick recheck of OT unknowns using new /r/ URLs
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const MASTER_FILE = path.join(__dirname, 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, 'tonight_availability_ot.json');
const TODAY = new Date().toISOString().split('T')[0];
const PARTY_SIZE = 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const master = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
const ot = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));

// Get unknowns with /r/ slugs
const unknowns = [];
for (const [k, v] of Object.entries(ot)) {
  if (v.tier !== 'unknown') continue;
  const mk = Object.keys(master).find(m => m.toLowerCase() === k);
  if (!mk || master[mk].platform !== 'opentable') continue;
  const slug = master[mk].url?.match(/opentable\.com\/r\/([^?]+)/)?.[1];
  if (slug) unknowns.push({ name: k, slug });
}

console.log(`🔄 Rechecking ${unknowns.length} OT unknowns with direct URLs\n`);

(async () => {
  let browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });

  let fixed = 0, stillUnknown = 0;

  for (let i = 0; i < unknowns.length; i++) {
    if (i > 0 && i % 25 === 0) {
      await browser.close(); await sleep(3000);
      browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
    }

    const r = unknowns[i];
    let page;
    try {
      page = await browser.newPage();
      await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); window.chrome = { runtime: {} }; });
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1366, height: 768 });

      const url = `https://www.opentable.com/r/${r.slug}?dateTime=${TODAY}T19%3A30%3A00&covers=${PARTY_SIZE}&lang=en-US`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
      await sleep(2000);

      const result = await page.evaluate(() => {
        const body = document.body?.innerText || '';
        if (body.length < 200) return { error: 'blocked' };
        if (body.includes('page not found')) return { error: '404' };
        if (body.includes('not on the OpenTable reservation network')) return { notOnOT: true };
        const times = [...new Set((body.match(/\d{1,2}:\d{2}\s*[AP]M/gi) || []))].filter(t => {
          const m = t.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
          if (!m) return false;
          let h = parseInt(m[1]);
          if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
          if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
          return h >= 17 && h < 24;
        });
        const noAvail = body.includes('no online availability') || body.includes('No tables') || body.includes('fully booked') || body.includes('Notify me');
        const h1 = document.querySelector('h1')?.textContent?.trim() || '';
        return { slots: times, noAvail, pageName: h1, bodyLen: body.length };
      });

      if (result.error || result.notOnOT) {
        stillUnknown++;
        console.log(`  ❓ [${i+1}/${unknowns.length}] ${r.name}: ${result.error || 'not_on_ot'}`);
      } else {
        const total = result.slots?.length || 0;
        let early = 0, prime = 0, late = 0;
        for (const t of (result.slots || [])) {
          const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i); if (!m) continue;
          let h = parseInt(m[1]); if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
          const hour = h + parseInt(m[2]) / 60;
          if (hour >= 17 && hour < 18.5) early++;
          else if (hour >= 18.5 && hour < 20.5) prime++;
          else if (hour >= 20.5) late++;
        }
        const tier = total === 0 ? 'booked' : total <= 3 ? 'limited' : 'open';
        let eS, pS, lS;
        if (tier === 'open') { eS = 'available'; pS = 'available'; lS = 'available'; }
        else if (tier === 'limited') { eS = early > 0 ? 'limited' : 'booked'; pS = prime > 0 ? 'limited' : 'booked'; lS = late > 0 ? 'limited' : 'booked'; }
        else { eS = 'booked'; pS = 'booked'; lS = 'booked'; }

        ot[r.name] = { tier, dinner_slots: total, early: eS, prime: pS, late: lS, has_early: eS !== 'booked', has_prime: pS !== 'booked', has_late: lS !== 'booked', sample_times: (result.slots || []).slice(0, 5), platform: 'opentable', checked_date: new Date().toISOString(), matched_name: result.pageName };
        fixed++;
        const icon = tier === 'open' ? '🟢' : tier === 'limited' ? '🟡' : '🔴';
        console.log(`  ${icon} [${i+1}/${unknowns.length}] ${r.name}: ${tier} (${total} slots)`);
      }
    } catch (e) {
      stillUnknown++;
      console.log(`  ❌ [${i+1}/${unknowns.length}] ${r.name}: error`);
    } finally { if (page) await page.close().catch(() => {}); }

    await sleep(5000 + Math.floor(Math.random() * 3000));
  }

  await browser.close();
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(ot, null, 2));
  console.log(`\n✅ Done: ${fixed} fixed, ${stillUnknown} still unknown`);
})();
