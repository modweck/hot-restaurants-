(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const CSRF_TOKEN = '27d6c8a8-50af-4660-9b45-5b0731d5ebaa';
  window.OT_CSRF = CSRF_TOKEN;
  const GQL_HASH = 'cbcf4838a9b399f742e3741785df64560a826d8d3cc2828aa01ab09a8455e29e';
  const TOKEN = 'eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjowLCJuIjowfQ';
  const PARTY_SIZE = 2;
  const BASE_HOUR = 19;

  // Check tomorrow AND +3 AND +7
  const dates = [];
  for (const offset of [1, 3, 7]) {
    const d = new Date(); d.setDate(d.getDate() + offset);
    dates.push({date: d.toISOString().split('T')[0], offset});
  }

  const ENTRIES = [["brass", 1331476], ["d garden", 1255381], ["la dong", 1390435], ["kabawa", 1412569], ["capt loui cajun seafood boil", 1458868], ["villa erasamo", 1464163], ["don giovanni ristorante", 238453], ["max", 64861], ["one star", 1323247], ["geisha asian fusion", 1436707], ["chateau yaffa", 1373656], ["the vintage tea", 1355557], ["the otter", 1386088], ["The Butcher And Bottle", 987040], ["Caliente Cab Co.", 254017], ["RT 60", 1246570], ["Jaba", 1423975], ["Fine & Rare", 100438], ["INDAY All Day", 1370200], ["GOSHT Steakhouse", 1272238], ["siren restaurant and bar", 1329493], ["una pizza napoletana", 1283803], ["the loyal", 984976], ["Yakar Kosher Steakhouse", 1141900], ["n\u00e9o restaurant", 1415839]];
  const BATCH_SIZE = 3;

  console.log('[OT Avail Check] ' + ENTRIES.length + ' restaurants x ' + dates.length + ' dates');

  const results = {};
  window.__OT_VERIFY = results;

  for (const {date, offset} of dates) {
    console.log('\n📅 ' + date + ' (+' + offset + 'd)');

    for (let i = 0; i < ENTRIES.length; i += BATCH_SIZE) {
      const batch = ENTRIES.slice(i, i + BATCH_SIZE);
      const rids = batch.map(b => b[1]);

      try {
        const res = await fetch('https://www.opentable.com/dapi/fe/gql?optype=query&opname=RestaurantsAvailability', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF_TOKEN, 'ot-page-group': 'search', 'ot-page-type': 'multi-search', 'x-query-timeout': '4000' },
          body: JSON.stringify({ operationName: 'RestaurantsAvailability', variables: { onlyPop: false, forwardDays: 0, requireTimes: false, requireTypes: [], privilegedAccess: [], restaurantIds: rids, date: date, time: '19:00', partySize: PARTY_SIZE, databaseRegion: 'NA', restaurantAvailabilityTokens: rids.map(() => TOKEN), slotDiscovery: rids.map(() => 'on'), loyaltyRedemptionTiers: [], attributionToken: '' }, extensions: { persistedQuery: { version: 1, sha256Hash: GQL_HASH } } })
        });

        if (!res.ok) { await sleep(3000); continue; }
        const json = await res.json();
        const avail = json?.data?.availability || [];
        const byRid = {};
        for (const rd of avail) { if (rd?.restaurantId) byRid[rd.restaurantId] = rd; }

        for (const [name, rid] of batch) {
          const rd = byRid[rid];
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

          if (!results[name]) results[name] = { rid, dates: {} };
          results[name].dates['+' + offset + 'd'] = { date, slots: times.length, times: times.slice(0, 5) };
          if (times.length > 0) {
            console.log('  \u{1f7e2} ' + name + ': ' + times.length + ' slots');
          }
        }
      } catch(e) {}
      await sleep(700);
    }
  }

  // Summary
  window.__OT_VERIFY = results;
  let real = 0, dead = 0;
  for (const [name, info] of Object.entries(results)) {
    const anySlots = Object.values(info.dates).some(d => d.slots > 0);
    results[name].is_real = anySlots;
    if (anySlots) real++; else dead++;
  }
  console.log('\n' + '='.repeat(40));
  console.log('Real (has slots on any date): ' + real);
  console.log('Dead (no slots anywhere): ' + dead);

  const blob = new Blob([JSON.stringify(results, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ot_verify_25.json';
  a.click();
})();