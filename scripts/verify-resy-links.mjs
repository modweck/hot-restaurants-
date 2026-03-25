// Verify all 856 Resy URLs that are missing availability data
import { readFileSync, writeFileSync } from 'fs';

const missing = JSON.parse(readFileSync('./data/resy_missing_avail.json', 'utf8'));

console.log(`\n🔍 Checking ${missing.length} Resy URLs...\n`);

const results = {
  valid: [],
  broken: [],
  error: [],
};

const BATCH_SIZE = 8;
const DELAY_MS = 2000;

async function checkResyUrl(entry) {
  const { name, url } = entry;

  if (!url || !url.includes('resy.com')) {
    results.broken.push({ name, url, reason: 'no valid resy url' });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const finalUrl = resp.url;
    const status = resp.status;
    const body = await resp.text();

    const isClosed = body.includes('permanently closed') || body.includes('no longer on Resy') || body.includes('is not available on Resy');
    const isNotFound = status === 404 || body.includes('"statusCode":404') || body.includes('Page Not Found');
    const isRedirectHome = finalUrl === 'https://resy.com/' || finalUrl === 'https://resy.com' || /resy\.com\/cities\/[^/]+\/?$/.test(finalUrl);

    // Try to extract venue name from page
    let pageName = '';
    const nameMatch = body.match(/"name"\s*:\s*"([^"]+)"/);
    if (nameMatch) pageName = nameMatch[1];

    // Extract slug from original URL
    const slugMatch = url.match(/\/([^/]+)\/?$/);
    const slug = slugMatch ? slugMatch[1] : '';

    if (isNotFound || isClosed || isRedirectHome) {
      results.broken.push({
        name,
        url,
        finalUrl: finalUrl !== url ? finalUrl : undefined,
        status,
        reason: isClosed ? 'closed' : isRedirectHome ? 'redirects_to_home' : 'not_found',
        slug,
      });
    } else if (status >= 200 && status < 400) {
      results.valid.push({ name, url, pageName: pageName || undefined });
    } else {
      results.broken.push({ name, url, status, reason: `http_${status}`, slug });
    }

  } catch (err) {
    results.error.push({ name, url, error: err.message?.slice(0, 100) || 'unknown' });
  }
}

// Process in batches
for (let i = 0; i < missing.length; i += BATCH_SIZE) {
  const batch = missing.slice(i, i + BATCH_SIZE);
  const progress = Math.min(i + BATCH_SIZE, missing.length);

  await Promise.all(batch.map(entry => checkResyUrl(entry)));

  const pct = ((progress / missing.length) * 100).toFixed(1);
  console.log(`  [${progress}/${missing.length}] (${pct}%) ✅ ${results.valid.length} valid | ❌ ${results.broken.length} broken | ⚠️  ${results.error.length} errors`);

  if (i + BATCH_SIZE < missing.length) {
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
}

// Summary
console.log(`\n${'═'.repeat(60)}`);
console.log(`RESULTS SUMMARY`);
console.log(`${'═'.repeat(60)}`);
console.log(`✅ Valid:      ${results.valid.length}`);
console.log(`❌ Broken:     ${results.broken.length}`);
console.log(`⚠️  Errors:     ${results.error.length}`);
console.log(`${'═'.repeat(60)}\n`);

// Save results
writeFileSync('./data/resy_link_verification.json', JSON.stringify(results, null, 2));
console.log(`💾 Results saved to data/resy_link_verification.json`);

// Quick broken breakdown
const reasons = {};
for (const b of results.broken) {
  reasons[b.reason] = (reasons[b.reason] || 0) + 1;
}
console.log(`\nBroken breakdown:`, reasons);
