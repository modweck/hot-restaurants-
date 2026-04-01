#!/usr/bin/env node
/**
 * AUTO VIBE TAGGER
 * ================
 * Uses Google Places API editorial_summary + reviews to determine vibe tags.
 * Assigns confidence: high, medium, low.
 *
 * Usage: node scripts/utilities/auto-vibe-tags.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const MASTER_PATH = path.join(__dirname, '../../netlify/functions/BOOKING_MASTER.json');
const OUTPUT_PATH = path.join(__dirname, '../../data/auto_vibe_results.json');
const API_KEY = 'AIzaSyDrtbSIA_BvJIzq1_-3pfQ_RgP2DiM_TKo';

// Vibe keyword mappings — each vibe has strong and weak signals
const VIBE_SIGNALS = {
  date_night: {
    strong: ['romantic', 'date night', 'intimate', 'candlelit', 'candle-lit', 'cozy dinner', 'perfect for a date', 'anniversary'],
    weak: ['dim lighting', 'quiet', 'wine list', 'elegant', 'charming', 'lovely ambiance', 'beautiful interior'],
  },
  upscale: {
    strong: ['upscale', 'fine dining', 'luxury', 'high-end', 'white tablecloth', 'tasting menu', 'prix fixe', 'michelin'],
    weak: ['elegant', 'sophisticated', 'refined', 'impeccable service', 'exquisite', 'splurge'],
  },
  lively: {
    strong: ['lively', 'loud', 'energetic', 'buzzing', 'packed', 'party', 'high energy', 'vibrant scene'],
    weak: ['crowded', 'bustling', 'noisy', 'happening', 'fun atmosphere', 'festive'],
  },
  chill: {
    strong: ['chill', 'laid-back', 'relaxed', 'low-key', 'easygoing', 'mellow'],
    weak: ['casual vibe', 'unpretentious', 'no frills', 'comfortable', 'cozy'],
  },
  trendy: {
    strong: ['trendy', 'hip', 'stylish', 'cool spot', 'instagram', 'influencer', 'hottest', 'buzzy'],
    weak: ['modern', 'sleek', 'chic', 'design-forward', 'aesthetic', 'new opening'],
  },
  brunch: {
    strong: ['brunch', 'bottomless mimosa', 'eggs benedict', 'sunday brunch', 'weekend brunch', 'brunch menu'],
    weak: ['breakfast', 'morning', 'pancakes', 'avocado toast', 'bloody mary'],
  },
  outdoor: {
    strong: ['outdoor seating', 'patio', 'rooftop', 'sidewalk cafe', 'garden seating', 'terrace', 'al fresco'],
    weak: ['outdoor', 'outside', 'open air', 'backyard'],
  },
  late_night: {
    strong: ['late night', 'late-night', 'open late', 'after midnight', 'night owl', '2am', '3am', '4am'],
    weak: ['late hours', 'open until', 'post-theater', 'after hours'],
  },
  casual: {
    strong: ['casual', 'come as you are', 'no dress code', 'counter service', 'fast casual', 'grab and go'],
    weak: ['relaxed dress', 'informal', 'neighborhood spot', 'everyday', 'quick bite'],
  },
  hidden_gem: {
    strong: ['hidden gem', 'under the radar', 'best kept secret', 'hole in the wall', 'tucked away', 'speakeasy'],
    weak: ['off the beaten path', 'locals only', 'underrated', 'undiscovered', 'quiet gem'],
  },
  foodie: {
    strong: ['foodie', 'culinary', 'chef-driven', 'tasting menu', 'omakase', 'farm to table', 'innovative'],
    weak: ['creative menu', 'unique dishes', 'elevated', 'artisan', 'craft', 'seasonal menu'],
  },
  group_friendly: {
    strong: ['large group', 'group dining', 'family style', 'big table', 'party room', 'private dining', 'communal'],
    weak: ['great for groups', 'shareable', 'sharing plates', 'big parties', 'celebration'],
  },
};

function getPlaceDetails(placeId) {
  return new Promise(resolve => {
    const url = '/maps/api/place/details/json?place_id=' + placeId +
      '&fields=editorial_summary,reviews&key=' + API_KEY;
    https.get({ hostname: 'maps.googleapis.com', path: url }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).result || null); }
        catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function analyzeVibes(text) {
  const lower = text.toLowerCase();
  const results = {};

  for (const [vibe, signals] of Object.entries(VIBE_SIGNALS)) {
    let strongHits = 0, weakHits = 0;

    for (const keyword of signals.strong) {
      if (lower.includes(keyword)) strongHits++;
    }
    for (const keyword of signals.weak) {
      if (lower.includes(keyword)) weakHits++;
    }

    if (strongHits >= 2) {
      results[vibe] = { confidence: 'high', strongHits, weakHits };
    } else if (strongHits >= 1) {
      results[vibe] = { confidence: weakHits >= 1 ? 'high' : 'medium', strongHits, weakHits };
    } else if (weakHits >= 2) {
      results[vibe] = { confidence: 'medium', strongHits, weakHits };
    } else if (weakHits >= 1) {
      results[vibe] = { confidence: 'low', strongHits, weakHits };
    }
  }

  return results;
}

// Also infer vibes from structured data
function inferFromData(entry) {
  const vibes = {};
  const price = entry.price || 0;
  const cuisine = (entry.cuisine || '').toLowerCase();
  const rating = entry.google_rating || 0;
  const reviews = entry.google_reviews || 0;
  const michelin = entry.michelin_recommended || entry.michelin_stars;

  // Price-based
  if (price >= 4) vibes.upscale = { confidence: 'medium', reason: 'price $$$$' };
  if (price >= 3 && rating >= 4.5) vibes.date_night = { confidence: 'low', reason: 'price $$$ + high rating' };

  // Cuisine-based
  if (cuisine.includes('brunch') || cuisine.includes('breakfast')) vibes.brunch = { confidence: 'medium', reason: 'cuisine' };
  if (cuisine.includes('omakase') || cuisine.includes('sushi')) vibes.foodie = { confidence: 'low', reason: 'cuisine' };

  // Michelin
  if (michelin) {
    vibes.foodie = { confidence: 'high', reason: 'michelin' };
    vibes.upscale = { confidence: 'medium', reason: 'michelin' };
  }

  // Low reviews + high rating = hidden gem
  if (reviews < 300 && rating >= 4.5) vibes.hidden_gem = { confidence: 'low', reason: 'low reviews + high rating' };

  return vibes;
}

async function main() {
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'));

  // Find restaurants 4.2+ without vibe tags
  const toCheck = [];
  for (const [name, entry] of Object.entries(master)) {
    if ((entry.google_rating || 0) < 4.2) continue;
    if (entry.vibe_tags && entry.vibe_tags.length > 0) continue;
    if (!entry.place_id) continue;
    toCheck.push({ name, placeId: entry.place_id, entry });
  }

  console.log(`\n🎯 AUTO VIBE TAGGER`);
  console.log(`${'='.repeat(60)}`);
  console.log(`📊 To check: ${toCheck.length} restaurants (4.2+ rating, no vibes)\n`);

  const results = { high: [], medium: [], low: [] };
  let checked = 0, tagged = 0;

  for (const item of toCheck) {
    const details = await getPlaceDetails(item.placeId);

    let allText = '';
    if (details?.editorial_summary?.overview) {
      allText += details.editorial_summary.overview + ' ';
    }
    if (details?.reviews) {
      for (const review of details.reviews) {
        allText += (review.text || '') + ' ';
      }
    }

    // Analyze from reviews + editorial
    const reviewVibes = analyzeVibes(allText);
    // Infer from structured data
    const dataVibes = inferFromData(item.entry);

    // Merge — review analysis takes priority
    const merged = { ...dataVibes };
    for (const [vibe, info] of Object.entries(reviewVibes)) {
      if (!merged[vibe] || info.confidence === 'high' ||
        (info.confidence === 'medium' && merged[vibe].confidence !== 'high')) {
        merged[vibe] = info;
      }
    }

    if (Object.keys(merged).length > 0) {
      // Pick top vibes (high confidence first, then medium)
      const highVibes = Object.entries(merged).filter(([_, v]) => v.confidence === 'high').map(([k]) => k);
      const medVibes = Object.entries(merged).filter(([_, v]) => v.confidence === 'medium').map(([k]) => k);
      const lowVibes = Object.entries(merged).filter(([_, v]) => v.confidence === 'low').map(([k]) => k);

      // Assign: all high + medium, skip low unless nothing else
      let assignedVibes = [...highVibes, ...medVibes];
      let confidence = highVibes.length > 0 ? 'high' : 'medium';

      if (assignedVibes.length === 0 && lowVibes.length > 0) {
        assignedVibes = lowVibes.slice(0, 2);
        confidence = 'low';
      }

      if (assignedVibes.length > 0) {
        // Cap at 4 vibes max
        assignedVibes = assignedVibes.slice(0, 4);
        master[item.name].vibe_tags = assignedVibes;
        tagged++;

        results[confidence].push({ name: item.name, vibes: assignedVibes, confidence });

        const icon = confidence === 'high' ? '🟢' : confidence === 'medium' ? '🟡' : '🔴';
        process.stdout.write(`${icon} [${checked + 1}/${toCheck.length}] ${item.name} → ${assignedVibes.join(', ')} (${confidence})\n`);
      }
    }

    checked++;
    if (checked % 100 === 0) {
      console.log(`  💾 Progress: ${checked}/${toCheck.length} (${tagged} tagged)`);
      fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2));
    }

    await new Promise(r => setTimeout(r, 50));
  }

  // Final save
  fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2));
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 RESULTS:`);
  console.log(`  🟢 High confidence: ${results.high.length}`);
  console.log(`  🟡 Medium confidence: ${results.medium.length}`);
  console.log(`  🔴 Low confidence: ${results.low.length}`);
  console.log(`  Total tagged: ${tagged}/${toCheck.length}`);
  console.log(`${'='.repeat(60)}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
