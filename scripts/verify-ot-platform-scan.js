#!/usr/bin/env node
/**
 * Verify 111 OT restaurants from platform scan.
 * Uses curl + slug guessing (same approach as find_opentable_links.js).
 * Saves progress after every restaurant so it can resume.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SCAN_FILE = path.join(__dirname, '..', 'data', 'website_platform_scan.txt');
const RESULTS_FILE = path.join(__dirname, '..', 'data', 'platform_scan_ot_verified.json');

const DELAY_MS = 2500;        // 2.5s between restaurants
const SLUG_DELAY_MS = 600;    // 0.6s between slug attempts
const CURL_TIMEOUT = 20;

function sleep(ms) { execSync(`sleep ${ms / 1000}`); }

function slugify(name) {
  return (name || '').toLowerCase().trim()
    .replace(/['\u2019]/g, '')
    .replace(/&/g, 'and')
    .replace(/[\u00e9\u00e8\u00ea\u00eb]/g, 'e')
    .replace(/[\u00e1\u00e0\u00e2\u00e3\u00e4]/g, 'a')
    .replace(/[\u00ed\u00ec\u00ee\u00ef]/g, 'i')
    .replace(/[\u00f3\u00f2\u00f4\u00f6\u00f5]/g, 'o')
    .replace(/[\u00fa\u00f9\u00fb\u00fc]/g, 'u')
    .replace(/\u00f1/g, 'n').replace(/\u00e7/g, 'c')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function generateOTCandidates(name) {
  const slug = slugify(name);
  if (slug.length < 2) return [];

  const cleanName = name.replace(/\s*[-\u2013\u2014]\s*.+$/, '').trim();
  const cleanSlug = slugify(cleanName);

  const urls = new Set();
  urls.add(`https://www.opentable.com/r/${slug}-new-york`);
  urls.add(`https://www.opentable.com/r/${slug}-brooklyn`);
  urls.add(`https://www.opentable.com/${slug}`);
  urls.add(`https://www.opentable.com/r/${slug}-manhattan`);
  urls.add(`https://www.opentable.com/r/${slug}-queens`);
  urls.add(`https://www.opentable.com/r/${slug}`);

  if (cleanSlug !== slug && cleanSlug.length >= 2) {
    urls.add(`https://www.opentable.com/r/${cleanSlug}-new-york`);
    urls.add(`https://www.opentable.com/r/${cleanSlug}-brooklyn`);
    urls.add(`https://www.opentable.com/${cleanSlug}`);
  }

  return [...urls];
}

function curlFetch(url) {
  try {
    const args = [
      '-s', '-L', '--max-time', String(CURL_TIMEOUT),
      '-H', 'Accept: text/html',
      '-H', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '-w', '\n__CURL_META__%{http_code} %{url_effective}',
      url
    ];
    const result = require('child_process').execFileSync('curl', args,
      { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024, timeout: (CURL_TIMEOUT + 5) * 1000 }
    );

    const metaSep = result.lastIndexOf('__CURL_META__');
    if (metaSep === -1) return { status: 0, body: result, finalUrl: url, error: 'no meta' };

    const body = result.substring(0, metaSep);
    const metaLine = result.substring(metaSep + '__CURL_META__'.length).trim();
    const spaceIdx = metaLine.indexOf(' ');
    const status = parseInt(metaLine.substring(0, spaceIdx), 10);
    const finalUrl = metaLine.substring(spaceIdx + 1);

    return { status, body, finalUrl, error: null };
  } catch (err) {
    return { status: 0, body: '', finalUrl: url, error: err.message.substring(0, 100) };
  }
}

function checkOTPage(url) {
  const { status, body, finalUrl, error } = curlFetch(url);

  if (error) return { found: false, error };
  if (status !== 200) return { found: false, status };

  if (finalUrl === 'https://www.opentable.com/' ||
      finalUrl.includes('/s?') ||
      finalUrl.includes('/start/home')) {
    return { found: false, redirect: true };
  }

  if (body.includes('Page Not Found') ||
      body.includes('page-not-found') ||
      body.includes('404 -')) {
    return { found: false, is404: true };
  }

  if (body.includes('Make a reservation') ||
      body.includes('Find a time') ||
      body.includes('Booked') ||
      body.includes('restProfileSummary') ||
      (body.includes('opentable') && body.includes('reservation'))) {

    const titleMatch = body.match(/<title>([^<]+)<\/title>/i);
    const pageName = titleMatch ? titleMatch[1].replace(/\s*[-|].*$/, '').trim() : null;

    return { found: true, url: finalUrl, pageName };
  }

  return { found: false, noBookingContent: true };
}

function searchOpenTable(restaurantName) {
  const candidates = generateOTCandidates(restaurantName);

  for (let j = 0; j < candidates.length; j++) {
    const url = candidates[j];
    const result = checkOTPage(url);

    if (result.found) {
      return {
        status: 'verified',
        verifiedUrl: result.url || url,
        pageName: result.pageName
      };
    }

    if (result.error) {
      return { status: 'error', error: result.error };
    }

    if (j < candidates.length - 1) sleep(SLUG_DELAY_MS);
  }

  return { status: 'not_found' };
}

// Parse OT restaurants from platform scan text
function parseOTNames() {
  const text = fs.readFileSync(SCAN_FILE, 'utf8');
  const lines = text.split('\n');
  const names = [];
  let inOT = false;

  for (const line of lines) {
    if (line.startsWith('OPENTABLE (')) { inOT = true; continue; }
    if (inOT && /^[A-Z]/.test(line) && !line.startsWith('  ')) break;
    if (inOT && line.trim()) names.push(line.trim());
  }
  return names;
}

function main() {
  console.log('=== OT Platform Scan Verification ===\n');

  const names = parseOTNames();
  console.log(`Found ${names.length} OT restaurants to verify`);

  // Load existing results
  let results = {};
  try {
    results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    console.log(`Loaded ${Object.keys(results).length} existing results`);
  } catch (e) {
    console.log('Starting fresh');
  }

  // Test connectivity
  console.log('\nTesting OpenTable connectivity...');
  const test = curlFetch('https://www.opentable.com/');
  if (test.error || (test.status !== 200 && test.status !== 301 && test.status !== 302)) {
    console.error('Cannot reach OpenTable!', test.error || `HTTP ${test.status}`);
    process.exit(1);
  }
  console.log('OK\n');

  let verified = 0, notFound = 0, errors = 0, skipped = 0;

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const key = name.toLowerCase();

    // Skip already checked
    if (results[key]) {
      skipped++;
      const s = results[key].status;
      if (s === 'verified') verified++;
      else if (s === 'not_found') notFound++;
      else errors++;
      continue;
    }

    console.log(`[${i + 1}/${names.length}] ${name}...`);
    const result = searchOpenTable(name);

    results[key] = {
      name,
      ...result,
      checkedAt: new Date().toISOString()
    };

    if (result.status === 'verified') {
      verified++;
      console.log(`  ✓ ${result.verifiedUrl}`);
    } else if (result.status === 'not_found') {
      notFound++;
      console.log(`  ✗ not found`);
    } else {
      errors++;
      console.log(`  ! error: ${result.error}`);
    }

    // Save after each
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

    // Delay between restaurants
    if (i < names.length - 1) sleep(DELAY_MS);
  }

  console.log(`\n=== Results ===`);
  console.log(`Verified: ${verified}`);
  console.log(`Not found: ${notFound}`);
  console.log(`Errors: ${errors}`);
  console.log(`Skipped (already done): ${skipped}`);
  console.log(`\nSaved to ${RESULTS_FILE}`);
}

main();
