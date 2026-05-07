(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const CSRF_TOKEN = '86ece89d-d442-4445-b8c0-ba46d5af2345';
  window.OT_CSRF = CSRF_TOKEN;
  const AC_HASH = 'fe1d118abd4c227750693027c2414d43014c2493f64f49bcef5a65274ce9c3c3';
  const AVAIL_HASH = 'cbcf4838a9b399f742e3741785df64560a826d8d3cc2828aa01ab09a8455e29e';
  const TOKEN = 'eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjowLCJuIjowfQ';
  const PARTY_SIZE = 2;
  const d = new Date(); d.setDate(d.getDate() + 1);
  const DATE = d.toISOString().split('T')[0];

  const NAMES = ["Tarallucci E Vino Upper West Side", "tony's di napoli", "Lattanzi Ristorante", "nami nori", "wolfgang's steakhouse", "Aquavit Restaurant", "tastings", "kopitiam", "wildair", "San Carlo Cicchetti", "mike's bistro", "stars", "markette", "Korali Estiatorio", "seva indian cuisine", "bahari estiatorio", "PLATEIA GR", "stk - nyc downtown", "alley 41", "bayon", "cho dang gol", "Vietnaam Restaurant", "oso", "pierozek", "soba totto", "tolo", "demo", "meximodo", "mitsuru", "muku", "lydia's", "blt steak", "dos caminos", "great ny noodletown", "grand banks", "Pio Pio 8", "beija flor", "la pecora bianca bryant park", "soho park", "good guy's", "Avena", "acre", "tsion", "for all things good bedstuy", "mayfield", "wayne and sons", "sushi lin upper west side", "amy thai bistro", "cocina consuelo", "daphne's", "dept of culture", "palo santo", "naked dog", "jack jones gastropub", "chick chick", "kuku korean cuisine forest hills", "casa tulum", "tenny's", "Hao Noodle Chelsea", "ondo jersey city", "san patricios jersey city", "max soha", "terravita edgewater", "kuku korean cuisine lic", "el fish marisqueria", "purple waves", "bcd tofu house", "bison and bourbon", "domodomo jersey city", "chez oskar", "am thai bistro", "Rare Chelsea", "redwood pleasure club", "bkb | brooklyn brasserie", "roberto's"];

  console.log('[OT Batch 1] ' + NAMES.length + ' restaurants | Date: ' + DATE);

  const results = {};
  window.__OT_BATCH = results;
  let found = 0, noMatch = 0, errors = 0;

  function matchScore(search, found) {
    const c = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const sc = c(search), fc = c(found);
    if (sc === fc) return 1.0;
    if (fc.includes(sc) || sc.includes(fc)) return 0.9;
    const stop = ['the','and','restaurant','bar','grill','cafe','kitchen','nyc','new','york'];
    const sw = sc.split(' ').filter(w => w.length > 2 && !stop.includes(w));
    const fw = fc.split(' ').filter(w => w.length > 2 && !stop.includes(w));
    if (sw.length === 0) return 0;
    const overlap = sw.filter(w => fw.some(f => f.includes(w) || w.includes(f)));
    return overlap.length / sw.length;
  }

  console.log('Step 1: Finding restaurants via Autocomplete...');
  const ridMap = {};

  for (let i = 0; i < NAMES.length; i++) {
    const name = NAMES[i];
    const clean = name.replace(/\(.*?\)/g, '').replace(/[^\w\s\'&-]/g, '').replace(/\s+/g, ' ').trim();

    try {
      const res = await fetch('https://www.opentable.com/dapi/fe/gql?optype=query&opname=Autocomplete', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF_TOKEN },
        body: JSON.stringify({
          operationName: 'Autocomplete',
          variables: { term: clean, latitude: 40.7128, longitude: -74.006, useNewVersion: true },
          extensions: { persistedQuery: { version: 1, sha256Hash: AC_HASH } }
        })
      });

      if (!res.ok) {
        errors++;
        if (res.status === 403) { console.log('  \u{1f6ab} BLOCKED at ' + (i+1)); break; }
        continue;
      }

      const json = await res.json();
      const items = json?.data?.autocomplete?.autocompleteResults || [];
      const restaurants = items.filter(r => r.type === 'Restaurant' && r.metroId === 8);

      let bestMatch = null, bestScore = 0;
      for (const r of restaurants) {
        const score = matchScore(name, r.name);
        if (score > bestScore && r.id) { bestScore = score; bestMatch = { name: r.name, rid: parseInt(r.id), neighborhood: r.neighborhoodName }; }
      }

      if (bestMatch && bestScore >= 0.6) {
        ridMap[name] = bestMatch;
        found++;
        console.log('  \u{2705} [' + (i+1) + '/' + NAMES.length + '] ' + name + ' \u2192 ' + bestMatch.name + ' (rid:' + bestMatch.rid + ', ' + bestMatch.neighborhood + ')');
      } else {
        noMatch++;
      }
    } catch(e) { errors++; }

    if ((i+1) % 25 === 0) console.log('  \u{1f4be} ' + found + ' found / ' + (i+1) + ' checked');
    await sleep(800);
  }

  console.log('\nStep 1 done: ' + found + ' RIDs found');

  // Step 2: Check availability
  const entries = Object.entries(ridMap);
  if (entries.length > 0) {
    console.log('\nStep 2: Checking availability for ' + entries.length + ' restaurants...');
    const BATCH = 3, BASE_HOUR = 19;

    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      const rids = batch.map(([_,v]) => v.rid);

      try {
        const res = await fetch('https://www.opentable.com/dapi/fe/gql?optype=query&opname=RestaurantsAvailability', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF_TOKEN, 'ot-page-group': 'search', 'ot-page-type': 'multi-search', 'x-query-timeout': '4000' },
          body: JSON.stringify({ operationName: 'RestaurantsAvailability', variables: { onlyPop: false, forwardDays: 0, requireTimes: false, requireTypes: [], privilegedAccess: [], restaurantIds: rids, date: DATE, time: '19:00', partySize: PARTY_SIZE, databaseRegion: 'NA', restaurantAvailabilityTokens: rids.map(() => TOKEN), slotDiscovery: rids.map(() => 'on'), loyaltyRedemptionTiers: [], attributionToken: '' }, extensions: { persistedQuery: { version: 1, sha256Hash: AVAIL_HASH } } })
        });

        if (!res.ok) { await sleep(3000); continue; }
        const json = await res.json();
        const avail = json?.data?.availability || [];
        const byRid = {};
        for (const rd of avail) { if (rd?.restaurantId) byRid[rd.restaurantId] = rd; }

        for (const [name, info] of batch) {
          const rd = byRid[info.rid];
          if (!rd) continue;
          const slots = (rd?.availabilityDays?.[0]?.slots || []).filter(s => s.isAvailable);
          const times = [];
          for (const slot of slots) {
            const h = BASE_HOUR + (slot.timeOffsetMinutes || 0) / 60;
            const hr = Math.floor(h), mn = Math.round((h - hr) * 60);
            const ap = hr >= 12 ? 'pm' : 'am';
            const h12 = hr > 12 ? hr - 12 : hr;
            times.push(h12 + ':' + String(mn).padStart(2, '0') + ap);
          }
          results[name] = { rid: info.rid, matched_name: info.name, neighborhood: info.neighborhood, slots: times.length, times: times.slice(0, 5), bookable: times.length > 0 };
          const icon = times.length > 0 ? '\u{1f7e2}' : '\u{1f534}';
          console.log('  ' + icon + ' ' + name + ': ' + times.length + ' slots');
        }
      } catch(e) {}
      await sleep(700);
    }
  }

  window.__OT_BATCH = results;
  const bookable = Object.values(results).filter(v => v.bookable).length;
  console.log('\n' + '='.repeat(40));
  console.log('Batch 1 done! Found: ' + Object.keys(results).length + ' | Bookable: ' + bookable + ' | No match: ' + noMatch + ' | Errors: ' + errors);

  const blob = new Blob([JSON.stringify(results, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ot_batch_1.json';
  a.click();
})();