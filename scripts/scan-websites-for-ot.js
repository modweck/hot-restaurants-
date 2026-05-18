/**
 * scan-websites-for-ot.js
 *
 * Scans restaurant websites for OpenTable booking links.
 * ONLY checks restaurants on "website" or "google_reserve" platform.
 *
 * RUN:   node scripts/scan-websites-for-ot.js
 * OPTIONS:
 *   --quick     Only check first 20
 *   --batch N   Check N then stop
 *   --resume    Skip already checked
 *
 * OUTPUT: data/ot_links_from_websites.json
 */

const fs = require('fs');
const path = require('path');

const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'ot_links_from_websites.json');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const RESUME = args.includes('--resume');
const BATCH = parseInt(args[args.indexOf('--batch') + 1] || '0', 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));

const master = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));

// ONLY website + google_reserve — skip resy, tock, opentable, sevenrooms
const toCheck = [];
for (const [name, info] of Object.entries(master)) {
  const p = (info.platform || '').toLowerCase();
  if (p !== 'website' && p !== 'google_reserve') continue;
  const url = info.website || info.url;
  if (!url || url.includes('google.com/maps') || url.includes('google.com/url')) continue;
  toCheck.push({ name, website: url });
}

console.log(`🔍 ${toCheck.length} website/google_reserve restaurants to scan for OT links\n`);

let existing = {};
try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}

async function checkWebsite(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return { found: false, error: `HTTP ${resp.status}` };

    const html = await resp.text();
    if (!html.toLowerCase().includes('opentable')) return { found: false };

    const otUrlMatch = html.match(/https?:\/\/(?:www\.)?opentable\.com\/r(?:estaurant)?\/([a-z0-9-]+)/i);
    const ridMatch = html.match(/(?:rid|restaurant_id|restaurantId)[=:]["']?(\d{3,})/i);
    const widgetMatch = html.toLowerCase().includes('widget.opentable.com') || html.toLowerCase().includes('ot-widget');

    let otUrl = null, rid = null, slug = null;
    if (otUrlMatch) { otUrl = otUrlMatch[0]; slug = otUrlMatch[1]; }
    if (ridMatch) { rid = parseInt(ridMatch[1]); }
    if (slug && !rid) { otUrl = `https://www.opentable.com/r/${slug}`; }

    return { found: true, ot_url: otUrl, slug, rid, has_widget: widgetMatch };
  } catch (e) {
    return { found: false, error: e.message?.slice(0, 50) };
  }
}

async function main() {
  let list = [...toCheck];
  if (RESUME) {
    list = list.filter(r => !existing[r.name]);
    console.log(`⏭️  Resuming: ${list.length} remaining`);
  }
  if (QUICK) list = list.slice(0, 20);
  if (BATCH > 0) list = list.slice(0, BATCH);

  console.log(`🔍 Checking ${list.length} websites...\n`);

  const results = { ...existing };
  let checked = 0, found = 0, notFound = 0, errors = 0;

  for (const { name, website } of list) {
    const result = await checkWebsite(website);
    checked++;

    if (result.found) {
      results[name] = { website, ot_url: result.ot_url, slug: result.slug, rid: result.rid, has_widget: result.has_widget };
      found++;
      const detail = result.ot_url || (result.has_widget ? 'widget' : 'mention');
      console.log(`  🟢 [${checked}/${list.length}] ${name} → ${detail}`);
    } else if (result.error) {
      errors++;
    } else {
      notFound++;
    }

    if (checked % 100 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
      console.log(`  💾 Progress: ${found} found / ${checked} checked / ${errors} errors`);
    }
    await sleep(500);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Done! Checked ${checked} websites`);
  console.log(`   🟢 Found OT link: ${found}`);
  console.log(`   ❌ No OT: ${notFound}`);
  console.log(`   ⚠️  Errors: ${errors}`);
  console.log(`   Output: ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
