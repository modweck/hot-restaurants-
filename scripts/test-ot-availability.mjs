#!/usr/bin/env node
/**
 * Test different OpenTable availability approaches (no auth)
 * Goal: find a method that returns time slots without cookies/login
 */

const SLUGS = [
  'the-odeon',
  'frenchette-new-york',
  'nobu-downtown-new-york',
  'la-grande-boucherie-new-york',
  'soothr-new-york',
  '886-new-york',
  'momofuku-noodle-bar-new-york',
  'san-sabino-reservations-new-york',
  'serafina-tribeca-new-york',
  'serafina-osteria-new-york',
  'peking-duck-house-new-york',
  'nobu-next-door',
  'center-bar-new-york',
  'balthazar-new-york',
  'carbone-new-york',
];

const DATE = new Date().toISOString().split('T')[0]; // today
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Referer': 'https://www.opentable.com/',
  'Origin': 'https://www.opentable.com',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Method 1: Autocomplete API (get RIDs) ───
async function getRid(slug) {
  const name = slug.replace(/-new-york$/, '').replace(/-/g, ' ');
  const vars = JSON.stringify({ term: name, latitude: 40.7128, longitude: -74.006, useNewVersion: true });
  const url = `https://www.opentable.com/dapi/fe/gql?operation=Autocomplete&variables=${encodeURIComponent(vars)}`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    const json = await res.json();
    const restaurants = json?.data?.autocomplete?.restaurants || [];
    if (restaurants.length > 0) {
      return { rid: restaurants[0].rid, name: restaurants[0].name, slug: restaurants[0].urlSlug || slug };
    }
  } catch (e) { /* silent */ }
  return null;
}

// ─── Method 2: /dapi/availability?rid=... (direct REST) ───
async function method_dapi_availability(rid) {
  const url = `https://www.opentable.com/dapi/availability?rid=${rid}&partySize=2&dateTime=${DATE}T19:00&enableFutureAvailability=true`;
  const res = await fetch(url, { headers: HEADERS });
  const text = await res.text();
  return { status: res.status, length: text.length, snippet: text.substring(0, 500) };
}

// ─── Method 3: /dapi/fe/gql/availability/restaurant/{slug} ───
async function method_gql_slug(slug) {
  const url = `https://www.opentable.com/dapi/fe/gql/availability/restaurant/${slug}?date=${DATE}&partySize=2&time=19:00`;
  const res = await fetch(url, { headers: HEADERS });
  const text = await res.text();
  return { status: res.status, length: text.length, snippet: text.substring(0, 500) };
}

// ─── Method 4: /restref/client widget ───
async function method_widget(rid) {
  const url = `https://www.opentable.com/restref/client?rid=${rid}&datetime=${DATE}T19%3A00&covers=2&lang=en-US&r3uid=`;
  const res = await fetch(url, { headers: { ...HEADERS, Accept: 'text/html' } });
  const text = await res.text();
  // Look for time patterns
  const times = text.match(/(\d{1,2}:\d{2}\s*(AM|PM))/gi) || [];
  return { status: res.status, length: text.length, times, snippet: text.substring(0, 500) };
}

// ─── Method 5: GraphQL POST autocomplete with availability ───
async function method_gql_post_autocomplete(name) {
  const url = 'https://www.opentable.com/dapi/fe/gql';
  const body = {
    operationName: 'Autocomplete',
    variables: { term: name, latitude: 40.7128, longitude: -74.006 },
    extensions: { persistedQuery: { version: 1, sha256Hash: 'e2e97bcfe40cdbcbbfbef73282e6ee7e2fec886fa42b43e0b0e38e7be3d3cfce' } }
  };
  const res = await fetch(url, { method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, length: text.length, snippet: text.substring(0, 500) };
}

// ─── Method 6: Restaurant page __NEXT_DATA__ scrape ───
async function method_page_scrape(slug) {
  const url = `https://www.opentable.com/r/${slug}?date=${DATE}&partySize=2&time=19:00`;
  const res = await fetch(url, { headers: { ...HEADERS, Accept: 'text/html' } });
  const text = await res.text();
  // Look for __NEXT_DATA__
  const nextDataMatch = text.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  let availInfo = null;
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      // Try to find availability in the data
      availInfo = JSON.stringify(nextData).substring(0, 1000);
    } catch {}
  }
  // Also look for time slots in HTML
  const times = text.match(/(\d{1,2}:\d{2}\s*(AM|PM))/gi) || [];
  const hasAvail = text.includes('availab') || text.includes('time-slot') || text.includes('timeslot');
  return { status: res.status, length: text.length, hasNextData: !!nextDataMatch, times, hasAvailKeyword: hasAvail, nextDataSnippet: availInfo?.substring(0, 300) };
}

// ─── Method 7: booking-availability API (seen on some OT pages) ───
async function method_booking_availability(rid) {
  const url = `https://www.opentable.com/booking/availability?rid=${rid}&date=${DATE}&partySize=2&time=19:00`;
  const res = await fetch(url, { headers: HEADERS });
  const text = await res.text();
  return { status: res.status, length: text.length, snippet: text.substring(0, 500) };
}

// ─── Method 8: mobile/experience API ───
async function method_mobile_api(rid) {
  const url = `https://mobile.opentable.com/api/v2/restaurant/${rid}/availability?date=${DATE}&time=19:00&partySize=2`;
  const res = await fetch(url, { headers: HEADERS });
  const text = await res.text();
  return { status: res.status, length: text.length, snippet: text.substring(0, 500) };
}

// ─── Run all methods ───
async function main() {
  console.log(`Testing OT availability methods — ${DATE}\n`);

  // Phase 1: Get RIDs via autocomplete
  console.log('=== Phase 1: Getting RIDs via autocomplete ===\n');
  const restaurants = [];
  for (const slug of SLUGS) {
    const info = await getRid(slug);
    if (info) {
      console.log(`  ✓ ${info.name} → RID: ${info.rid}`);
      restaurants.push({ ...info, originalSlug: slug });
    } else {
      console.log(`  ✗ ${slug} — not found`);
    }
    await sleep(300);
  }

  console.log(`\nFound ${restaurants.length} restaurants with RIDs\n`);
  if (restaurants.length === 0) { console.log('Autocomplete API may be blocked. Exiting.'); return; }

  // Phase 2: Test each method on first 3 restaurants
  const testSet = restaurants.slice(0, 3);

  const methods = [
    { name: 'dapi/availability (REST)', fn: (r) => method_dapi_availability(r.rid), needsRid: true },
    { name: 'gql/availability/restaurant/{slug}', fn: (r) => method_gql_slug(r.slug), needsRid: false },
    { name: 'restref/client widget', fn: (r) => method_widget(r.rid), needsRid: true },
    { name: 'GraphQL POST autocomplete', fn: (r) => method_gql_post_autocomplete(r.name), needsRid: false },
    { name: 'Page scrape (__NEXT_DATA__)', fn: (r) => method_page_scrape(r.slug), needsRid: false },
    { name: 'booking/availability', fn: (r) => method_booking_availability(r.rid), needsRid: true },
    { name: 'mobile API', fn: (r) => method_mobile_api(r.rid), needsRid: true },
  ];

  for (const method of methods) {
    console.log(`\n=== Method: ${method.name} ===`);
    for (const r of testSet) {
      try {
        const result = await method.fn(r);
        const hasData = result.length > 100;
        const icon = result.status === 200 ? '✓' : '✗';
        console.log(`  ${icon} ${r.name}: status=${result.status} len=${result.length}`);
        if (result.times?.length > 0) console.log(`    🕐 TIMES FOUND: ${result.times.join(', ')}`);
        if (result.hasNextData) console.log(`    📦 Has __NEXT_DATA__`);
        if (result.hasAvailKeyword) console.log(`    🔍 Has availability keywords`);
        if (result.snippet && result.status === 200 && result.length < 2000) {
          console.log(`    snippet: ${result.snippet.substring(0, 200)}`);
        }
      } catch (e) {
        console.log(`  ✗ ${r.name}: ERROR — ${e.message}`);
      }
      await sleep(500);
    }
  }

  // Phase 3: If any method works well, test on all 15
  console.log('\n\n=== Phase 3: Full test of most promising methods on all restaurants ===');
  console.log('(Review Phase 2 results above to determine which methods to scale)\n');

  // Test page scrape on all since it's most likely to have data
  console.log('--- Testing page scrape on all restaurants ---');
  for (const r of restaurants) {
    try {
      const result = await method_page_scrape(r.slug);
      const icon = result.times.length > 0 ? '🟢' : (result.hasNextData ? '🟡' : '🔴');
      console.log(`  ${icon} ${r.name}: times=[${result.times.join(', ')}] nextData=${result.hasNextData} availKeywords=${result.hasAvailKeyword}`);
    } catch (e) {
      console.log(`  🔴 ${r.name}: ${e.message}`);
    }
    await sleep(500);
  }
}

main().catch(console.error);
