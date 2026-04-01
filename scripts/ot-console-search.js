/**
 * OT Console Search Approach — SIMPLER
 * =====================================
 * PASTE THIS into Chrome DevTools on opentable.com
 *
 * Instead of GraphQL, this fetches the SEARCH RESULTS page
 * which already shows time slots per restaurant.
 * Uses internal Next.js data endpoint that returns JSON.
 *
 * After it runs, copy with: copy(window.__OT_RESULTS)
 */

(async () => {
  const DATE = new Date().toISOString().split('T')[0];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const NAMES = [
    'joe allen', 'sparks steak house', "mike's bistro", "christo's steak house",
    'sojourn social', "sandro's", "roberto's bronx", 'the north fork',
    'bom nyc', 'bamboo walk brooklyn', 'black tap soho', 'il cantinori',
    "nino's 46", 'novita nyc', 'the greek tribeca'
  ];

  console.log(`%c[OT Search] Testing ${NAMES.length} restaurants — ${DATE}`, 'color: #00b894; font-weight: bold');

  const results = {};

  // Method A: Try the Next.js JSON data route (_next/data)
  // First, get the build ID from __NEXT_DATA__
  let buildId = null;
  try {
    buildId = window.__NEXT_DATA__?.buildId;
    console.log('Build ID:', buildId);
  } catch {}

  // Method B: Try the search page and parse the response
  for (const name of NAMES) {
    try {
      const searchUrl = `/s?term=${encodeURIComponent(name)}&dateTime=${DATE}T19%3A00%3A00&covers=2&metroId=8`;

      // Fetch as HTML and parse
      const res = await fetch(searchUrl, { credentials: 'include' });
      const html = await res.text();

      // Parse __NEXT_DATA__ from the search results page
      const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
      if (nextMatch) {
        const nextData = JSON.parse(nextMatch[1]);

        // The search results are typically in pageProps
        const pageProps = nextData?.props?.pageProps;
        const searchData = pageProps?.searchData || pageProps?.initialState?.searchResults || pageProps;

        // Try to find restaurant results
        const restaurants = searchData?.restaurants ||
          searchData?.searchResult?.restaurants ||
          pageProps?.restaurants ||
          [];

        if (restaurants.length > 0) {
          const match = restaurants[0]; // best match
          const slots = match?.availability?.timeSlots ||
            match?.timeslots ||
            match?.slots ||
            [];

          results[name] = {
            name: match.name || name,
            rid: match.rid || match.restaurantId,
            slug: match.profileLink || match.urlSlug,
            slots: slots.length,
            times: slots.map(s => s.time || s.dateTime || s).slice(0, 5),
            raw_keys: Object.keys(match).join(', ')
          };
          console.log(`  ✓ ${name}: ${slots.length} slots`, match.name);
        } else {
          // Dump what keys ARE available so we can find the data
          const keys = Object.keys(pageProps || {});
          console.log(`  ? ${name}: no restaurants array. pageProps keys:`, keys.join(', '));
          results[name] = { found: false, pageProps_keys: keys };
        }
      } else {
        console.log(`  ✗ ${name}: no __NEXT_DATA__ in response (status: ${res.status})`);
      }
    } catch (e) {
      console.log(`  ✗ ${name}: ${e.message}`);
    }
    await sleep(1500); // slower since we're loading full pages
  }

  window.__OT_RESULTS = results;
  console.log(`%c\n[OT Search] Done! Check results above`, 'color: #00b894; font-weight: bold');
  console.log('%cCopy with: copy(JSON.stringify(window.__OT_RESULTS, null, 2))', 'color: #a29bfe');
  return results;
})();
