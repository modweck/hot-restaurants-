#!/usr/bin/env node
/**
 * Check Resy links in BOOKING_MASTER for broken/invalid URLs.
 * Tests each Resy URL's slug against the Resy API to see if the venue exists.
 *
 * Usage: node scripts/utilities/check-resy-links.js
 * Output: Prints broken links and saves results to data/broken_resy_links.json
 */

const fs = require('fs');
const path = require('path');

const MASTER_PATH = path.join(__dirname, '../../netlify/functions/BOOKING_MASTER.json');
const AVAIL_PATH = path.join(__dirname, '../../netlify/functions/tonight_availability.json');
const OUTPUT_PATH = path.join(__dirname, '../../data/broken_resy_links.json');

const MASTER = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'));
const AVAIL = JSON.parse(fs.readFileSync(AVAIL_PATH, 'utf8'));
const availLower = new Set(Object.keys(AVAIL).filter(k => !k.startsWith('_')).map(k => k.toLowerCase()));

function extractSlug(url) {
  if (!url) return null;
  const m = url.match(/resy\.com\/cities\/[^/]+\/(?:venues\/)?([^/?#]+)/);
  return m ? m[1] : null;
}

async function checkSlug(slug) {
  try {
    const resp = await fetch(`https://api.resy.com/3/venue?url_slug=${slug}&location=ny`, {
      headers: {
        'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
        'X-Resy-Auth-Token': '',
        'Origin': 'https://resy.com',
        'Referer': 'https://resy.com/',
      }
    });
    if (resp.status === 404 || resp.status === 400) return { valid: false, status: resp.status };
    if (!resp.ok) return { valid: false, status: resp.status };
    const data = await resp.json();
    if (!data?.id?.resy) return { valid: false, status: 'no_venue_id' };
    return { valid: true, venueId: data.id.resy, name: data.name };
  } catch (e) {
    return { valid: false, status: 'error', message: e.message };
  }
}

async function main() {
  // Find Resy entries without availability (most likely broken)
  const toCheck = [];
  for (const [name, entry] of Object.entries(MASTER)) {
    if (entry.platform !== 'resy') continue;
    const url = entry.url || '';
    if (!url.includes('resy.com')) {
      toCheck.push({ name, url, reason: 'not_resy_url' });
      continue;
    }
    const slug = extractSlug(url);
    if (!slug) {
      toCheck.push({ name, url, reason: 'no_slug' });
      continue;
    }
    // Only check ones without availability (likely broken)
    if (!availLower.has(name.toLowerCase())) {
      toCheck.push({ name, url, slug, reason: 'no_availability' });
    }
  }

  console.log(`\n🔍 Checking ${toCheck.length} Resy restaurants without availability...\n`);

  const broken = [];
  const valid = [];
  const batches = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < toCheck.length; i += BATCH_SIZE) {
    batches.push(toCheck.slice(i, i + BATCH_SIZE));
  }

  let checked = 0;
  for (const batch of batches) {
    const results = await Promise.all(batch.map(async (item) => {
      if (!item.slug) {
        return { ...item, valid: false, status: item.reason };
      }
      const result = await checkSlug(item.slug);
      return { ...item, ...result };
    }));

    for (const r of results) {
      checked++;
      if (!r.valid) {
        broken.push(r);
        process.stdout.write(`❌ ${r.name} — ${r.url} (${r.status})\n`);
      } else {
        valid.push(r);
      }
    }

    if (checked % 50 === 0) {
      console.log(`  ... checked ${checked}/${toCheck.length} (${broken.length} broken so far)`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`✅ Valid: ${valid.length}`);
  console.log(`❌ Broken: ${broken.length}`);
  console.log(`${'═'.repeat(60)}\n`);

  // Save results
  const output = {
    checked_at: new Date().toISOString(),
    total_checked: toCheck.length,
    broken_count: broken.length,
    valid_count: valid.length,
    broken: broken.map(b => ({ name: b.name, url: b.url, slug: b.slug, status: b.status })),
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Results saved to ${OUTPUT_PATH}`);
}

main().catch(console.error);
