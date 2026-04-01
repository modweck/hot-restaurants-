// Use the Resy API to verify venues and check if they're actually bookable
import { readFileSync, writeFileSync } from 'fs';

const missing = JSON.parse(readFileSync('./data/resy_missing_avail.json', 'utf8'));

console.log(`\n🔍 Checking ${missing.length} Resy venues via API...\n`);

const results = {
  valid_bookable: [],
  valid_no_slots: [],
  closed_or_dead: [],
  wrong_slug: [],
  error: [],
};

const BATCH_SIZE = 5;
const DELAY_MS = 2500;
const TODAY = new Date().toISOString().split('T')[0];

function extractSlug(url) {
  if (!url) return null;
  // Handle both formats:
  // https://resy.com/cities/ny/venue-slug
  // https://resy.com/cities/new-york-ny/venues/venue-slug
  const m = url.match(/resy\.com\/cities\/[^/]+(?:\/venues)?\/([^/?#]+)/);
  return m ? m[1] : null;
}

async function checkVenue(entry) {
  const { name, url } = entry;
  const slug = extractSlug(url);

  if (!slug) {
    results.error.push({ name, url, error: 'Could not extract slug' });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    // Use the Resy find endpoint to look up the venue by slug
    const apiUrl = `https://api.resy.com/3/venue?url_slug=${slug}&location=new-york-ny`;
    const resp = await fetch(apiUrl, {
      headers: {
        'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
        'X-Resy-Auth-Token': '',
        'Accept': 'application/json',
        'Origin': 'https://resy.com',
        'Referer': 'https://resy.com/',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (resp.status === 404 || resp.status === 400) {
      // Try alternate city slugs
      let found = false;
      for (const city of ['ny', 'brooklyn-ny', 'new-york-ny']) {
        const altUrl = `https://api.resy.com/3/venue?url_slug=${slug}&location=${city}`;
        const altResp = await fetch(altUrl, {
          headers: {
            'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
            'Accept': 'application/json',
            'Origin': 'https://resy.com',
            'Referer': 'https://resy.com/',
          },
        });
        if (altResp.status === 200) {
          const data = await altResp.json();
          const venueId = data?.id?.resy;
          const venueName = data?.name;
          const isActive = data?.config?.enable_resys !== false;
          if (venueId && isActive) {
            results.valid_bookable.push({ name, url, venueId, venueName, city });
          } else if (venueId) {
            results.valid_no_slots.push({ name, url, venueId, venueName, reason: 'reservations disabled' });
          } else {
            results.closed_or_dead.push({ name, url, slug, reason: 'no venue id', city });
          }
          found = true;
          break;
        }
      }
      if (!found) {
        results.closed_or_dead.push({ name, url, slug, reason: `api_${resp.status}` });
      }
      return;
    }

    const data = await resp.json();
    const venueId = data?.id?.resy;
    const venueName = data?.name;
    const isActive = data?.config?.enable_resys !== false;

    if (venueId && isActive) {
      results.valid_bookable.push({ name, url, venueId, venueName });
    } else if (venueId) {
      results.valid_no_slots.push({ name, url, venueId, venueName, reason: 'reservations disabled' });
    } else {
      results.closed_or_dead.push({ name, url, slug, reason: 'no venue id in response' });
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      results.error.push({ name, url, error: 'timeout' });
    } else {
      results.error.push({ name, url, error: err.message?.slice(0, 120) || 'unknown' });
    }
  }
}

// Process in batches
for (let i = 0; i < missing.length; i += BATCH_SIZE) {
  const batch = missing.slice(i, i + BATCH_SIZE);
  const progress = Math.min(i + BATCH_SIZE, missing.length);

  await Promise.all(batch.map(entry => checkVenue(entry)));

  const pct = ((progress / missing.length) * 100).toFixed(1);
  console.log(`  [${progress}/${missing.length}] (${pct}%) ✅ ${results.valid_bookable.length} bookable | 🟡 ${results.valid_no_slots.length} no slots | ❌ ${results.closed_or_dead.length} dead | ⚠️  ${results.error.length} err`);

  if (i + BATCH_SIZE < missing.length) {
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
}

// Summary
console.log(`\n${'═'.repeat(60)}`);
console.log(`RESULTS SUMMARY`);
console.log(`${'═'.repeat(60)}`);
console.log(`✅ Bookable (valid venues):     ${results.valid_bookable.length}`);
console.log(`🟡 No slots / disabled:         ${results.valid_no_slots.length}`);
console.log(`❌ Closed / dead / not found:    ${results.closed_or_dead.length}`);
console.log(`⚠️  Errors:                      ${results.error.length}`);
console.log(`${'═'.repeat(60)}\n`);

// Save
writeFileSync('./data/resy_api_verification.json', JSON.stringify(results, null, 2));
console.log(`💾 Full results saved to data/resy_api_verification.json`);

// Show dead ones
if (results.closed_or_dead.length) {
  console.log(`\n❌ CLOSED/DEAD (${results.closed_or_dead.length}):`);
  for (const d of results.closed_or_dead) {
    console.log(`  ${d.name} — ${d.reason} — slug: ${d.slug}`);
  }
}

if (results.error.length) {
  console.log(`\n⚠️  ERRORS (${results.error.length}):`);
  for (const e of results.error) {
    console.log(`  ${e.name}: ${e.error}`);
  }
}
