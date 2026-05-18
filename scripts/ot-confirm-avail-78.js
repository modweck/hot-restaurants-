(async () => {
  const TIME = '19:00';
  const PARTY_SIZE = 2;
  const GQL_HASH = 'cbcf4838a9b399f742e3741785df64560a826d8d3cc2828aa01ab09a8455e29e';
  const BATCH_SIZE = 3;
  const BASE_HOUR = 19;
  const TOKEN = 'eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjowLCJuIjowfQ';
  const CSRF_TOKEN = '27d6c8a8-50af-4660-9b45-5b0731d5ebaa';
  window.OT_CSRF = CSRF_TOKEN;

  const d = new Date(); d.setDate(d.getDate() + 1);
  const DATE = d.toISOString().split('T')[0];

  const ENTRIES = [["nobu next door", 4528], ["carmine's - 44th street", 2295], ["lady mendl's", 96886], ["smith and wollensky", 6648], ["ocean prime", 149845], ["golden steer at one fifth", 1426876], ["hakkasan", 5002], ["bella dea", 5002], ["caf\u00e9 mars", 1278811], ["michael's of brooklyn", 150217], ["insa", 90991], ["San Carlo Cicchetti", 48973], ["casa d'angelo new york", 1229806], ["kaizen flushing", 1387495], ["kaizen nyc", 1387495], ["Carmine's Italian Restaurant - Upper West Side", 2296], ["chalong", 1308475], ["Pranakhon Thai Restaurant", 1275997], ["di an di", 1279321], ["le burger", 1319164], ["sappeisan", 1356454], ["the palm", 13384], ["thai cuisine", 334924], ["naked dog", 191656], ["wokuni broadway", 986998], ["redwood pleasure club", 718424967], ["sandro's", 344095], ["the river palm terrace - edgewater", 1388086], ["Baza\u0301r Tapas Bar & Restaurant", 984619], ["Aberdeen Barn", 791], ["da nonna rosa", 787705], ["inca's grill peruvian kitchen", 293158], ["indian summer", 1070128], ["soup n burger", 1236598], ["st. cloud, charlie palmer at the knick", 33133], ["verona american grill", 150565], ["the islands", 984949], ["cka ka qellue", 1130173], ["Valbella Midtown", 1231504], ["taco vista (governors island)", 1448224], ["china river", 1400287], ["Ipanema Restaurant", 218188], ["bloomfield steak & seafood house", 1409887], ["Connors Steak & Seafood", 1409887], ["Bobby Van's Steakhouse - 50th Street", 4567], ["the archer", 275144], ["awang kitchen", 993442], ["madame", 1295464], ["Fogo de Chao Brazilian Steakhouse", 40552], ["Maz Mezcal", 225757], ["Westville Chelsea", 228472], ["Giano Restaurant", 37102], ["Om", 63796], ["Gao's BBQ & Crab", 1347895], ["Bill's", 110521], ["Rickard Ridge BBQ", 2298], ["Sawmill BBQ", 2298], ["Forno Grill", 112282], ["Jackson Hole Burgers", 235450], ["The Pembroke Room", 192367], ["Gari Columbus", 20827], ["Luna Rossa Ristorante", 63865], ["tha phraya", 11964329533172038000], ["Birreria", 644174], ["Five Acres", 1251205], ["B V Tuscany", 3538], ["Brazilian Spices Restaurant & Steakhouse", 218188], ["Grotta Di Fuoco", 459025], ["Craven BBQ", 2298], ["Colonia BBQ", 2298], ["Shalel Kitchen & Bar", 237325], ["Village Taverna", 187549], ["r slice pizza", 230599], ["Le B.", 1319164], ["ART SoHo", 1040839], ["Cafe Luxembourg", 4020], ["Revel & Rye Bar and Restaurant", 1221583], ["supperclub @ le petit parisien", 1318996]];

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  console.log('[OT Avail Check] ' + ENTRIES.length + ' restaurants, date: ' + DATE);

  const results = {};
  window.__OT_AVAIL = results;
  let bookable = 0, noSlots = 0;

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
        const times = [];
        for (const slot of slots) {
          const h = BASE_HOUR + (slot.timeOffsetMinutes || 0) / 60;
          const hr = Math.floor(h), mn = Math.round((h - hr) * 60);
          const ap = hr >= 12 ? 'pm' : 'am';
          const h12 = hr > 12 ? hr - 12 : hr;
          times.push(h12 + ':' + String(mn).padStart(2, '0') + ap);
        }

        results[name] = { rid, slots: times.length, times: times.slice(0, 8), bookable: times.length > 0 };
        if (times.length > 0) {
          bookable++;
          console.log('  \u{1f7e2} [' + (i+j+1) + '/' + ENTRIES.length + '] ' + name + ' (rid:' + rid + ') → ' + times.length + ' slots: ' + times.slice(0,5).join(', '));
        } else {
          noSlots++;
          console.log('  \u{1f534} [' + (i+j+1) + '/' + ENTRIES.length + '] ' + name + ' (rid:' + rid + ') → no slots');
        }
      }
    } catch (e) {}
    await sleep(700);
  }

  window.__OT_AVAIL = results;
  console.log('\n' + '='.repeat(40));
  console.log('Done! Bookable: ' + bookable + ' | No slots: ' + noSlots);

  const blob = new Blob([JSON.stringify(results, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ot_avail_confirmed_78.json';
  a.click();
})();