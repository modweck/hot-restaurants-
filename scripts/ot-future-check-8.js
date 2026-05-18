(async () => {
  const TIME = '19:00';
  const PARTY_SIZE = 2;
  const GQL_HASH = 'cbcf4838a9b399f742e3741785df64560a826d8d3cc2828aa01ab09a8455e29e';
  const BATCH_SIZE = 3;
  const BASE_HOUR = 19;
  const TOKEN = 'eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjowLCJuIjowfQ';
  const CSRF_TOKEN = '27d6c8a8-50af-4660-9b45-5b0731d5ebaa';
  window.OT_CSRF = CSRF_TOKEN;

  const ENTRIES = [["nobu next door", 4528], ["lady mendl's", 96886], ["caf\u00e9 mars", 1278811], ["Pranakhon Thai Restaurant", 1275997], ["the archer", 275144], ["madame", 1295464], ["Maz Mezcal", 225757], ["Village Taverna", 187549]];
  const DATES = ["2026-05-09", "2026-05-10", "2026-05-14", "2026-05-21", "2026-05-28"];
  const OFFSETS = [2, 3, 7, 14, 21];

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  console.log('[OT Future Check] ' + ENTRIES.length + ' restaurants x ' + DATES.length + ' dates');

  const results = {};
  window.__OT_FUTURE8 = results;

  for (let d = 0; d < DATES.length; d++) {
    const DATE = DATES[d];
    console.log('\n📅 Checking ' + DATE + ' (+' + OFFSETS[d] + 'd)...');

    for (let i = 0; i < ENTRIES.length; i += BATCH_SIZE) {
      const batch = ENTRIES.slice(i, i + BATCH_SIZE);
      const rids = batch.map(b => b[1]);

      try {
        const res = await fetch('https://www.opentable.com/dapi/fe/gql?optype=query&opname=RestaurantsAvailability', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF_TOKEN, 'ot-page-group': 'search', 'ot-page-type': 'multi-search', 'x-query-timeout': '4000' },
          body: JSON.stringify({ operationName: 'RestaurantsAvailability', variables: { onlyPop: false, forwardDays: 0, requireTimes: false, requireTypes: [], privilegedAccess: [], restaurantIds: rids, date: DATE, time: TIME, partySize: PARTY_SIZE, databaseRegion: 'NA', restaurantAvailabilityTokens: rids.map(() => TOKEN), slotDiscovery: rids.map(() => 'on'), loyaltyRedemptionTiers: [], attributionToken: '' }, extensions: { persistedQuery: { version: 1, sha256Hash: GQL_HASH } } })
        });

        if (!res.ok) { await sleep(3000); continue; }
        const json = await res.json();
        const avail = json?.data?.availability || [];
        const byRid = {};
        for (const rd of avail) { const rid = rd?.restaurantId; if (rid) byRid[rid] = rd; }

        for (let j = 0; j < batch.length; j++) {
          const [name, rid] = batch[j];
          const rd = byRid[rid];
          if (!rd) continue;

          const slots = (rd?.availabilityDays?.[0]?.slots || []).filter(s => s.isAvailable);
          if (slots.length > 0) {
            if (!results[name]) results[name] = { rid, opens_in: null, dates: {} };
            const times = [];
            for (const slot of slots) {
              const h = BASE_HOUR + (slot.timeOffsetMinutes || 0) / 60;
              const hr = Math.floor(h), mn = Math.round((h - hr) * 60);
              const ap = hr >= 12 ? 'pm' : 'am';
              const h12 = hr > 12 ? hr - 12 : hr;
              times.push(h12 + ':' + String(mn).padStart(2, '0') + ap);
            }
            results[name].dates[DATE] = { slots: times.length, times: times.slice(0, 5) };
            if (!results[name].opens_in) results[name].opens_in = OFFSETS[d];
            console.log('  \u{1f7e2} ' + name + ': ' + times.length + ' slots');
          }
        }
      } catch (e) {}
      await sleep(700);
    }
  }

  const locked = ENTRIES.filter(([n]) => !results[n]).map(([n]) => n);
  console.log('\n' + '='.repeat(40));
  console.log('Opens up: ' + Object.keys(results).length);
  console.log('Locked: ' + locked.length + ' → ' + locked.join(', '));
  window.__OT_FUTURE8 = results;

  const blob = new Blob([JSON.stringify(results, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ot_future_8.json';
  a.click();
})();