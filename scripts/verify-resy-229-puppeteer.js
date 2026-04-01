/**
 * verify-resy-229-puppeteer.js
 *
 * Puppeteer verification for 229 Resy restaurants from website_platform_scan.txt.
 * Two-phase approach:
 *   Phase 1: Visit the restaurant's own website and extract Resy slug/venueId from embed
 *   Phase 2: Slug guessing on resy.com for anything Phase 1 missed
 *
 * RUN:   node scripts/verify-resy-229-puppeteer.js
 * OPTIONS:
 *   --quick       First 10 only
 *   --batch N     Check N then stop
 *   --phase2      Skip to phase 2 (slug guessing)
 *   --all         Re-check even already-verified entries
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const SCAN_FILE = path.join(__dirname, '..', 'data', 'website_platform_scan.txt');
const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'resy_229_puppeteer_results.json');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const PHASE2_ONLY = args.includes('--phase2');
const ALL = args.includes('--all');
function getArg(name, def) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}
const BATCH_LIMIT = parseInt(getArg('batch', '0'), 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));
function randDelay(min = 5000, max = 10000) { return min + Math.random() * (max - min); }

function loadJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } }
function saveJSON(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

// Parse Resy names from scan file
function parseResyNames() {
  const text = fs.readFileSync(SCAN_FILE, 'utf8');
  const lines = text.split('\n');
  let inResy = false;
  const names = [];
  for (const line of lines) {
    if (line.startsWith('RESY (')) { inResy = true; continue; }
    if (inResy && /^[A-Z]/.test(line) && !line.startsWith('  ')) break;
    if (inResy && line.startsWith('  ')) {
      const name = line.trim();
      if (name && name !== 'n/a') names.push(name);
    }
  }
  return names;
}

// Generate slug variations for Phase 2
function generateSlugs(name) {
  const base = name.toLowerCase()
    .replace(/[''`\u2019]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const slugs = new Set();
  slugs.add(base);

  const noLocation = base
    .replace(/-(nyc|ny|new-york|manhattan|brooklyn|queens|astoria|bushwick|chelsea|soho|tribeca|ues|uws|midtown|nj|jersey-city|crown-heights|union-square|east-village|west-village|park-slope|times-square|flushing|williamsburg|bed-stuy|edgewater)$/g, '')
    .replace(/-+$/, '');
  if (noLocation !== base) slugs.add(noLocation);

  const noSuffix = base
    .replace(/-(restaurant|ristorante|bistro|bar|grill|kitchen|cafe|steakhouse|chophouse|cantina|taphouse|lounge|club|tavern|diner|pizzeria|trattoria|osteria|brasserie)$/g, '')
    .replace(/-+$/, '');
  if (noSuffix !== base) slugs.add(noSuffix);

  if (base.startsWith('the-')) slugs.add(base.slice(4));

  slugs.add(base + '-ny');
  slugs.add(base + '-nyc');
  slugs.add(base + '-new-york');

  const dashParts = name.split(' - ');
  if (dashParts.length > 1) {
    const first = dashParts[0].toLowerCase()
      .replace(/[''`\u2019]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    slugs.add(first);
    slugs.add(first + '-ny');
    slugs.add(first + '-nyc');
  }

  if (base.endsWith('s')) slugs.add(base.slice(0, -1));
  else slugs.add(base + 's');

  return [...slugs].filter(s => s.length > 1);
}

// Phase 1: Visit restaurant website, extract Resy embed info
async function checkWebsiteForResy(page, websiteUrl) {
  try {
    const resyUrls = [];
    const requestHandler = req => {
      const url = req.url();
      if (url.includes('resy.com') || url.includes('widgets.resy.com')) {
        resyUrls.push(url);
      }
    };
    page.on('request', requestHandler);

    await page.goto(websiteUrl, { waitUntil: 'networkidle2', timeout: 25000 });
    await sleep(3000);

    const pageInfo = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;

      // Generic Resy paths that are NOT restaurant slugs
      const IGNORE_SLUGS = ['venues', 'cities', 'ny', 'about', 'login', 'signup', 'search',
        'help', 'terms', 'privacy', 'careers', 'blog', 'press', 'gift-cards', 'support'];

      // Look for venue ID in various embed formats
      const venueIdMatch = html.match(/venue[_-]?id['":\s]*['"]*(\d{3,6})['"]/i) ||
                          html.match(/resy[._-]?venue['":\s]*['"]*(\d{3,6})['"]/i) ||
                          html.match(/data-resy-venue['":\s]*['"]*(\d{3,6})['"]/i) ||
                          html.match(/resywidget[^>]*venue[_-]?id['"=:\s]+['"]*(\d{3,6})['"]/i);

      // Look for Resy slug in URLs — multiple formats:
      //   resy.com/cities/ny/{slug}
      //   resy.com/cities/new-york-ny/venues/{slug}
      //   resy.com/cities/new-york-ny/{slug}
      const slugMatches = html.match(/resy\.com\/cities\/[a-z-]+\/(?:venues\/)?([a-z0-9][a-z0-9-]*?)(?:[?#"'&]|$)/gi) || [];
      let slug = null;
      for (const m of slugMatches) {
        const s = m.match(/(?:venues\/)?([a-z0-9][a-z0-9-]*?)(?:[?#"'&]|$)/i);
        if (s && !IGNORE_SLUGS.includes(s[1].toLowerCase()) && s[1].length > 1) { slug = s[1].toLowerCase(); break; }
      }

      // Also check widget embed attributes
      if (!slug) {
        const widgetSlug = html.match(/widgets\.resy\.com[^"']*?venue[_-]?slug['"=:]+([a-z0-9-]+)/i) ||
                          html.match(/data-resy-slug['"=:\s]+['"]*([a-z0-9-]+)['"]/i) ||
                          html.match(/resy[_-]?slug['"=:\s]+['"]*([a-z0-9-]+)['"]/i);
        if (widgetSlug && !IGNORE_SLUGS.includes(widgetSlug[1].toLowerCase())) {
          slug = widgetSlug[1].toLowerCase();
        }
      }

      const hasResyScript = html.includes('resy.com') || html.includes('resyWidget') ||
                           html.includes('ResyWidget') || html.includes('widgets.resy');

      // Collect resy links from <a> tags
      const resyLinks = [];
      document.querySelectorAll('a[href*="resy.com"]').forEach(a => resyLinks.push(a.href));

      // Also check iframes
      const iframeSrcs = [];
      document.querySelectorAll('iframe[src*="resy"]').forEach(f => iframeSrcs.push(f.src));

      return {
        venueId: venueIdMatch ? venueIdMatch[1] : null,
        slug,
        hasResyScript,
        resyLinks,
        iframeSrcs,
        hasWidget: !!document.querySelector('iframe[src*="resy.com"]') ||
                   !!document.querySelector('[data-resy]') ||
                   !!document.querySelector('script[src*="resy"]'),
      };
    });

    // Check intercepted network requests for Resy API calls
    const IGNORE_SLUGS = ['venues', 'cities', 'ny', 'about', 'login', 'signup', 'search'];
    let networkSlug = null, networkVenueId = null;
    for (const url of resyUrls) {
      const slugM = url.match(/resy\.com\/cities\/[a-z-]+\/(?:venues\/)?([a-z0-9][a-z0-9-]*?)(?:[?#&]|$)/);
      if (slugM && !IGNORE_SLUGS.includes(slugM[1].toLowerCase()) && slugM[1].length > 1) networkSlug = slugM[1].toLowerCase();
      const vidM = url.match(/venue[_-]?id=(\d+)/);
      if (vidM) networkVenueId = vidM[1];
      // Also catch API calls like api.resy.com/3/venue?slug=xxx
      const apiSlug = url.match(/api\.resy\.com.*[?&]slug=([a-z0-9-]+)/i);
      if (apiSlug) networkSlug = apiSlug[1].toLowerCase();
    }

    page.off('request', requestHandler);

    const slug = pageInfo.slug || networkSlug;
    const venueId = pageInfo.venueId || networkVenueId;

    // Extract slug from <a href> resy links
    let linkSlug = null;
    for (const link of [...pageInfo.resyLinks, ...pageInfo.iframeSrcs]) {
      const m = link.match(/resy\.com\/cities\/[a-z-]+\/(?:venues\/)?([a-z0-9][a-z0-9-]*?)(?:[?#&]|$)/);
      if (m && !IGNORE_SLUGS.includes(m[1].toLowerCase()) && m[1].length > 1) { linkSlug = m[1].toLowerCase(); break; }
    }

    const finalSlug = slug || linkSlug;

    return {
      found: !!(finalSlug || venueId),
      slug: finalSlug,
      venueId,
      hasResyScript: pageInfo.hasResyScript,
      hasWidget: pageInfo.hasWidget,
      resyLinks: pageInfo.resyLinks.slice(0, 3),
    };
  } catch (e) {
    page.off('request', requestHandler);
    return { found: false, error: e.message };
  }
}

// Visit resy.com page and check if alive/bookable
async function checkResyPage(page, slug) {
  const url = `https://resy.com/cities/ny/${slug}`;
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    const status = resp ? resp.status() : 0;
    await sleep(2500);

    const pageData = await page.evaluate(() => {
      const body = document.body ? document.body.innerText : '';
      const title = document.title || '';

      const notFound = body.includes('page you were looking for') ||
                       body.includes("can't find") ||
                       body.includes('can\u2019t find') ||
                       body.includes('Sorry, but we') ||
                       body.includes('check that the address') ||
                       body.includes('no longer available') ||
                       body.includes('page not found') ||
                       title.toLowerCase().includes('not found');

      const closed = body.includes('permanently closed') ||
                     body.includes('this venue is closed');

      const hasBooking = !!document.querySelector('[class*="ReservationButton"]') ||
                         !!document.querySelector('[class*="TimeSlot"]') ||
                         !!document.querySelector('button[data-test*="reserve"]') ||
                         body.includes('Find a Time') ||
                         body.includes('Notify Me') ||
                         body.includes('Reserve Now');

      const isHomepage = window.location.pathname === '/' ||
                         window.location.pathname === '/cities/ny';

      const venueNameEl = document.querySelector('h1');
      const venueName = venueNameEl ? venueNameEl.textContent.trim() : '';

      return { notFound, closed, hasBooking, isHomepage, venueName, finalUrl: window.location.href, bodyLen: body.length };
    });

    if (status === 404 || pageData.notFound || pageData.isHomepage) return { result: 'dead', status, slug };
    if (pageData.closed) return { result: 'closed', status, slug, venueName: pageData.venueName };
    if (pageData.hasBooking) return { result: 'alive', status, slug, venueName: pageData.venueName, url };
    if (status >= 200 && status < 400 && pageData.venueName && pageData.bodyLen > 500) {
      return { result: 'alive_no_widget', status, slug, venueName: pageData.venueName, url };
    }
    return { result: 'dead', status, slug };
  } catch (e) {
    return { result: 'error', slug, error: e.message };
  }
}

async function main() {
  const allNames = parseResyNames();
  const master = loadJSON(MASTER_FILE);
  let results = loadJSON(OUTPUT_FILE);

  console.log(`\n🔍 Resy 229 Puppeteer Verification`);
  console.log(`📋 Total from scan: ${allNames.length}`);

  let todo = [];
  for (const name of allNames) {
    const key = name.toLowerCase();
    if (!ALL && results[key] && results[key].verified) continue;

    const entry = master[key];
    const websiteUrl = entry ? entry.website : null;
    todo.push({ name, key, websiteUrl, inMaster: !!entry });
  }

  if (QUICK) todo = todo.slice(0, 10);
  if (BATCH_LIMIT > 0) todo = todo.slice(0, BATCH_LIMIT);

  const withWebsite = todo.filter(t => t.websiteUrl);
  const withoutWebsite = todo.filter(t => !t.websiteUrl);

  console.log(`✅ Already verified: ${allNames.length - todo.length}`);
  console.log(`📋 To check: ${todo.length}`);
  console.log(`   Phase 1 (website extract): ${withWebsite.length}`);
  console.log(`   Phase 2 (slug guess): ${withoutWebsite.length}`);
  console.log(`${'═'.repeat(55)}\n`);

  if (todo.length === 0) { console.log('Nothing to check!'); printSummary(results); return; }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1280,800']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  let found = 0, notFound = 0;
  let checked = 0;

  // ── Phase 1: Website extraction ──
  if (!PHASE2_ONLY && withWebsite.length > 0) {
    console.log(`── PHASE 1: Extract Resy from restaurant websites ──\n`);

    for (let i = 0; i < withWebsite.length; i++) {
      const { name, key, websiteUrl } = withWebsite[i];
      checked++;
      process.stdout.write(`  [${checked}/${todo.length}] ${name.substring(0, 35).padEnd(35)} `);

      const wsResult = await checkWebsiteForResy(page, websiteUrl);

      if (wsResult.found && wsResult.slug) {
        process.stdout.write(`→ "${wsResult.slug}" `);
        await sleep(2000);
        const verify = await checkResyPage(page, wsResult.slug);

        if (verify.result === 'alive' || verify.result === 'alive_no_widget') {
          results[key] = {
            name, verified: true,
            slug: wsResult.slug,
            venueId: wsResult.venueId || null,
            url: `https://resy.com/cities/ny/${wsResult.slug}`,
            venueName: verify.venueName,
            source: 'website_extract',
            websiteUrl,
            checkedAt: new Date().toISOString()
          };
          found++;
          console.log(`🟢 ${verify.venueName}`);
        } else {
          results[key] = {
            name, verified: false,
            slug: wsResult.slug, venueId: wsResult.venueId || null,
            resyStatus: verify.result,
            source: 'website_extract_unverified',
            websiteUrl, needsPhase2: true,
            checkedAt: new Date().toISOString()
          };
          notFound++;
          console.log(`🟡 slug found but ${verify.result}`);
        }
      } else if (wsResult.found && wsResult.venueId) {
        results[key] = {
          name, verified: false,
          venueId: wsResult.venueId,
          source: 'website_venue_id_only',
          websiteUrl, needsPhase2: true,
          checkedAt: new Date().toISOString()
        };
        notFound++;
        console.log(`🟡 venueId ${wsResult.venueId} no slug`);
      } else {
        results[key] = {
          name, verified: false,
          hasResyScript: wsResult.hasResyScript || false,
          source: 'website_no_extract',
          websiteUrl, error: wsResult.error || null, needsPhase2: true,
          checkedAt: new Date().toISOString()
        };
        notFound++;
        const reason = wsResult.error ? `err: ${wsResult.error.substring(0, 40)}` :
                      wsResult.hasResyScript ? 'resy script but no slug' : 'no resy found';
        console.log(`⚪ ${reason}`);
      }

      saveJSON(OUTPUT_FILE, results);
      if (i < withWebsite.length - 1) await sleep(randDelay(4000, 8000));
    }
    console.log(`\n  Phase 1: 🟢 ${found} found | ⚪ ${notFound} need Phase 2\n`);
  }

  // ── Phase 2: Slug guessing on resy.com ──
  const phase2Todo = PHASE2_ONLY
    ? todo
    : [...withoutWebsite, ...withWebsite.filter(t => results[t.key]?.needsPhase2)];

  if (phase2Todo.length > 0) {
    console.log(`── PHASE 2: Slug guessing (${phase2Todo.length} restaurants) ──\n`);
    let p2Found = 0, p2Dead = 0;

    for (let i = 0; i < phase2Todo.length; i++) {
      const { name, key } = phase2Todo[i];
      if (!PHASE2_ONLY) checked++;
      else checked = i + 1;

      if (results[key]?.verified) continue;

      const slugs = generateSlugs(name);
      process.stdout.write(`  [${checked}/${todo.length}] ${name.substring(0, 35).padEnd(35)} `);

      let hit = null;
      for (const slug of slugs) {
        const result = await checkResyPage(page, slug);
        if (result.result === 'alive' || result.result === 'alive_no_widget') {
          hit = result;
          break;
        }
        await sleep(3000 + Math.random() * 2000);
      }

      if (hit) {
        results[key] = {
          name, verified: true,
          slug: hit.slug,
          url: `https://resy.com/cities/ny/${hit.slug}`,
          venueName: hit.venueName,
          source: 'slug_guess',
          checkedAt: new Date().toISOString()
        };
        p2Found++; found++;
        console.log(`🟢 ${hit.venueName} (${hit.slug})`);
      } else {
        results[key] = {
          ...results[key],
          name, verified: false,
          slugsTried: slugs.slice(0, 6),
          source: results[key]?.source?.includes('website') ? 'both_failed' : 'slug_guess_failed',
          needsPhase2: false,
          checkedAt: new Date().toISOString()
        };
        p2Dead++; notFound++;
        console.log(`💀 not found (${slugs.length} slugs)`);
      }

      saveJSON(OUTPUT_FILE, results);
      if (i < phase2Todo.length - 1) await sleep(randDelay(6000, 12000));
    }
    console.log(`\n  Phase 2: 🟢 ${p2Found} found | 💀 ${p2Dead} dead`);
  }

  await browser.close();

  results._meta = {
    totalChecked: Object.keys(results).filter(k => k !== '_meta').length,
    verified: Object.values(results).filter(v => v.verified).length,
    notVerified: Object.values(results).filter(v => v.verified === false).length,
    lastRun: new Date().toISOString()
  };
  saveJSON(OUTPUT_FILE, results);
  printSummary(results);
}

function printSummary(results) {
  const entries = Object.entries(results).filter(([k]) => k !== '_meta');
  const verified = entries.filter(([, v]) => v.verified);
  const failed = entries.filter(([, v]) => v.verified === false);
  const sources = {};
  for (const [, v] of verified) sources[v.source] = (sources[v.source] || 0) + 1;

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`📊 SUMMARY (${entries.length} / 229 checked)`);
  console.log(`   🟢 Verified: ${verified.length}`);
  console.log(`   ❌ Not found: ${failed.length}`);
  if (Object.keys(sources).length > 0) {
    console.log(`   Sources:`);
    for (const [src, cnt] of Object.entries(sources).sort((a, b) => b[1] - a[1]))
      console.log(`      ${src}: ${cnt}`);
  }
  console.log(`\n💾 Results: data/resy_229_puppeteer_results.json`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
