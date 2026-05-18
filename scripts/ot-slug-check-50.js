(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const CSRF_TOKEN = '27d6c8a8-50af-4660-9b45-5b0731d5ebaa';
  window.OT_CSRF = CSRF_TOKEN;
  const GQL_HASH = 'cbcf4838a9b399f742e3741785df64560a826d8d3cc2828aa01ab09a8455e29e';
  const TOKEN = 'eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjowLCJuIjowfQ';
  const PARTY_SIZE = 2;
  const d = new Date(); d.setDate(d.getDate() + 1);
  const DATE = d.toISOString().split('T')[0];

  const ENTRIES = [["Lattanzi Ristorante", "lattanzi-new-york"], ["brass", "the-tusk-bar-new-york"], ["d garden", "d-garden-caribbean-bar-and-grill-brooklyn"], ["la dong", "la-dong-reservations-new-york"], ["tolo", "tolo-reservations-new-york"], ["kabawa", "kabawa-new-york"], ["mitsuru", "mitsuru-reservations-new-york"], ["blt steak", "blt-prime-new-york-2"], ["capt loui cajun seafood boil", "capt-loui-reservations-new-york"], ["villa erasamo", "villa-erasmo-reservations-queens"], ["don giovanni ristorante", "don-giovannis-times-square-reservations-hells-kitchen"], ["max", "max-tribeca-new-york"], ["one star", "bom-new-york"], ["geisha asian fusion", "geisha-asian-fusion-new-york"], ["chateau yaffa", "chateau-yaffa-brooklyn"], ["the vintage tea", "the-vintage-tea-reservations-staten-island"], ["the otter", "the-otter-reservations-new-york"], ["sloane's", "sloanes-reservations-new-york"], ["zara forest grill", "zara-forest-grill-reservations-staten-island"], ["The Butcher And Bottle", "butcher-and-banker-reservations-new-york"], ["The Greek Tribeca", "greca-by-the-greek-new-york"], ["15 East at Tocqueville", "tocqueville-new-york"], ["Caliente Cab Co.", "caliente-cab-mexican-cafe-new-york"], ["Thai Pavilion NYC", "thai-pavilion-new-york"], ["RT 60", "rt60-new-york"], ["Jaba", "jaba-reservations-new-york"], ["Fine & Rare", "the-flatiron-room-nomad-new-york"], ["INDAY All Day", "indays-bar-and-restaurant-brooklyn"], ["GOSHT Steakhouse", "gosht-brooklyn"], ["siren restaurant and bar", "siren-oyster-bar-and-restaurant-brooklyn"], ["una pizza napoletana", "una-pizza-napoletana-new-york"], ["bar kabawa", "bar-kabawa-new-york"], ["the loyal", "tbd-289-bleeker-reservations-new-york"], ["L'Amore", "lamore-new-york"], ["Yakar Kosher Steakhouse", "yakar-steakhouse-reservations-brooklyn2"], ["n\u00e9o restaurant", "neo-restaurant-reservations-queens"]];

  console.log('[OT Slug→RID→Avail] ' + ENTRIES.length + ' restaurants');

  const results = {};
  window.__OT_SLUG_CHECK = results;
  let found = 0, notFound = 0;

  // Step 1: Resolve each slug to RID by fetching the OT page
  for (let i = 0; i < ENTRIES.length; i++) {
    const [name, slug] = ENTRIES[i];
    try {
      const res = await fetch('https://www.opentable.com/r/' + slug, { credentials: 'include' });
      if (!res.ok) { notFound++; continue; }
      const html = await res.text();
      const ridMatch = html.match(/data-rid="(\d+)"/);
      const ridMatch2 = html.match(/"restaurantId":(\d+)/);
      const rid = ridMatch ? parseInt(ridMatch[1]) : (ridMatch2 ? parseInt(ridMatch2[1]) : null);
      const nameMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
      const otName = nameMatch ? nameMatch[1].trim() : slug;

      if (rid) {
        results[name] = { rid, slug, ot_name: otName };
        found++;
        console.log('  \u{2705} [' + (i+1) + '/' + ENTRIES.length + '] ' + name + ' → rid:' + rid + ' (' + otName + ')');
      } else {
        notFound++;
        console.log('  \u{274c} [' + (i+1) + '/' + ENTRIES.length + '] ' + name + ' → no RID found');
      }
    } catch(e) {
      notFound++;
    }
    await sleep(2000);
  }

  console.log('\nStep 1 done: ' + found + ' RIDs found');

  // Step 2: Check availability for all found RIDs
  const withRids = Object.entries(results).filter(([_,v]) => v.rid);
  console.log('\nStep 2: Checking availability for ' + withRids.length + ' restaurants...');

  const BATCH_SIZE = 3;
  const BASE_HOUR = 19;

  for (let i = 0; i < withRids.length; i += BATCH_SIZE) {
    const batch = withRids.slice(i, i + BATCH_SIZE);
    const rids = batch.map(([_,v]) => v.rid);

    try {
      const res = await fetch('https://www.opentable.com/dapi/fe/gql?optype=query&opname=RestaurantsAvailability', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF_TOKEN, 'ot-page-group': 'search', 'ot-page-type': 'multi-search', 'x-query-timeout': '4000' },
        body: JSON.stringify({ operationName: 'RestaurantsAvailability', variables: { onlyPop: false, forwardDays: 0, requireTimes: false, requireTypes: [], privilegedAccess: [], restaurantIds: rids, date: DATE, time: '19:00', partySize: PARTY_SIZE, databaseRegion: 'NA', restaurantAvailabilityTokens: rids.map(() => TOKEN), slotDiscovery: rids.map(() => 'on'), loyaltyRedemptionTiers: [], attributionToken: '' }, extensions: { persistedQuery: { version: 1, sha256Hash: GQL_HASH } } })
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
        results[name].slots = times.length;
        results[name].times = times.slice(0, 8);
        results[name].bookable = times.length > 0;
        const icon = times.length > 0 ? '\u{1f7e2}' : '\u{1f534}';
        console.log('  ' + icon + ' ' + name + ' → ' + times.length + ' slots');
      }
    } catch(e) {}
    await sleep(700);
  }

  window.__OT_SLUG_CHECK = results;
  const bookable = Object.values(results).filter(v => v.bookable).length;
  const noSlots = Object.values(results).filter(v => v.rid && !v.bookable).length;
  console.log('\n' + '='.repeat(40));
  console.log('Done! RIDs found: ' + found + ' | Bookable: ' + bookable + ' | No slots: ' + noSlots);

  const blob = new Blob([JSON.stringify(results, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ot_slug_check_50.json';
  a.click();
})();