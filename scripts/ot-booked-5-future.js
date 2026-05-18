(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const CSRF_TOKEN = '86ece89d-d442-4445-b8c0-ba46d5af2345';
  const GQL_HASH = 'cbcf4838a9b399f742e3741785df64560a826d8d3cc2828aa01ab09a8455e29e';
  const TOKEN = 'eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjowLCJuIjowfQ';
  const PARTY_SIZE = 2;
  const BASE_HOUR = 19;
  const ENTRIES = [["mike's bistro", 144154], ["muku", 1311958], ["red hook tavern", 1048522], ["bar kabawa", 1387021], ["Sushi by Bou Fins and Scales", 1220323]];
  const DATES = ["2026-05-10", "2026-05-14", "2026-05-17"];
  const OFFSETS = [3, 7, 10];

  console.log('[OT Future Check] ' + ENTRIES.length + ' restaurants x ' + DATES.length + ' dates');
  const results = {};

  for (let d = 0; d < DATES.length; d++) {
    const DATE = DATES[d];
    console.log('\n📅 ' + DATE + ' (+' + OFFSETS[d] + 'd)');
    const rids = ENTRIES.map(e => e[1]);

    try {
      const res = await fetch('https://www.opentable.com/dapi/fe/gql?optype=query&opname=RestaurantsAvailability', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF_TOKEN, 'ot-page-group': 'search', 'ot-page-type': 'multi-search', 'x-query-timeout': '4000' },
        body: JSON.stringify({ operationName: 'RestaurantsAvailability', variables: { onlyPop: false, forwardDays: 0, requireTimes: false, requireTypes: [], privilegedAccess: [], restaurantIds: rids, date: DATE, time: '19:00', partySize: PARTY_SIZE, databaseRegion: 'NA', restaurantAvailabilityTokens: rids.map(() => TOKEN), slotDiscovery: rids.map(() => 'on'), loyaltyRedemptionTiers: [], attributionToken: '' }, extensions: { persistedQuery: { version: 1, sha256Hash: GQL_HASH } } })
      });

      if (!res.ok) { console.log('Error: ' + res.status); continue; }
      const json = await res.json();
      const avail = json?.data?.availability || [];
      const byRid = {};
      for (const rd of avail) { if (rd?.restaurantId) byRid[rd.restaurantId] = rd; }

      for (const [name, rid] of ENTRIES) {
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
        results[name].dates['+' + OFFSETS[d] + 'd'] = { date: DATE, slots: times.length, times: times.slice(0, 5) };
        const icon = times.length > 0 ? '🟢' : '🔴';
        console.log('  ' + icon + ' ' + name + ': ' + times.length + ' slots');
      }
    } catch(e) { console.log('Error: ' + e); }
    await sleep(700);
  }

  console.log('\n' + '='.repeat(40));
  for (const [name, info] of Object.entries(results)) {
    const any = Object.values(info.dates).some(d => d.slots > 0);
    console.log((any ? '🟢' : '🔒') + ' ' + name + ': ' + (any ? 'has future availability' : 'locked'));
  }

  const blob = new Blob([JSON.stringify(results, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ot_booked_5_future.json';
  a.click();
})();