/**
 * age-out-new-rising.js
 *
 * Refreshes Google review counts for all new_rising restaurants
 * and removes the new_rising tag from any with 50+ reviews.
 *
 * RUN:   node scripts/age-out-new-rising.js
 * FLAGS: --dry-run   Show what would change without saving
 *
 * COST: ~$0.10 per run (50-60 Google Places API calls)
 * SCHEDULE: 1st of every month
 */

const fs = require('fs');
const path = require('path');

const BM_PATH = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_PLACES_API_KEY || 'AIzaSyDrtbSIA_BvJIzq1_-3pfQ_RgP2DiM_TKo';
const DRY_RUN = process.argv.includes('--dry-run');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getReviewCount(name, placeId) {
  try {
    // If we have a place_id, use it directly
    if (placeId) {
      const resp = await fetch('https://places.googleapis.com/v1/places/' + placeId, {
        headers: {
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': 'userRatingCount,rating',
        },
      });
      if (resp.ok) {
        const d = await resp.json();
        return { reviews: d.userRatingCount || 0, rating: d.rating || 0 };
      }
    }

    // Fallback to search
    const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'places.userRatingCount,places.rating',
      },
      body: JSON.stringify({ textQuery: name + ' restaurant NYC', maxResultCount: 1 }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const p = data.places?.[0];
    return p ? { reviews: p.userRatingCount || 0, rating: p.rating || 0 } : null;
  } catch { return null; }
}

async function main() {
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  📈 AGE OUT NEW & RISING RESTAURANTS`);
  console.log(`${'═'.repeat(50)}\n`);

  const master = JSON.parse(fs.readFileSync(BM_PATH, 'utf8'));

  // Find all new_rising entries
  const newRising = [];
  for (const [name, entry] of Object.entries(master)) {
    if (entry.new_rising) newRising.push({ name, entry });
  }

  console.log(`🔎 Total new_rising: ${newRising.length}`);
  if (DRY_RUN) console.log('🏃 DRY RUN — no changes will be saved\n');
  else console.log('');

  let aged = 0, updated = 0, failed = 0;

  for (let i = 0; i < newRising.length; i++) {
    const { name, entry } = newRising[i];
    process.stdout.write(`  [${(i + 1).toString().padStart(3)}/${newRising.length}] ${name.substring(0, 35).padEnd(35)} `);

    const result = await getReviewCount(name, entry.place_id);
    await sleep(250);

    if (!result) {
      failed++;
      console.log(`❌ lookup failed (was ${entry.google_reviews || '?'} rev)`);
      continue;
    }

    const oldReviews = entry.google_reviews || 0;
    const newReviews = result.reviews;
    const diff = newReviews - oldReviews;

    // Update stored values
    entry.google_reviews = newReviews;
    entry.google_rating = result.rating;
    updated++;

    if (newReviews >= 50) {
      entry.new_rising = false;
      const idx = (entry.vibe_tags || []).indexOf('new_rising');
      if (idx > -1) entry.vibe_tags.splice(idx, 1);
      aged++;
      console.log(`📈 ${oldReviews} → ${newReviews} rev (+${diff}) — AGED OUT`);
    } else {
      console.log(`${oldReviews} → ${newReviews} rev (+${diff})`);
    }
  }

  if (!DRY_RUN) {
    fs.writeFileSync(BM_PATH, JSON.stringify(master, null, 2));
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  📊 Updated: ${updated}  Aged out: ${aged}  Failed: ${failed}`);
  console.log(`  📋 Remaining new_rising: ${newRising.length - aged}`);
  console.log(`${'═'.repeat(50)}\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
