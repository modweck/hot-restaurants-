// OT Availability Check — 24 stale restaurants
(async () => {
  const DATE = '2026-04-12';
  const TIME = '19:00';
  const PARTY_SIZE = 2;
  const BATCH_SIZE = 1;
  const BASE_HOUR = 19;
  const TOKEN = 'eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjoxLCJuIjowfQ';
  const ENTRIES = [["sushi noz", 1283581], ["resident", 1100389], ["just pho you", 1425325], ["mughlai indian cuisine", 1458367], ["enso omakase", 1406629], ["the jin", 1043158], ["bustronome new york", 1377070], ["alta", 2809], ["cowgirl", 278254], ["mas (farmhouse)", 84103], ["fulton fish co.", 1357186], ["red star", 139], ["iris", 1063336], ["poke", 242224], ["the boil brooklyn", 1490755], ["contento", 1194328], ["chloe", 49144], ["gnocchi bar", 209236], ["arturo's", 237589], ["lola's", 1344301], ["casa dani", 1147633], ["cherry point", 444469], ["5th & mad", 171055], ["bill's supper club", 1371079]];

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Try to get CSRF from page if not set
  let CSRF_TOKEN = window.OT_CSRF;
  if (!CSRF_TOKEN) {
    try {
      const html = document.documentElement.innerHTML;
      const m = html.match(/"csrfToken"\s*:\s*"([0-9a-f-]{36})"/) || html.match(/x-csrf-token["']?\s*:\s*["']([0-9a-f-]{36})/i);
      if (m) CSRF_TOKEN = m[1];
    } catch {}
  }
  if (!CSRF_TOKEN) {
    console.error('No CSRF token. Set window.OT_CSRF first.');
    return;
  }

  // First, test if the GQL hash works with a single known rid
  console.log('Testing GQL endpoint...');
  const HASHES = [
    'b2d05a06151b3cb21d9dfce4f021303eeba288fac347068b29c1cb66badc46af',
    'f31e0430eb0e02a4344a0da71e6bfc0af3c14e3c65498e41b18bac7e48b3e498'
  ];

  let GQL_HASH = null;
  for (const h of HASHES) {
    try {
      const testRes = await fetch('https://www.opentable.com/dapi/fe/gql?optype=query&opname=RestaurantsAvailability', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': CSRF_TOKEN,
          'ot-page-group': 'search',
          'ot-page-type': 'search_results',
          'x-query-timeout': '4000'
        },
        body: JSON.stringify({
          operationName: 'RestaurantsAvailability',
          variables: {
            onlyPop: false, forwardDays: 0, requireTimes: false, requireTypes: [],
            privilegedAccess: [], restaurantIds: [2809],
            date: DATE, time: TIME, partySize: PARTY_SIZE, databaseRegion: 'NA',
            restaurantAvailabilityTokens: [TOKEN],
            slotDiscovery: ['on'],
            loyaltyRedemptionTiers: [], attributionToken: ''
          },
          extensions: { persistedQuery: { version: 1, sha256Hash: h } }
        })
      });
      const testJson = await testRes.json();
      console.log('Hash ' + h.substring(0,8) + '... status=' + testRes.status, JSON.stringify(testJson).substring(0, 300));
      if (testJson?.data?.availability) {
        GQL_HASH = h;
        console.log('Working hash found: ' + h.substring(0,12) + '...');
        break;
      }
    } catch(e) {
      console.log('Hash ' + h.substring(0,8) + ' failed: ' + e.message);
    }
  }

  if (!GQL_HASH) {
    // Try without persisted query
    console.log('Trying without persisted query hash...');
    try {
      const testRes = await fetch('https://www.opentable.com/dapi/fe/gql?optype=query&opname=RestaurantsAvailability', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': CSRF_TOKEN,
          'ot-page-group': 'search',
          'ot-page-type': 'search_results'
        },
        body: JSON.stringify({
          operationName: 'RestaurantsAvailability',
          variables: {
            onlyPop: false, forwardDays: 0, requireTimes: false, requireTypes: [],
            privilegedAccess: [], restaurantIds: [2809],
            date: DATE, time: TIME, partySize: PARTY_SIZE, databaseRegion: 'NA',
            restaurantAvailabilityTokens: [TOKEN],
            slotDiscovery: ['on'],
            loyaltyRedemptionTiers: [], attributionToken: ''
          }
        })
      });
      const testJson = await testRes.json();
      console.log('No-hash test: status=' + testRes.status, JSON.stringify(testJson).substring(0, 300));
    } catch(e) {
      console.log('No-hash test failed: ' + e.message);
    }
    console.error('No working GQL hash found. Copy a fresh sha256Hash from Network tab RestaurantsAvailability request.');
    return;
  }

  console.log('%c[OT Avail] Checking ' + ENTRIES.length + ' for ' + DATE + ' (1 at a time, 2s delay)', 'color: #00b894; font-weight: bold');

  const results = {};
  window.__OT_AVAIL_24 = results;
  let open = 0, limited = 0, booked = 0, errors = 0, misaligned = 0;

  for (let i = 0; i < ENTRIES.length; i += BATCH_SIZE) {
    const batch = ENTRIES.slice(i, i + BATCH_SIZE);
    const rids = batch.map(b => b[1]);

    try {
      const res = await fetch('https://www.opentable.com/dapi/fe/gql?optype=query&opname=RestaurantsAvailability', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': CSRF_TOKEN,
          'ot-page-group': 'search',
          'ot-page-type': 'search_results',
          'x-query-timeout': '4000'
        },
        body: JSON.stringify({
          operationName: 'RestaurantsAvailability',
          variables: {
            onlyPop: false, forwardDays: 0, requireTimes: false, requireTypes: [],
            privilegedAccess: [], restaurantIds: rids,
            date: DATE, time: TIME, partySize: PARTY_SIZE, databaseRegion: 'NA',
            restaurantAvailabilityTokens: rids.map(() => TOKEN),
            slotDiscovery: rids.map(() => 'on'),
            loyaltyRedemptionTiers: [], attributionToken: ''
          },
          extensions: { persistedQuery: { version: 1, sha256Hash: GQL_HASH } }
        })
      });

      if (!res.ok) {
        console.log('HTTP ' + res.status + ' for rids ' + rids.join(','));
        errors += batch.length;
        await sleep(3000);
        continue;
      }
      const json = await res.json();
      if (json.errors) {
        console.log('GQL error: ' + JSON.stringify(json.errors[0]).substring(0,200));
        errors += batch.length;
        continue;
      }
      const avail = json?.data?.availability || [];

      const byRid = {};
      for (const rd of avail) {
        const rid = rd?.restaurantId;
        if (rid) byRid[rid] = rd;
      }

      for (let j = 0; j < batch.length; j++) {
        const [name, rid] = batch[j];
        const rd = byRid[rid];
        if (!rd) { misaligned++; console.log('  no data for ' + name + ' (' + rid + ')'); continue; }

        const slots = (rd?.availabilityDays?.[0]?.slots || []).filter(s => s.isAvailable);
        const times = [];
        let earlyN = 0, primeN = 0, lateN = 0;
        for (const slot of slots) {
          const h = BASE_HOUR + (slot.timeOffsetMinutes || 0) / 60;
          const hr = Math.floor(h), mn = Math.round((h - hr) * 60);
          const ap = hr >= 12 ? 'pm' : 'am';
          const h12 = hr > 12 ? hr - 12 : hr;
          times.push(h12 + ':' + String(mn).padStart(2, '0') + ap);
          if (h >= 17 && h < 18.5) earlyN++;
          else if (h >= 18.5 && h < 20.5) primeN++;
          else lateN++;
        }

        const tier = times.length === 0 ? 'booked' : times.length <= 3 ? 'limited' : 'open';
        results[name] = { rid, tier, slots: times.length, times, early: earlyN > 0, prime: primeN > 0, late: lateN > 0, checked_date: DATE };
        if (tier === 'open') open++;
        else if (tier === 'limited') limited++;
        else booked++;
        console.log((tier === 'booked' ? '🔴' : tier === 'limited' ? '🟡' : '🟢') + ' [' + (i+j+1) + '/' + ENTRIES.length + '] ' + name + ' → ' + tier + ' (' + times.length + ' slots)');
      }
    } catch (e) {
      errors += batch.length;
      console.log('FETCH ERROR: ' + e.message);
    }
    await sleep(2000);
  }

  window.__OT_AVAIL_24 = results;
  console.log('%c[Done] 🟢' + open + ' 🟡' + limited + ' 🔴' + booked + ' ⚠️' + errors + ' 🔀' + misaligned, 'color: #00b894; font-weight: bold');

  const d = JSON.stringify(results, null, 2);
  const b = new Blob([d], {type:'application/json'});
  const x = document.createElement('a');
  x.href = URL.createObjectURL(b);
  x.download = 'ot_avail_24.json';
  x.click();
})();
