/**
 * search-dead-resy-puppeteer.js
 *
 * Uses Puppeteer to search resy.com for each dead restaurant name.
 * The API search is down (500), so we use the actual website search.
 * Slow pace to avoid detection.
 *
 * RUN: node scripts/search-dead-resy-puppeteer.js
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const VERIFIED_FILE = path.join(__dirname, '..', 'data', 'resy_puppeteer_verification.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'resy_dead_search_v2.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function similarity(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const triA = new Set(), triB = new Set();
  for (let i = 0; i <= na.length - 3; i++) triA.add(na.slice(i, i + 3));
  for (let i = 0; i <= nb.length - 3; i++) triB.add(nb.slice(i, i + 3));
  if (triA.size === 0 || triB.size === 0) return 0;
  const intersection = [...triA].filter(t => triB.has(t)).length;
  const union = new Set([...triA, ...triB]).size;
  return intersection / union;
}

function loadJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } }

async function searchResy(page, name) {
  try {
    // Go to resy.com and use the search
    const searchUrl = `https://resy.com/cities/ny?query=${encodeURIComponent(name)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 25000 });
    await sleep(3000);

    // Try to find search results on the page
    const results = await page.evaluate((searchName) => {
      // Look for venue links in search results
      const links = document.querySelectorAll('a[href*="/cities/"]');
      const venues = [];
      const seen = new Set();

      for (const link of links) {
        const href = link.href || '';
        const text = link.textContent.trim();

        // Skip navigation/city links, only want venue links
        if (!href || seen.has(href)) continue;
        if (href.match(/\/cities\/[a-z-]+\/?$/) && !href.includes('/venues/')) continue;
        if (!text || text.length < 2 || text.length > 100) continue;

        // Must be a venue-like link
        const venueMatch = href.match(/\/cities\/([a-z-]+)\/(?:venues\/)?([a-z0-9-]+)/);
        if (venueMatch) {
          seen.add(href);
          venues.push({
            name: text.split('\n')[0].trim(),
            url: href,
            slug: venueMatch[2],
            city: venueMatch[1],
          });
        }
      }

      return venues;
    }, name);

    // Score and find best match
    let bestMatch = null;
    let bestScore = 0;

    for (const v of results) {
      const score = similarity(name, v.name);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { ...v, score };
      }
    }

    return { results, bestMatch, bestScore };
  } catch (e) {
    return { results: [], bestMatch: null, bestScore: 0, error: e.message };
  }
}

async function main() {
  const verified = loadJSON(VERIFIED_FILE);

  const dead = Object.entries(verified).filter(([, v]) => {
    const vname = v.venueName || '';
    return vname.includes('Sorry') || vname.includes("can't find") || v.result === 'error';
  });

  // Deduplicate by URL (e.g. cote korean steakhouse and côte have same URL)
  const seenUrls = new Set();
  const deduped = [];
  for (const [name, data] of dead) {
    if (!seenUrls.has(data.url)) {
      seenUrls.add(data.url);
      deduped.push([name, data]);
    } else {
      // Skip duplicate URL
    }
  }

  console.log(`\n🔍 Searching resy.com for ${deduped.length} dead entries (${dead.length} total, ${dead.length - deduped.length} dupes)...\n`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800', '--disable-blink-features=AutomationControlled'],
  });

  const output = { found: [], maybe: [], dead: [], error: [] };

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    for (let i = 0; i < deduped.length; i++) {
      const [name, data] = deduped[i];
      process.stdout.write(`  [${i + 1}/${deduped.length}] ${name} ... `);

      const { bestMatch, bestScore, error } = await searchResy(page, name);

      if (error) {
        console.log(`❌ ${error.slice(0, 60)}`);
        output.error.push({ name, oldUrl: data.url, error });
      } else if (bestMatch && bestScore >= 0.6) {
        console.log(`✅ ${bestMatch.name} → ${bestMatch.url} (${bestScore.toFixed(2)})`);
        output.found.push({ name, oldUrl: data.url, newName: bestMatch.name, newUrl: bestMatch.url, score: bestScore });
      } else if (bestMatch && bestScore >= 0.35) {
        console.log(`🤔 ${bestMatch.name} (${bestScore.toFixed(2)})`);
        output.maybe.push({ name, oldUrl: data.url, candidateName: bestMatch.name, candidateUrl: bestMatch.url, score: bestScore });
      } else {
        console.log(`💀 no match${bestMatch ? ` (closest: ${bestMatch.name} @ ${bestScore.toFixed(2)})` : ''}`);
        output.dead.push({ name, oldUrl: data.url, closest: bestMatch?.name || null, closestScore: bestScore });
      }

      // Save progress after each
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

      if (i < deduped.length - 1) {
        const delay = 8000 + Math.random() * 7000; // 8-15 sec between
        await sleep(delay);
      }
    }

    await page.close();
  } finally {
    await browser.close();
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`✅ Found new link:   ${output.found.length}`);
  console.log(`🤔 Maybe match:      ${output.maybe.length}`);
  console.log(`💀 Truly dead:       ${output.dead.length}`);
  console.log(`❌ Errors:           ${output.error.length}`);
  console.log(`${'═'.repeat(60)}`);

  if (output.found.length) {
    console.log(`\n✅ FOUND:`);
    for (const f of output.found) console.log(`  ${f.name} → ${f.newName} (${f.newUrl})`);
  }
  if (output.maybe.length) {
    console.log(`\n🤔 MAYBE:`);
    for (const m of output.maybe) console.log(`  ${m.name} → ${m.candidateName}? (${m.candidateUrl})`);
  }
  if (output.dead.length) {
    console.log(`\n💀 DEAD:`);
    for (const d of output.dead) console.log(`  ${d.name}${d.closest ? ` (closest: ${d.closest})` : ''}`);
  }

  console.log(`\n💾 Saved to ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
