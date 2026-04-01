/**
 * verify-platform-scan-ot.js
 *
 * Takes the 111 OpenTable restaurants from website_platform_scan.txt and verifies
 * each one via OT page fetch to confirm they're actually bookable.
 *
 * RUN:   node scripts/verify-platform-scan-ot.js
 * OPTIONS:
 *   --quick    First 10 only
 *   --batch N  Check N then stop
 */

const fs = require('fs');
const path = require('path');

const SCAN_FILE = path.join(__dirname, '..', 'data', 'website_platform_scan.txt');
const LOOKUP_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'booking_lookup.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'platform_scan_ot_verified.json');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
function getArg(name, def) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}
const BATCH_LIMIT = parseInt(getArg('batch', '0'), 10);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Parse the OT section from website_platform_scan.txt
function parseOTNames() {
  const text = fs.readFileSync(SCAN_FILE, 'utf8');
  const lines = text.split('\n');
  let inOT = false;
  const names = [];
  for (const line of lines) {
    if (line.startsWith('OPENTABLE (')) { inOT = true; continue; }
    if (inOT && line.trim() !== '' && !line.startsWith('  ')) break;
    if (inOT && line.startsWith('  ')) {
      const name = line.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

// Check if an OT URL actually loads and has reservation capability
async function checkOTUrl(url) {
  if (!url) return { valid: false, reason: 'no_url' };

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow'
    });

    if (!resp.ok) {
      return { valid: false, reason: `http_${resp.status}`, finalUrl: resp.url };
    }

    const html = await resp.text();
    const finalUrl = resp.url;

    // Check for signs this is NOT a bookable page
    if (html.includes('Page Not Found') || (html.includes('404') && html.includes('not found'))) {
      return { valid: false, reason: '404_page', finalUrl };
    }

    if (finalUrl.includes('/s?') || finalUrl.includes('/search')) {
      return { valid: false, reason: 'redirected_to_search', finalUrl };
    }

    // Check for reservation widget indicators
    const hasReservation = html.includes('Make a reservation') ||
                          html.includes('Find a time') ||
                          html.includes('availability') ||
                          html.includes('party size') ||
                          html.includes('partySize') ||
                          html.includes('dateTime') ||
                          html.includes('RestaurantAvailability') ||
                          html.includes('timeslot') ||
                          html.includes('reservationWidget') ||
                          html.includes('dtp-picker') ||
                          html.includes('"rid":');

    // Check for "not taking reservations" indicators
    const notBookable = html.includes('not currently taking reservations') ||
                       html.includes('not on the OpenTable reservation network') ||
                       html.includes('does not take reservations') ||
                       html.includes('This restaurant is not on') ||
                       html.includes('No longer on OpenTable');

    // Extract restaurant name from page
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    const pageName = titleMatch ? titleMatch[1].replace(/ - OpenTable.*$/, '').replace(/Reservations? \| /, '').replace(/ \| OpenTable$/, '').trim() : '';

    // Try to find rid
    const ridMatch = html.match(/"rid":\s*(\d+)/) || html.match(/restaurant\/(\d+)/);
    const rid = ridMatch ? ridMatch[1] : null;

    if (notBookable) {
      return { valid: false, reason: 'not_bookable', pageName, finalUrl, rid };
    }

    return {
      valid: hasReservation,
      reason: hasReservation ? 'bookable' : 'no_reservation_widget',
      pageName,
      finalUrl,
      rid
    };
  } catch (e) {
    return { valid: false, reason: `error: ${e.message}` };
  }
}

async function main() {
  const names = parseOTNames();
  console.log(`Found ${names.length} OT restaurants in scan file`);

  // Load existing lookup for current URLs
  const lookup = JSON.parse(fs.readFileSync(LOOKUP_FILE, 'utf8'));

  // Load previous results if any
  let results = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try { results = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch(e) {}
  }

  const limit = QUICK ? 10 : BATCH_LIMIT > 0 ? BATCH_LIMIT : names.length;
  let checked = 0;

  for (const name of names) {
    if (checked >= limit) break;

    const key = name.toLowerCase();

    // Skip if already verified
    if (results[key] && results[key].status) {
      console.log(`  SKIP ${name} (already checked: ${results[key].status})`);
      continue;
    }

    // Get current URL from booking_lookup (exact or fuzzy match)
    let currentUrl = '';
    const entry = lookup[key];
    if (entry && typeof entry === 'object' && entry.platform === 'opentable') {
      currentUrl = entry.url || '';
    }
    // Also try partial key matches if no exact match
    if (!currentUrl) {
      for (const lk of Object.keys(lookup)) {
        if (lk === key) continue;
        const lv = lookup[lk];
        if (typeof lv !== 'object' || lv.platform !== 'opentable') continue;
        // Only match if significant overlap (not just "the" or "bar")
        const nameWords = key.split(/\s+/).filter(w => w.length > 2);
        const lkWords = lk.split(/\s+/).filter(w => w.length > 2);
        const overlap = nameWords.filter(w => lkWords.includes(w)).length;
        if (overlap >= 2 || (overlap >= 1 && nameWords.length <= 2)) {
          currentUrl = lv.url || '';
          console.log(`  Fuzzy matched lookup key: "${lk}"`);
          break;
        }
      }
    }

    console.log(`\n[${checked + 1}] Checking: ${name}`);
    if (currentUrl) console.log(`  Current URL: ${currentUrl}`);

    // Step 1: Check the existing URL if we have one
    let urlResult = null;
    if (currentUrl) {
      urlResult = await checkOTUrl(currentUrl);
      console.log(`  URL check: ${urlResult.reason}${urlResult.pageName ? ` (page: "${urlResult.pageName}")` : ''}`);

      // Name sanity check - does the page name match?
      if (urlResult.valid && urlResult.pageName) {
        const pageNameLower = urlResult.pageName.toLowerCase();
        const searchName = name.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]/g, ' ').trim();
        const searchWords = searchName.split(/\s+/).filter(w => w.length > 2);
        const matchCount = searchWords.filter(w => pageNameLower.includes(w)).length;
        const matchRatio = searchWords.length > 0 ? matchCount / searchWords.length : 0;

        if (matchRatio < 0.3) {
          console.log(`  ⚠️  NAME MISMATCH: "${name}" vs page "${urlResult.pageName}" (${Math.round(matchRatio*100)}% match)`);
          urlResult.nameMismatch = true;
          urlResult.valid = false;
          urlResult.reason = 'name_mismatch';
        }
      }
    }

    // Step 2: If no URL or URL failed, search OT and try slug guesses
    let foundUrl = null;
    if (!currentUrl || !urlResult?.valid) {
      // First try OT search page to find real links
      // Clean special chars from search term for better results
      const cleanName = name.replace(/[&]/g, 'and').replace(/['']/g, "'");
      console.log(`  Searching OT for "${cleanName}"...`);
      try {
        const searchUrl = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName)}&metroId=4`;
        const searchResp = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
          }
        });
        if (searchResp.ok) {
          const searchHtml = await searchResp.text();
          const links = [...new Set(searchHtml.match(/https:\/\/www\.opentable\.com\/r\/[a-z0-9-]+/g) || [])];
          console.log(`  Search found ${links.length} links`);

          // NYC-area location keywords to filter results
          const nycAreas = ['new-york', 'brooklyn', 'queens', 'bronx', 'staten-island', 'manhattan',
            'nyc', 'jersey-city', 'hoboken', 'long-island', 'astoria', 'williamsburg',
            'harlem', 'tribeca', 'soho', 'chelsea', 'midtown', 'downtown', 'flushing',
            'park-slope', 'bushwick', 'greenpoint', 'dumbo', 'north-arlington'];

          const nameClean = name.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]/g, ' ').trim();
          const nameWords = nameClean.split(/\s+/).filter(w => w.length > 2);

          for (const link of links.slice(0, 8)) {
            const slugPart = link.split('/r/')[1] || '';
            const slugWords = slugPart.split('-');

            // Check name match via slug
            const slugMatch = nameWords.filter(w => slugWords.some(sw => sw.includes(w) || w.includes(sw))).length;
            const slugRatio = nameWords.length > 0 ? slugMatch / nameWords.length : 0;

            if (slugRatio < 0.2 && links.length > 1) {
              continue; // slug doesn't match at all
            }

            console.log(`  Checking: ${link}`);
            const linkResult = await checkOTUrl(link);
            if (linkResult.valid) {
              const pageTitle = (linkResult.pageName || '').toLowerCase();
              const pageMatch = nameWords.filter(w => pageTitle.includes(w)).length;
              const pageRatio = nameWords.length > 0 ? pageMatch / nameWords.length : 0;

              // Must be NYC area - check slug or page title
              const isNYC = nycAreas.some(a => slugPart.includes(a)) ||
                           pageTitle.includes('new york') || pageTitle.includes('brooklyn') ||
                           pageTitle.includes('queens') || pageTitle.includes('bronx') ||
                           pageTitle.includes(', ny') || pageTitle.includes(', nj');

              if (pageRatio >= 0.3 && isNYC) {
                console.log(`  ✅ Found bookable: ${link} (page: "${linkResult.pageName}")`);
                foundUrl = { url: link, ...linkResult };
                break;
              } else if (!isNYC) {
                console.log(`  ⚠️  Wrong location: "${linkResult.pageName}"`);
              } else {
                console.log(`  ⚠️  Name mismatch: "${linkResult.pageName}" (${Math.round(pageRatio*100)}%)`);
              }
            } else {
              console.log(`  ❌ ${linkResult.reason}`);
            }
            await sleep(800);
          }
        }
      } catch (e) {
        console.log(`  Search error: ${e.message}`);
      }

      // Fallback: try slug-based URL guesses
      if (!foundUrl) {
        const slug = name.toLowerCase()
          .replace(/['']/g, '')
          .replace(/&/g, 'and')
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');

        const guessUrls = [
          `https://www.opentable.com/r/${slug}-new-york`,
          `https://www.opentable.com/r/${slug}`,
          `https://www.opentable.com/${slug}`,
        ];

        for (const guessUrl of guessUrls) {
          console.log(`  Trying: ${guessUrl}`);
          const guessResult = await checkOTUrl(guessUrl);
          if (guessResult.valid) {
            console.log(`  ✅ Found bookable: ${guessUrl} (page: "${guessResult.pageName}")`);
            foundUrl = { url: guessUrl, ...guessResult };
            break;
          } else {
            console.log(`  ❌ ${guessResult.reason}`);
          }
          await sleep(800);
        }
      }
    }

    if (foundUrl) {
      results[key] = {
        name,
        currentUrl: currentUrl || null,
        currentUrlStatus: urlResult ? urlResult.reason : 'none',
        status: 'verified',
        verifiedUrl: foundUrl.url,
        pageName: foundUrl.pageName || null,
        rid: foundUrl.rid || null,
        checkedAt: new Date().toISOString()
      };
    } else if (urlResult?.valid) {
      results[key] = {
        name,
        currentUrl,
        currentUrlStatus: urlResult.reason,
        status: 'verified',
        verifiedUrl: currentUrl,
        pageName: urlResult.pageName || null,
        rid: urlResult.rid || null,
        checkedAt: new Date().toISOString()
      };
      console.log(`  ✅ Verified bookable`);
    } else {
      results[key] = {
        name,
        currentUrl: currentUrl || null,
        currentUrlStatus: urlResult ? urlResult.reason : 'none',
        status: 'not_found',
        verifiedUrl: null,
        pageName: urlResult?.pageName || null,
        rid: urlResult?.rid || null,
        checkedAt: new Date().toISOString()
      };
      console.log(`  ❌ Could not verify`);
    }

    // Save after each check
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    checked++;

    // Rate limit
    await sleep(1200);
  }

  // Print summary
  const vals = Object.values(results);
  const verified = vals.filter(v => v.status === 'verified').length;
  const notFound = vals.filter(v => v.status === 'not_found').length;
  const mismatch = vals.filter(v => v.currentUrlStatus === 'name_mismatch').length;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`SUMMARY`);
  console.log(`  Total checked: ${vals.length}`);
  console.log(`  ✅ Verified bookable: ${verified}`);
  console.log(`  ❌ Not found/not bookable: ${notFound}`);
  console.log(`  ⚠️  Name mismatches: ${mismatch}`);
  console.log(`\nResults saved to: ${OUTPUT_FILE}`);
}

main().catch(console.error);
