/**
 * verify-yelp-27-puppeteer.js
 *
 * Puppeteer verification for 27 Yelp restaurants from website_platform_scan.txt.
 * Strategy: Visit the restaurant's OWN website (where Yelp was detected) and
 * extract the Yelp reservation slug/URL from the embedded widget.
 * Yelp.com itself blocks Puppeteer, so we go through the restaurant sites.
 *
 * For restaurants without a known website, tries Google search to find one.
 *
 * RUN:   node scripts/verify-yelp-27-puppeteer.js
 * OPTIONS:
 *   --quick       First 5 only
 *   --batch N     Check N then stop
 *   --all         Re-check even already-verified entries
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const SCAN_FILE = path.join(__dirname, '..', 'data', 'website_platform_scan.txt');
const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'yelp_27_puppeteer_results.json');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
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

// Parse Yelp names from scan file
function parseYelpNames() {
  const text = fs.readFileSync(SCAN_FILE, 'utf8');
  const lines = text.split('\n');
  let inYelp = false;
  const names = [];
  for (const line of lines) {
    if (line.startsWith('YELP (')) { inYelp = true; continue; }
    if (inYelp && line.trim() !== '' && !line.startsWith('  ')) break;
    if (inYelp && line.startsWith('  ')) {
      const name = line.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

// Visit restaurant website and extract Yelp reservation info
async function extractYelpFromWebsite(page, websiteUrl) {
  try {
    const yelpUrls = [];
    const requestHandler = req => {
      const url = req.url();
      if (url.includes('yelp.com')) yelpUrls.push(url);
    };
    page.on('request', requestHandler);

    await page.goto(websiteUrl, { waitUntil: 'networkidle2', timeout: 25000 });
    await sleep(3000);

    const pageInfo = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;

      // Find Yelp reservation URLs: yelp.com/reservations/{slug}
      const resMatches = html.match(/yelp\.com\/reservations\/([a-z0-9-]+)/gi) || [];
      const resSlugs = resMatches.map(m => {
        const s = m.match(/reservations\/([a-z0-9-]+)/i);
        return s ? s[1] : null;
      }).filter(Boolean);

      // Find Yelp biz URLs: yelp.com/biz/{slug}
      const bizMatches = html.match(/yelp\.com\/biz\/([a-z0-9-]+)/gi) || [];
      const bizSlugs = bizMatches.map(m => {
        const s = m.match(/biz\/([a-z0-9-]+)/i);
        return s ? s[1] : null;
      }).filter(Boolean);

      // Collect all yelp links from <a> tags
      const yelpLinks = [];
      document.querySelectorAll('a[href*="yelp.com"]').forEach(a => yelpLinks.push(a.href));

      // Check for yelp widget/iframe
      const hasYelpWidget = !!document.querySelector('iframe[src*="yelp"]') ||
                           html.includes('yelpreservationwidget') ||
                           html.includes('yelp-reservation');

      const hasYelp = html.includes('yelp.com') || html.includes('yelp-biz');

      return {
        resSlugs: [...new Set(resSlugs)],
        bizSlugs: [...new Set(bizSlugs)],
        yelpLinks: [...new Set(yelpLinks)],
        hasYelpWidget,
        hasYelp,
      };
    });

    page.off('request', requestHandler);

    // Also check network requests
    let networkResSlug = null, networkBizSlug = null;
    for (const url of yelpUrls) {
      const resM = url.match(/yelp\.com\/reservations\/([a-z0-9-]+)/i);
      if (resM) networkResSlug = resM[1];
      const bizM = url.match(/yelp\.com\/biz\/([a-z0-9-]+)/i);
      if (bizM) networkBizSlug = bizM[1];
    }

    // Prefer reservation slug, fall back to biz slug
    const resSlug = pageInfo.resSlugs[0] || networkResSlug;
    const bizSlug = pageInfo.bizSlugs[0] || networkBizSlug;
    const slug = resSlug || bizSlug;

    return {
      found: !!slug,
      resSlug,
      bizSlug,
      slug,
      hasReservation: !!resSlug,
      yelpReservationUrl: resSlug ? `https://www.yelp.com/reservations/${resSlug}` : null,
      yelpBizUrl: bizSlug ? `https://www.yelp.com/biz/${bizSlug}` : (slug ? `https://www.yelp.com/biz/${slug}` : null),
      yelpLinks: pageInfo.yelpLinks.slice(0, 5),
      hasYelpWidget: pageInfo.hasYelpWidget,
      hasYelp: pageInfo.hasYelp,
    };
  } catch (e) {
    page.removeAllListeners('request');
    return { found: false, error: e.message };
  }
}

// For restaurants without a website, try Google to find it
async function findWebsiteViaGoogle(page, name) {
  try {
    const query = `${name} restaurant NYC website`;
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
      waitUntil: 'networkidle2', timeout: 20000
    });
    await sleep(2000);

    const results = await page.evaluate(() => {
      const links = [];
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.href;
        // Skip google/yelp/social media links
        if (href.includes('google.com') || href.includes('yelp.com') ||
            href.includes('facebook.com') || href.includes('instagram.com') ||
            href.includes('tripadvisor.com') || href.includes('opentable.com') ||
            href.includes('resy.com') || href.includes('grubhub.com') ||
            href.includes('doordash.com') || href.includes('ubereats.com') ||
            href.includes('youtube.com') || href.includes('wikipedia.org')) return;
        if (href.startsWith('http') && !href.includes('webcache')) {
          links.push(href);
        }
      });
      return links.slice(0, 5);
    });

    return results[0] || null;
  } catch {
    return null;
  }
}

async function main() {
  const allNames = parseYelpNames();
  const master = loadJSON(MASTER_FILE);
  let results = loadJSON(OUTPUT_FILE);

  console.log(`\n🔍 Yelp 27 Puppeteer Verification`);
  console.log(`📋 Total from scan: ${allNames.length}`);

  let todo = [];
  for (const name of allNames) {
    const key = name.toLowerCase();
    if (!ALL && results[key] && results[key].verified) continue;
    const entry = master[key];
    todo.push({ name, key, website: entry ? entry.website : null });
  }

  if (QUICK) todo = todo.slice(0, 5);
  if (BATCH_LIMIT > 0) todo = todo.slice(0, BATCH_LIMIT);

  const withWebsite = todo.filter(t => t.website);
  const withoutWebsite = todo.filter(t => !t.website);

  console.log(`✅ Already verified: ${allNames.length - todo.length}`);
  console.log(`📋 To check: ${todo.length}`);
  console.log(`   With website URL: ${withWebsite.length}`);
  console.log(`   Need to find website: ${withoutWebsite.length}`);
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

  for (let i = 0; i < todo.length; i++) {
    const { name, key } = todo[i];
    let { website } = todo[i];
    process.stdout.write(`  [${i + 1}/${todo.length}] ${name.substring(0, 35).padEnd(35)} `);

    // If no website, try Google
    if (!website) {
      process.stdout.write(`🔎 `);
      website = await findWebsiteViaGoogle(page, name);
      if (website) {
        process.stdout.write(`→ ${new URL(website).hostname} `);
        await sleep(randDelay(3000, 6000));
      } else {
        results[key] = {
          name, verified: false,
          reason: 'no_website_found',
          checkedAt: new Date().toISOString()
        };
        notFound++;
        console.log(`❌ no website found`);
        saveJSON(OUTPUT_FILE, results);
        if (i < todo.length - 1) await sleep(randDelay(4000, 8000));
        continue;
      }
    }

    // Visit restaurant website and extract Yelp info
    const yelpResult = await extractYelpFromWebsite(page, website);

    if (yelpResult.found && yelpResult.hasReservation) {
      results[key] = {
        name,
        verified: true,
        yelpSlug: yelpResult.resSlug || yelpResult.bizSlug,
        yelpReservationUrl: yelpResult.yelpReservationUrl,
        yelpBizUrl: yelpResult.yelpBizUrl,
        websiteUrl: website,
        source: 'website_extract',
        checkedAt: new Date().toISOString()
      };
      found++;
      console.log(`🟢 ${yelpResult.yelpReservationUrl}`);
    } else if (yelpResult.found) {
      // Found yelp biz link but no reservation URL
      results[key] = {
        name,
        verified: false,
        yelpSlug: yelpResult.bizSlug,
        yelpBizUrl: yelpResult.yelpBizUrl,
        reason: 'biz_link_but_no_reservation',
        websiteUrl: website,
        checkedAt: new Date().toISOString()
      };
      notFound++;
      console.log(`🟡 biz link but no reservation URL → ${yelpResult.yelpBizUrl}`);
    } else if (yelpResult.hasYelp) {
      results[key] = {
        name,
        verified: false,
        reason: 'yelp_detected_no_slug',
        hasYelpWidget: yelpResult.hasYelpWidget,
        websiteUrl: website,
        checkedAt: new Date().toISOString()
      };
      notFound++;
      console.log(`🟡 yelp on page but no slug extracted`);
    } else {
      results[key] = {
        name,
        verified: false,
        reason: yelpResult.error ? `error: ${yelpResult.error.substring(0, 50)}` : 'no_yelp_found',
        websiteUrl: website,
        checkedAt: new Date().toISOString()
      };
      notFound++;
      console.log(`❌ ${yelpResult.error ? 'error' : 'no yelp on website'}`);
    }

    saveJSON(OUTPUT_FILE, results);
    if (i < todo.length - 1) await sleep(randDelay(4000, 8000));
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

  const reasons = {};
  for (const [, v] of failed) reasons[v.reason] = (reasons[v.reason] || 0) + 1;

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`📊 SUMMARY (${entries.length} / 27 checked)`);
  console.log(`   🟢 Verified w/ reservations: ${verified.length}`);
  console.log(`   ❌ Not verified: ${failed.length}`);
  if (verified.length > 0) {
    console.log(`\n   Verified:`);
    for (const [, v] of verified)
      console.log(`      ${v.name} → ${v.yelpReservationUrl}`);
  }
  if (Object.keys(reasons).length > 0) {
    console.log(`\n   Failure reasons:`);
    for (const [r, c] of Object.entries(reasons).sort((a, b) => b[1] - a[1]))
      console.log(`      ${r}: ${c}`);
  }
  console.log(`\n💾 Results: data/yelp_27_puppeteer_results.json`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
