/**
 * search-dead-resy-google.js
 *
 * Uses Google search to find current Resy URLs for dead restaurants.
 * Searches: "site:resy.com <restaurant name> nyc"
 * Slow pace to avoid Google blocks.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const VERIFIED_FILE = path.join(__dirname, '..', 'data', 'resy_puppeteer_verification.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'resy_dead_search_v2.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function norm(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }

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

async function duckSearch(page, name) {
  const query = `site:resy.com ${name} nyc`;

  try {
    await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      waitUntil: 'networkidle2',
      timeout: 20000,
    });
    await sleep(2000);

    const results = await page.evaluate(() => {
      const items = [];
      // DuckDuckGo HTML results
      const links = document.querySelectorAll('.result__a, .result__url, a.result__snippet');
      const seen = new Set();

      for (const link of links) {
        let href = link.href || '';
        const text = link.textContent.trim();

        // DuckDuckGo wraps URLs through redirect
        if (href.includes('duckduckgo.com/l/?uddg=')) {
          const match = href.match(/uddg=([^&]+)/);
          if (match) href = decodeURIComponent(match[1]);
        }

        if (!href.includes('resy.com/cities')) continue;
        if (seen.has(href)) continue;
        seen.add(href);

        items.push({ title: text.split('\n')[0].trim(), url: href });
      }

      // Also check result snippets for resy URLs
      const snippets = document.querySelectorAll('.result__body, .result');
      for (const el of snippets) {
        const allLinks = el.querySelectorAll('a[href]');
        for (const a of allLinks) {
          let h = a.href || '';
          if (h.includes('duckduckgo.com/l/?uddg=')) {
            const m = h.match(/uddg=([^&]+)/);
            if (m) h = decodeURIComponent(m[1]);
          }
          if (h.includes('resy.com/cities') && !seen.has(h)) {
            seen.add(h);
            const t = a.textContent.trim().split('\n')[0] || '';
            items.push({ title: t, url: h });
          }
        }
      }

      return items;
    });

    return { results };
  } catch (e) {
    return { results: [], error: e.message.slice(0, 80) };
  }
}

async function main() {
  const verified = loadJSON(VERIFIED_FILE);

  const dead = Object.entries(verified).filter(([, v]) => {
    const vname = v.venueName || '';
    return vname.includes('Sorry') || vname.includes("can't find") || v.result === 'error';
  });

  // Deduplicate by URL
  const seenUrls = new Set();
  const deduped = [];
  for (const [name, data] of dead) {
    if (!seenUrls.has(data.url)) {
      seenUrls.add(data.url);
      deduped.push([name, data]);
    }
  }

  console.log(`\n🔍 Google search for Resy URLs: ${deduped.length} dead entries...\n`);

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

      const { results, error } = await duckSearch(page, name);

      if (error) {
        console.log(`❌ ${error}`);
        output.error.push({ name, oldUrl: data.url, error });
      } else if (results.length === 0) {
        console.log(`💀 no Google results`);
        output.dead.push({ name, oldUrl: data.url });
      } else {
        // Find best match from Google results
        let bestMatch = null;
        let bestScore = 0;

        for (const r of results) {
          // Clean up title — often "Restaurant Name - Resy"
          const cleanTitle = r.title.replace(/\s*[-–|].*resy.*/i, '').replace(/\s*[-–|].*new york.*/i, '').trim();
          const score = similarity(name, cleanTitle);

          // Also check URL slug
          const slugMatch = r.url.match(/\/([a-z0-9-]+)\/?$/);
          const slug = slugMatch ? slugMatch[1] : '';
          const slugScore = similarity(name, slug.replace(/-/g, ' '));

          const finalScore = Math.max(score, slugScore);

          if (finalScore > bestScore) {
            bestScore = finalScore;
            bestMatch = { title: cleanTitle, url: r.url, slug, score: finalScore };
          }
        }

        if (bestMatch && bestScore >= 0.5) {
          console.log(`✅ ${bestMatch.title} → ${bestMatch.url} (${bestScore.toFixed(2)})`);
          output.found.push({ name, oldUrl: data.url, newName: bestMatch.title, newUrl: bestMatch.url, score: bestScore });
        } else if (bestMatch && bestScore >= 0.3) {
          console.log(`🤔 ${bestMatch.title} (${bestScore.toFixed(2)}) ${bestMatch.url}`);
          output.maybe.push({ name, oldUrl: data.url, candidateName: bestMatch.title, candidateUrl: bestMatch.url, score: bestScore });
        } else {
          const top = results[0];
          console.log(`💀 no match (top: ${top.title.slice(0, 40)})`);
          output.dead.push({ name, oldUrl: data.url, googleTop: top.title, googleTopUrl: top.url });
        }
      }

      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

      if (i < deduped.length - 1) {
        // 15-25 sec between Google searches
        const delay = 15000 + Math.random() * 10000;
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
    for (const d of output.dead) console.log(`  ${d.name}${d.googleTop ? ` (google: ${d.googleTop})` : ''}`);
  }

  console.log(`\n💾 Saved to ${OUTPUT_FILE}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
