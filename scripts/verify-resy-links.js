#!/usr/bin/env deno run --allow-net --allow-read --allow-write

// Verify all 856 Resy URLs that are missing availability data
// Checks if the Resy page is valid, broken, or redirected

const missing = JSON.parse(await Deno.readTextFile('./data/resy_missing_avail.json'));

console.log(`\n🔍 Checking ${missing.length} Resy URLs...\n`);

const results = {
  valid: [],
  broken: [],       // 404, closed, or dead pages
  redirected: [],    // redirects to different restaurant
  no_url: [],        // empty/malformed URL
  error: [],         // network errors
};

const BATCH_SIZE = 10;
const DELAY_MS = 1500;

async function checkResyUrl(entry) {
  const { name, url } = entry;

  if (!url || !url.includes('resy.com')) {
    results.no_url.push({ name, url, reason: 'No valid Resy URL' });
    return;
  }

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    const finalUrl = resp.url;
    const status = resp.status;
    const body = await resp.text();

    // Check for various failure signals
    const isClosed = body.includes('permanently closed') || body.includes('no longer on Resy') || body.includes('this restaurant is not on resy');
    const isNotFound = status === 404 || body.includes('page not found') || body.includes('Page not found') || body.includes('"statusCode":404');
    const isRedirectHome = finalUrl === 'https://resy.com/' || finalUrl === 'https://resy.com' || finalUrl.endsWith('/cities/new-york-ny') || finalUrl.endsWith('/cities/ny');
    const hasVenueData = body.includes('"venue"') || body.includes('data-venue') || body.includes('resy-venue') || body.includes('"name"');

    // Try to extract the venue name from the page for verification
    let pageName = '';
    const nameMatch = body.match(/"name"\s*:\s*"([^"]+)"/);
    if (nameMatch) pageName = nameMatch[1];

    if (isNotFound || isClosed || isRedirectHome) {
      results.broken.push({
        name,
        url,
        finalUrl,
        status,
        reason: isClosed ? 'closed' : isRedirectHome ? 'redirects to home' : 'not found',
        pageName
      });
    } else if (status === 200 && !isRedirectHome) {
      results.valid.push({ name, url, finalUrl, pageName });
    } else {
      results.broken.push({ name, url, finalUrl, status, reason: `status ${status}`, pageName });
    }

  } catch (err) {
    results.error.push({ name, url, error: err.message });
  }
}

// Process in batches
for (let i = 0; i < missing.length; i += BATCH_SIZE) {
  const batch = missing.slice(i, i + BATCH_SIZE);
  const progress = Math.min(i + BATCH_SIZE, missing.length);

  await Promise.all(batch.map(entry => checkResyUrl(entry)));

  console.log(`  [${progress}/${missing.length}] ✅ ${results.valid.length} valid | ❌ ${results.broken.length} broken | ⚠️ ${results.error.length} errors`);

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
console.log(`📭 No URL:     ${results.no_url.length}`);
console.log(`${'═'.repeat(60)}\n`);

if (results.broken.length) {
  console.log(`\n❌ BROKEN LINKS (${results.broken.length}):`);
  for (const b of results.broken) {
    console.log(`  ${b.name}`);
    console.log(`    URL: ${b.url}`);
    console.log(`    Reason: ${b.reason}`);
    if (b.pageName) console.log(`    Page name: ${b.pageName}`);
    console.log('');
  }
}

if (results.error.length) {
  console.log(`\n⚠️  ERRORS (${results.error.length}):`);
  for (const e of results.error) {
    console.log(`  ${e.name}: ${e.error}`);
  }
}

// Save full results
const outputPath = './data/resy_link_verification.json';
await Deno.writeTextFile(outputPath, JSON.stringify(results, null, 2));
console.log(`\n💾 Full results saved to ${outputPath}`);
