/**
 * OT Console Availability Checker
 * ================================
 * PASTE THIS ENTIRE SCRIPT into Chrome DevTools console on opentable.com
 *
 * It uses the browser's own session (cookies, CSRF) to:
 * 1. Get restaurant IDs via autocomplete
 * 2. Batch-check availability via GraphQL
 * 3. Output JSON results you can copy
 *
 * After it runs, copy the output with: copy(window.__OT_RESULTS)
 */

(async () => {
  // ─── Config ───
  const DATE = new Date().toISOString().split('T')[0];
  const TIME = '19:00';
  const PARTY_SIZE = 2;
  const BASE_HOUR = 19;
  const BATCH_SIZE = 3;
  const GQL_HASH = 'b2d05a06151b3cb21d9dfce4f021303eeba288fac347068b29c1cb66badc46af';
  const AUTOCOMPLETE_HASH = 'e2e97bcfe40cdbcbbfbef73282e6ee7e2fec886fa42b43e0b0e38e7be3d3cfce';

  // Get CSRF token from cookie or meta tag
  function getCSRF() {
    // Try meta tag
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) return meta.content;
    // Try cookie
    const match = document.cookie.match(/csrf[_-]?token=([^;]+)/i);
    if (match) return match[1];
    // Try window state
    if (window.__NEXT_DATA__?.props?.pageProps?.csrfToken) return window.__NEXT_DATA__.props.pageProps.csrfToken;
    // Fallback — try known header from OT
    return null;
  }

  // ─── Restaurants to check (slug → name mapping) ───
  const RESTAURANTS = {
    'joe-allen-reservations-new-york': 'joe allen',
    'sparks-steak-house': 'sparks steak house',
    'mikes-bistro-ues': "mike's bistro",
    'christos-steak-house': "christo's steak house",
    'sojourn-social-new-york': 'sojourn social',
    'sandros-restaurant-new-york': "sandro's",
    'robertos-restaurant-reservations-bronx': "roberto's",
    'north-fork-new-york': 'the north fork',
    'bom-new-york': 'bom',
    'bamboo-walk-brooklyn': 'bamboo walk',
    'black-tap-soho-new-york': 'black tap',
    'il-cantinori-reservations-new-york': 'il cantinori',
    'ninos-46': "nino's 46",
    'novita-new-york-city-manhattan-new-york': 'novita',
    'greca-by-the-greek-new-york': 'the greek tribeca',
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ─── Step 1: Get RIDs via autocomplete ───
  console.log(`%c[OT Checker] Starting — ${Object.keys(RESTAURANTS).length} restaurants, date: ${DATE}`, 'color: #00b894; font-weight: bold');

  async function getRid(name) {
    try {
      const res = await fetch('https://www.opentable.com/dapi/fe/gql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationName: 'Autocomplete',
          variables: { term: name, latitude: 40.7128, longitude: -74.006 },
          extensions: { persistedQuery: { version: 1, sha256Hash: AUTOCOMPLETE_HASH } }
        })
      });
      if (!res.ok) {
        console.warn(`  Autocomplete failed for "${name}": HTTP ${res.status}`);
        return null;
      }
      const json = await res.json();
      const results = json?.data?.autocomplete?.restaurants || [];
      if (results.length > 0) {
        return { rid: results[0].rid, matchedName: results[0].name, slug: results[0].urlSlug };
      }
    } catch (e) {
      console.warn(`  Autocomplete error for "${name}":`, e.message);
    }
    return null;
  }

  // Also try scraping RID from the restaurant page
  async function getRidFromPage(slug) {
    try {
      const res = await fetch(`/r/${slug}`, { credentials: 'include' });
      if (!res.ok) {
        // Try without /r/ prefix
        const res2 = await fetch(`/${slug}`, { credentials: 'include' });
        if (!res2.ok) return null;
        const html = await res2.text();
        const m = html.match(/"rid"\s*:\s*(\d+)/) || html.match(/"restaurantId"\s*:\s*(\d+)/);
        return m ? parseInt(m[1]) : null;
      }
      const html = await res.text();
      const m = html.match(/"rid"\s*:\s*(\d+)/) || html.match(/"restaurantId"\s*:\s*(\d+)/);
      return m ? parseInt(m[1]) : null;
    } catch { return null; }
  }

  // Phase 1: Collect RIDs
  const ridMap = {}; // slug → { rid, name }
  let found = 0, notFound = 0;

  for (const [slug, name] of Object.entries(RESTAURANTS)) {
    let info = await getRid(name);
    if (!info) {
      // Try page scrape fallback
      const rid = await getRidFromPage(slug);
      if (rid) info = { rid, matchedName: name, slug };
    }
    if (info) {
      ridMap[slug] = { rid: info.rid, name: info.matchedName || name };
      found++;
      console.log(`  ✓ ${name} → RID ${info.rid}`);
    } else {
      notFound++;
      console.log(`  ✗ ${name} — not found`);
    }
    await sleep(400); // don't hammer
  }

  console.log(`%c[OT Checker] Found ${found} RIDs, ${notFound} missing`, 'color: #fdcb6e');

  // ─── Step 2: Batch check availability ───
  const csrf = getCSRF();
  console.log(`%c[OT Checker] CSRF: ${csrf || 'none (will try without)'}`, 'color: #74b9ff');

  const rids = Object.entries(ridMap);
  const results = {};

  for (let i = 0; i < rids.length; i += BATCH_SIZE) {
    const batch = rids.slice(i, i + BATCH_SIZE);
    const batchRids = batch.map(([_, v]) => v.rid);
    const token = 'eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjoxLCJuIjowfQ';

    const headers = { 'Content-Type': 'application/json' };
    if (csrf) headers['x-csrf-token'] = csrf;

    try {
      const res = await fetch('https://www.opentable.com/dapi/fe/gql?optype=query&opname=RestaurantsAvailability', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          operationName: 'RestaurantsAvailability',
          variables: {
            onlyPop: false, forwardDays: 0, requireTimes: false, requireTypes: [],
            privilegedAccess: [], restaurantIds: batchRids,
            date: DATE, time: TIME, partySize: PARTY_SIZE, databaseRegion: 'NA',
            restaurantAvailabilityTokens: batchRids.map(() => token),
            slotDiscovery: batchRids.map(() => 'on'),
            loyaltyRedemptionTiers: [], attributionToken: ''
          },
          extensions: { persistedQuery: { version: 1, sha256Hash: GQL_HASH } }
        })
      });

      if (!res.ok) {
        console.warn(`  Batch ${i/BATCH_SIZE + 1} failed: HTTP ${res.status}`, await res.text());
        continue;
      }

      const json = await res.json();
      const avail = json?.data?.availability || [];

      for (let j = 0; j < batch.length; j++) {
        const [slug, info] = batch[j];
        const restaurantData = avail[j];

        if (!restaurantData?.availabilityDays?.[0]) {
          results[slug] = { name: info.name, rid: info.rid, tier: 'unknown', dinner_slots: 0, has_early: false, has_prime: false, has_late: false, sample_times: [] };
          console.log(`  ? ${info.name}: no data`);
          continue;
        }

        const day = restaurantData.availabilityDays[0];
        const slots = (day.slots || []).filter(s => s.isAvailable);
        let early = 0, prime = 0, late = 0;
        const times = [];

        for (const slot of slots) {
          const offsetMin = slot.timeOffsetMinutes || 0;
          const actualHour = BASE_HOUR + (offsetMin / 60);
          const h = Math.floor(actualHour);
          const m = Math.round((actualHour - h) * 60);
          const ampm = h >= 12 ? 'pm' : 'am';
          const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
          const timeStr = `${h12}:${String(m).padStart(2, '0')}${ampm}`;
          times.push(timeStr);

          if (actualHour >= 17 && actualHour < 18.5) early++;
          else if (actualHour >= 18.5 && actualHour < 20.5) prime++;
          else if (actualHour >= 20.5 && actualHour <= 22) late++;
        }

        const total = times.length;
        const tier = total === 0 ? 'booked' : total <= 3 ? 'limited' : 'open';

        results[slug] = {
          name: info.name,
          rid: info.rid,
          tier,
          dinner_slots: total,
          has_early: early > 0,
          has_prime: prime > 0,
          has_late: late > 0,
          sample_times: times.slice(0, 5),
          platform: 'opentable',
          checked_date: new Date().toISOString()
        };

        const icon = tier === 'booked' ? '🔴' : tier === 'limited' ? '🟡' : '🟢';
        console.log(`  ${icon} ${info.name}: ${tier} (${total} slots) ${times.slice(0, 5).join(', ')}`);
      }
    } catch (e) {
      console.error(`  Batch error:`, e);
    }

    await sleep(800);
  }

  // ─── Output ───
  window.__OT_RESULTS = results;
  console.log(`%c\n[OT Checker] Done! ${Object.keys(results).length} restaurants checked`, 'color: #00b894; font-weight: bold; font-size: 14px');
  console.log('%cCopy results with: copy(JSON.stringify(window.__OT_RESULTS, null, 2))', 'color: #a29bfe; font-style: italic');
  console.log('\nSummary:');
  const tiers = { open: 0, limited: 0, booked: 0, unknown: 0 };
  for (const r of Object.values(results)) tiers[r.tier]++;
  console.log(`  🟢 Open: ${tiers.open}  🟡 Limited: ${tiers.limited}  🔴 Booked: ${tiers.booked}  ❓ Unknown: ${tiers.unknown}`);
  console.table(Object.values(results).map(r => ({ name: r.name, tier: r.tier, slots: r.dinner_slots, times: (r.sample_times || []).join(', ') })));

  return results;
})();
