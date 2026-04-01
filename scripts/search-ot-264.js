/**
 * search-ot-264.js
 *
 * Uses Puppeteer to search OpenTable for 264 restaurants with broken Resy links.
 * Strict name matching only — no false positives.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const INPUT_FILE = path.join(__dirname, '..', 'data', 'resy_264_ot_check.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'resy_264_ot_results.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function norm(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`\u2019\u2018]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function isStrongMatch(searchName, resultName) {
  const a = norm(searchName);
  const b = norm(resultName);
  if (a === b) return 'exact';
  if (a.includes(b) && b.length >= a.length * 0.4 && b.length >= 3) return 'contains';
  if (b.includes(a) && a.length >= b.length * 0.4 && a.length >= 3) return 'contains';

  const wa = a.split(' ').filter(w => w.length >= 3);
  const wb = b.split(' ').filter(w => w.length >= 3);
  if (wa.length === 0 || wb.length === 0) return a === b ? 'exact' : null;

  const wbSet = new Set(wb);
  const waSet = new Set(wa);
  const fwd = wa.filter(w => wbSet.has(w)).length;
  const rev = wb.filter(w => waSet.has(w)).length;

  if (wa.length === 1 && wb.length === 1 && wa[0] === wb[0]) return 'single_word';
  if (fwd >= 1 && fwd / wa.length >= 0.5 && rev / wb.length >= 0.5) return 'word_match';

  return null;
}

async function searchOT(page, name) {
  const cleanName = name.replace(/[^\w\s''-]/g, '').trim();
  const searchUrl = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName + ' new york')}&metroId=8`;

  try {
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(2500);

    const results = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/r/"]');
      const matches = [];
      for (const link of links) {
        const href = link.getAttribute('href');
        if (!href || !href.includes('/r/')) continue;
        const text = (link.textContent || '').trim();
        if (text.length < 2 || text.length > 100) continue;
        const slug = href.match(/\/r\/([^?#/]+)/)?.[1];
        if (slug) matches.push({ name: text, slug, href });
      }
      return matches;
    });

    return results;
  } catch (e) {
    return [];
  }
}

async function main() {
  const entries = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));

  let results = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    results = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  }

  const remaining = entries.filter(e => !results[e.name]);
  console.log(`\n🔍 OpenTable Puppeteer Search`);
  console.log(`   Total: ${entries.length}`);
  console.log(`   Done: ${Object.keys(results).length}`);
  console.log(`   Remaining: ${remaining.length}\n`);

  if (remaining.length === 0) return;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });

  let found = 0, notFound = 0;

  for (let i = 0; i < remaining.length; i++) {
    const e = remaining[i];
    const pct = ((i + 1) / remaining.length * 100).toFixed(0);

    const otResults = await searchOT(page, e.name);

    let bestMatch = null;
    for (const r of otResults) {
      const matchType = isStrongMatch(e.name, r.name);
      if (matchType) {
        bestMatch = {
          name: r.name,
          slug: r.slug,
          url: `https://www.opentable.com/r/${r.slug}`,
          match_type: matchType,
        };
        break;
      }
    }

    if (bestMatch) {
      results[e.name] = { status: 'found', match: bestMatch };
      found++;
      console.log(`✅ [${pct}%] ${e.name} → ${bestMatch.name} (${bestMatch.match_type})`);
    } else {
      results[e.name] = {
        status: 'not_found',
        got: otResults.slice(0, 3).map(r => r.name),
      };
      notFound++;
      console.log(`❌ [${pct}%] ${e.name}`);
    }

    if ((i + 1) % 10 === 0 || i === remaining.length - 1) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    }

    await sleep(3000 + Math.random() * 2000);
  }

  await browser.close();

  console.log(`\n📊 Results: ${found} found on OT, ${notFound} not found`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
}

main().catch(console.error);
