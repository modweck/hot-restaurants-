#!/usr/bin/env node
/**
 * CHECK FULLY BOOKED RESTAURANTS — FUTURE AVAILABILITY
 * =====================================================
 * For restaurants currently showing as "booked" on Resy,
 * checks +3, +5, +7, +14 days to see when they open up.
 *
 * Uses Resy API: /4/find (venue availability by date)
 *
 * Usage: node scripts/utilities/check-booked-availability.js
 * Output: data/booked_future_availability.json
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const MASTER_PATH = path.join(__dirname, '../../netlify/functions/BOOKING_MASTER.json');
const AVAIL_PATH = path.join(__dirname, '../../netlify/functions/tonight_availability.json');
const OUTPUT_PATH = path.join(__dirname, '../../data/booked_future_availability.json');

const RESY_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const RESY_TOKENS = [
  // Maurice (uid 63985206, expires 2026-05-12)
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzg2MTQ3NjIsInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.AftXW_r8qyK4ISeznluTHOkZixgN8igRuq7rrq5UwpgemUnfYa1QH-CAkA-5zQ1R7WiSCdhBfnE4zMV1d3hVDSfOAFJNc9Vvmvt4llgC-vgeRdpxodrOhQFjeqNMVlyHGZk4whOAI7INMLZbK5Q8VNtetMot6UhoVI8fnVUbYv8hrgfI',
  // Morris (uid 39817946, expires 2026-05-12)
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzg2MTQ5NjMsInVpZCI6Mzk4MTc5NDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxMzE1NzU1OTh9fQ.AXmsky0U-vLRQqISUqC8dSYaXGqowBncrAnrnAMXC5puzxK2CMNbxXB_pifLsHYDlwCLhEtqJHjUPm-CCdVlqNEtATArYR5G_xhsGRr4rktYihNQXsp_mfv9H4e2aT-A3AqKqcmKSfkrz6nlNKpDhoZoDH3T1rNmeKRCKS_3CCvCXpCy',
  // Steve (uid 64587604, expires 2026-05-12)
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzg2MTU0MTYsInVpZCI6NjQ1ODc2MDQsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTMxMzc0ODl9fQ.AJktblSpP4XaLKpb7T3oslAoie2-6qkhhQVhA5X5FpBrgRTC4Cx_rN3LpqnVl7xqj7vMDrF2nNiceT1HO11yhlhdAald2WQIKILQO1T2atd7vXCKVzlECsThePaljP8PjRd0a5w2Gc3j-9Pz2RzJ3tRf-gQEzN3tGyplCGqffJmJYzMa',
];
let tokenIndex = 0;
function getToken() {
  const token = RESY_TOKENS[tokenIndex % RESY_TOKENS.length];
  tokenIndex++;
  return token;
}

const PARTY_SIZE = 2;
const TODAY = new Date();
const OFFSETS = [3, 5, 7, 14];

function futureDate(offset) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

function extractSlug(url) {
  if (!url) return null;
  const m = url.match(/resy\.com\/cities\/[^/]+\/(?:venues\/)?([^/?#]+)/);
  return m ? m[1] : null;
}

function getVenueId(slug) {
  return new Promise(resolve => {
    const url = `https://api.resy.com/3/venue?url_slug=${slug}&location=ny`;
    https.get(url, {
      headers: {
        'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
        'X-Resy-Auth-Token': getToken(),
        'X-Resy-Universal-Auth': getToken(),
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Origin': 'https://resy.com',
        'Referer': 'https://resy.com/',
        'Accept': 'application/json',
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve(j.id?.resy || null);
        } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function checkAvailability(venueId, date) {
  return new Promise(resolve => {
    const url = `https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${date}&party_size=${PARTY_SIZE}&venue_id=${venueId}`;
    https.get(url, {
      headers: {
        'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
        'X-Resy-Auth-Token': getToken(),
        'X-Resy-Universal-Auth': getToken(),
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Origin': 'https://resy.com',
        'Referer': 'https://resy.com/',
        'Accept': 'application/json',
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        // Treat non-200 as unknown (not "no availability")
        if (res.statusCode !== 200) {
          resolve({ date, available: null, slots: 0, error: `http_${res.statusCode}`, unknown: true });
          return;
        }
        try {
          const j = JSON.parse(data);
          const slots = j.results?.venues?.[0]?.slots || [];
          if (slots.length === 0) {
            resolve({ date, available: false, slots: 0 });
            return;
          }
          // Categorize slots
          const times = slots.map(s => {
            const time = s.date?.start;
            const hour = time ? parseInt(time.split(' ')[1]?.split(':')[0] || '0') : 0;
            return { time: time || '?', type: s.config?.type || '?', hour };
          });

          const early = times.filter(t => t.hour >= 17 && t.hour < 18).length;
          const prime = times.filter(t => t.hour >= 18 && t.hour < 21).length;
          const late = times.filter(t => t.hour >= 21).length;

          resolve({
            date,
            available: true,
            slots: slots.length,
            early,
            prime,
            late,
            earliest: times[0]?.time,
            latest: times[times.length - 1]?.time,
          });
        } catch (e) { resolve({ date, available: null, slots: 0, error: e.message, unknown: true }); }
      });
    }).on('error', e => resolve({ date, available: null, slots: 0, error: e.message, unknown: true }));
  });
}

async function main() {
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'));
  const avail = JSON.parse(fs.readFileSync(AVAIL_PATH, 'utf8'));

  // Get fully booked Resy restaurants
  // Build case-insensitive master lookup
  const masterLower = {};
  for (const [k, v] of Object.entries(master)) masterLower[k.toLowerCase()] = v;

  const booked = [];
  for (const [name, data] of Object.entries(avail)) {
    if (name.startsWith('_')) continue;
    if (data.tier !== 'booked') continue;
    const entry = masterLower[name.toLowerCase()] || master[name];
    if (!entry) continue;
    if (entry.platform !== 'resy') continue;
    const url = entry.booking_url || entry.url || entry.resy_url;
    if (!url) continue;
    booked.push({ name, url, slug: extractSlug(url) });
  }

  console.log(`\n🔍 FULLY BOOKED AVAILABILITY SCANNER`);
  console.log(`${'='.repeat(60)}`);
  console.log(`📊 Fully booked Resy restaurants: ${booked.length}`);
  console.log(`📊 Checking dates: ${OFFSETS.map(o => '+' + o + 'd (' + futureDate(o) + ')').join(', ')}`);
  console.log(`📊 Party size: ${PARTY_SIZE}\n`);

  const results = {};
  let checked = 0;

  for (const restaurant of booked) {
    if (!restaurant.slug) {
      console.log(`⚠️  [${checked + 1}/${booked.length}] ${restaurant.name} — no slug`);
      checked++;
      continue;
    }

    // Get venue ID
    const venueId = await getVenueId(restaurant.slug);
    if (!venueId) {
      console.log(`⚠️  [${checked + 1}/${booked.length}] ${restaurant.name} — venue not found`);
      checked++;
      await new Promise(r => setTimeout(r, 150));
      continue;
    }

    // Check each future date — retry on errors
    const dateResults = {};
    let hasAny = false;
    let hasUnknown = false;
    for (const offset of OFFSETS) {
      const date = futureDate(offset);
      let result = await checkAvailability(venueId, date);
      // Retry once on error/unknown
      if (result.unknown) {
        await new Promise(r => setTimeout(r, 5000));
        result = await checkAvailability(venueId, date);
      }
      dateResults['+' + offset] = result;
      if (result.available) hasAny = true;
      if (result.unknown) hasUnknown = true;
      await new Promise(r => setTimeout(r, 150));
    }

    results[restaurant.name] = {
      slug: restaurant.slug,
      venueId,
      hasAnyAvailability: hasAny,
      hasUnknown,
      dates: dateResults,
    };

    checked++;
    const status = hasAny ? '✅' : hasUnknown ? '❓' : '🔒';
    const summary = OFFSETS.map(o => {
      const d = dateResults['+' + o];
      return '+' + o + ':' + (d.available ? d.slots + ' slots' : d.unknown ? 'ERR' : '—');
    }).join(' | ');
    console.log(`${status} [${checked}/${booked.length}] ${restaurant.name} → ${summary}`);

    // Save progress every 25
    if (checked % 25 === 0) {
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ checked_at: new Date().toISOString(), results }, null, 2));
    }
  }

  // Final save
  const output = {
    checked_at: new Date().toISOString(),
    party_size: PARTY_SIZE,
    dates_checked: OFFSETS.map(o => ({ offset: '+' + o, date: futureDate(o) })),
    total_checked: checked,
    results,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  // Summary
  const withAvail = Object.values(results).filter(r => r.hasAnyAvailability).length;
  const unknown = Object.values(results).filter(r => !r.hasAnyAvailability && r.hasUnknown).length;
  const fullyLocked = Object.values(results).filter(r => !r.hasAnyAvailability && !r.hasUnknown).length;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 RESULTS:`);
  console.log(`  ✅ Opens up within 14 days: ${withAvail}`);
  console.log(`  🔒 Fully locked (no slots at all): ${fullyLocked}`);

  // Show which dates have most availability
  for (const offset of OFFSETS) {
    const count = Object.values(results).filter(r => r.dates?.['+' + offset]?.available).length;
    console.log(`  +${offset} days (${futureDate(offset)}): ${count} restaurants have slots`);
  }

  console.log(`${'='.repeat(60)}`);
  console.log(`\nResults saved to ${OUTPUT_PATH}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
