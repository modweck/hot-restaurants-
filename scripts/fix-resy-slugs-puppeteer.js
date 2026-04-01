/**
 * fix-resy-slugs-puppeteer.js
 *
 * Fixes wrong Resy slugs for "fully_locked" restaurants.
 * Visits resy.com/cities/ny/{slug} with Puppeteer, checks if page loads,
 * tries slug variations if not, and updates booking_lookup.json.
 *
 * RUN:   node scripts/fix-resy-slugs-puppeteer.js
 * OPTIONS:
 *   --quick       First 10 only
 *   --batch N     Check N then stop
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const LOOKUP_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'booking_lookup.json');
const AVAIL_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'tonight_availability.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'resy_slug_fixes.json');

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

// Generate slug variations from a restaurant name
function generateSlugs(name, currentSlug) {
  const base = name.toLowerCase()
    .replace(/[''`\u2019]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const slugs = new Set();
  // Current slug first (check if it works)
  if (currentSlug) slugs.add(currentSlug.toLowerCase());
  slugs.add(base);

  // With location suffixes
  const locations = ['east-village', 'west-village', 'brooklyn', 'nyc', 'new-york', 'soho', 'tribeca', 'les', 'williamsburg'];

  for (const loc of locations) {
    slugs.add(base + '-' + loc);
  }

  // Without location suffix (if current slug has one)
  for (const loc of locations) {
    if (base.endsWith('-' + loc)) slugs.add(base.replace('-' + loc, ''));
  }

  // Without "the-"
  if (base.startsWith('the-')) {
    const noThe = base.slice(4);
    slugs.add(noThe);
    for (const loc of ['east-village', 'brooklyn', 'nyc', 'ny', 'new-york', 'manhattan']) {
      slugs.add(noThe + '-' + loc);
    }
  }

  // Without common suffixes
  const noSuffix = base
    .replace(/-(restaurant|ristorante|bistro|bar|grill|kitchen|cafe|steakhouse|lounge|tavern|pizzeria|trattoria|osteria|brasserie)$/g, '')
    .replace(/-+$/, '');
  if (noSuffix !== base) {
    slugs.add(noSuffix);
    slugs.add(noSuffix + '-ny');
    slugs.add(noSuffix + '-nyc');
  }

  // Handle "X - Y" patterns
  const dashParts = name.split(/ [-–] /);
  if (dashParts.length > 1) {
    const first = dashParts[0].toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    slugs.add(first);
    slugs.add(first + '-nyc');
    slugs.add(first + '-new-york');
  }

  // With/without 's
  if (base.endsWith('s')) slugs.add(base.slice(0, -1));
  else slugs.add(base + 's');

  return [...slugs].filter(s => s.length > 1);
}

// Check if a Resy page is alive
async function checkResySlug(page, slug) {
  const url = `https://resy.com/cities/ny/${slug}`;
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(2000);

    const info = await page.evaluate(() => {
      const body = document.body?.innerText || '';
      const h1 = document.querySelector('h1');
      const finalUrl = window.location.href;
      const notFound = body.includes('page you were looking for') || body.includes("can't find") ||
                       body.includes('can\u2019t find') || body.includes('Sorry, but we') ||
                       window.location.pathname === '/' || window.location.pathname === '/cities/ny';
      const hasBooking = body.includes('Find a Time') || body.includes('Notify Me') || body.includes('Reserve Now');
      return {
        venueName: h1?.textContent?.trim() || '',
        finalUrl,
        notFound,
        hasBooking,
        bodyLen: body.length
      };
    });

    if (info.notFound || info.bodyLen < 300) return null;

    // Extract slug from final URL (might have redirected)
    const slugMatch = info.finalUrl.match(/\/cities\/[a-z-]+\/(?:venues\/)?([a-z0-9-]+)/i);
    const finalSlug = slugMatch ? slugMatch[1].toLowerCase() : slug;

    return { slug: finalSlug, venueName: info.venueName, url: info.finalUrl, hasBooking: info.hasBooking };
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

  console.log(`\n🔧 Resy Slug Fixer (Puppeteer)`);
  console.log(`📋 Locked Resy restaurants: ${locked.length}`);
  console.log(`✅ Already checked: ${Object.keys(results).length}`);
  console.log(`📋 To check: ${todo.length}`);
  console.log(`${'═'.repeat(55)}\n`);

  if (todo.length === 0) { console.log('Nothing to check!'); printSummary(results); return; }

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

  let fixed = 0, correct = 0, dead = 0, errors = 0;

  for (let i = 0; i < todo.length; i++) {
    const name = todo[i];
    const lookupKey = Object.keys(lookup).find(k => k.toLowerCase() === name.toLowerCase()) || name;
    const entry = lookup[lookupKey];
    const currentSlug = entry.url.match(/\/([a-z0-9_-]+)\/?$/i)?.[1] || '';

    process.stdout.write(`  [${i + 1}/${todo.length}] ${name.substring(0, 35).padEnd(35)} `);

    // First try current slug
    let result = await checkResySlug(page, currentSlug);

    if (result && result.hasBooking) {
      // Current slug works fine
      if (result.slug !== currentSlug.toLowerCase()) {
        // Redirected to different slug
        results[name] = { oldSlug: currentSlug, newSlug: result.slug, newUrl: result.url, venueName: result.venueName, status: 'fixed' };
        fixed++;
        console.log(`🔧 redirected → ${result.slug} (${result.venueName})`);
      } else {
        results[name] = { slug: currentSlug, venueName: result.venueName, status: 'correct' };
        correct++;
        console.log(`✅ correct (${result.venueName})`);
      }
    } else {
      // Current slug is dead — try variations
      const slugs = generateSlugs(name, currentSlug);
      let found = null;

      for (const slug of slugs) {
        if (slug === currentSlug.toLowerCase()) continue; // already tried
        result = await checkResySlug(page, slug);
        if (result && result.hasBooking) {
          found = result;
          break;
        }
        await sleep(2000 + Math.random() * 2000);
      }

      if (found) {
        results[name] = { oldSlug: currentSlug, newSlug: found.slug, newUrl: found.url, venueName: found.venueName, status: 'fixed' };
        fixed++;
        console.log(`🔧 ${currentSlug} → ${found.slug} (${found.venueName})`);
      } else {
        results[name] = { slug: currentSlug, status: 'dead' };
        dead++;
        console.log(`💀 not found (tried ${slugs.length} slugs)`);
      }
    }

    // Save every 10
    if ((i + 1) % 10 === 0) {
      saveJSON(OUTPUT_FILE, results);
      console.log(`    💾 Progress saved`);
    }

    // Restart browser every 50
    if ((i + 1) % 50 === 0) {
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
  saveJSON(OUTPUT_FILE, results);

  // Apply fixes to booking_lookup.json
  const fixes = Object.entries(results).filter(([, v]) => v.status === 'fixed');
  if (fixes.length > 0) {
    console.log(`\n📝 Applying ${fixes.length} slug fixes to booking_lookup.json...\n`);
    for (const [name, fix] of fixes) {
      const lookupKey = Object.keys(lookup).find(k => k.toLowerCase() === name.toLowerCase()) || name;
      if (lookup[lookupKey]) {
        lookup[lookupKey].url = fix.newUrl;
        console.log(`  ${name}: → ${fix.newUrl}`);
      }
    }
    saveJSON(LOOKUP_FILE, lookup);
    console.log(`\n✅ booking_lookup.json updated with ${fixes.length} fixes`);
  }

  printSummary(results);
}

function printSummary(results) {
  const entries = Object.values(results);
  const fixed = entries.filter(v => v.status === 'fixed').length;
  const correct = entries.filter(v => v.status === 'correct').length;
  const dead = entries.filter(v => v.status === 'dead').length;
  const errs = entries.filter(v => v.status === 'error').length;

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`📊 SUMMARY (${entries.length} checked)`);
  console.log(`   🔧 Fixed slugs: ${fixed}`);
  console.log(`   ✅ Already correct: ${correct}`);
  console.log(`   💀 Dead/not found: ${dead}`);
  console.log(`   ❌ Errors: ${errs}`);
  console.log(`\n💾 Results: data/resy_slug_fixes.json`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
