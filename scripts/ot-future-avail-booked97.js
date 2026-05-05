(async () => {
  const TIME = '19:00';
  const PARTY_SIZE = 2;
  const GQL_HASH = 'cbcf4838a9b399f742e3741785df64560a826d8d3cc2828aa01ab09a8455e29e';
  const BATCH_SIZE = 3;
  const BASE_HOUR = 19;
  const TOKEN = 'eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjowLCJuIjowfQ';
  const ENTRIES = [["nobu downtown",4528],["the odeon",2221],["peking duck house",236290],["gallagher's steakhouse",104182],["the palm court",42739],["oceans",1050274],["le veau d'or",220387],["odo",1366528],["don angie",994474],["aretsky's patroon",1300],["sunn's",1428529],["tsukimi",1047511],["chambers",145225],["metropolis by marcus samuelsson",1317532],["tempura matsui",172303],["mymoon restaurant",13906],["il poeta",74059],["atlantic grill",1175752],["the mermaid inn",110988],["ammos estiatorio",5796],["loi estiatorio",28960],["rucola restaurant",20950],["u omakase",1255084],["leticias restaurant",1395307],["l'osteria",1215034],["pure thai cookhouse",238921],["keg and lantern southside",1021288],["kosher grill",1491538],["hudson hound",188140],["bird pepper",1352587],["rumba cubana",1331809],["alfie's",1308469],["angelo gordon",135899],["aria west village",986008],["astoria provisions",1493881],["birdy's",1189612],["blue",1400668],["concettina",402018],["cotenna",253276],["essex taqueria",1266922],["kanan",1147168],["kyoto sushi",124820],["monty's nyc",1275421],["oasis",1069150],["osteria 106",1027621],["republica",1165546],["sapporo",53594],["taste of punjab",135767],["the grounds of brooklyn",171773],["the art of prime",187072],["festival",1122760],["spanglish",1359898],["masala king",1378504],["hey yuet",1244986],["secret kitchen",168956],["yves",334822],["mr. broadway restaurant",1342942],["little maven",1369840],["l'incontro by rocco",1369099],["little honey",1403254],["tutto apposto",1408576],["dilli dilli",1395760],["uka omakase",1475236],["soothr lic",116164],["bobby van's grill",7289],["txula steak",1463491],["warren street bar and restaurant",1235140],["casa mono",34048],["china kitchen",35927],["houston hall",1330780],["caliente cab mexican cafe",254017],["il cantinori",6242],["zou zou's",1197907],["match 65 brasserie",6420],["trattoria pesce pasta",239758],["farmhouse restaurant",142392],["trinity place",14812],["artesano",1296847],["blue note",480520],["seven valleys",1269766],["noma social",66856],["the highlight room ny",1269739],["fellini",1385662],["yard house - times square",1221061],["golden steer steakhouse nyc",1426876],["the crown",486175],["catch new york",70204],["jams - nyc",170722],["shun lee west",18781],["nanshan hot pot - bayside",1462807],["the mary lane",1206802],["aurora - williamsburg",14158],["jhoanes bakery & coffee",1434694],["lazzara's pizza cafe",112417],["carversteak new york citynew",1443148],["bar fes",1496143],["bruno's italian bistro",46048]];
  const DATES = ["2026-04-21","2026-04-22","2026-04-26","2026-05-03","2026-05-10"];

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let CSRF_TOKEN = window.OT_CSRF || document.cookie.match(/csrf_token=([^;]+)/)?.[1] || document.querySelector('meta[name="csrf-token"]')?.content;
  if (!CSRF_TOKEN) { CSRF_TOKEN = prompt('Paste your OT CSRF token:'); }
  if (!CSRF_TOKEN) { console.error('❌ No CSRF token provided.'); return; }
  window.OT_CSRF = CSRF_TOKEN;

  console.log('[OT Future Avail] ' + ENTRIES.length + ' restaurants x ' + DATES.length + ' dates = ' + (ENTRIES.length * DATES.length) + ' checks');

  const results = {};
  window.__OT_FUTURE = results;

  for (let d = 0; d < DATES.length; d++) {
    const DATE = DATES[d];
    let found = 0;
    console.log('\n📅 Checking ' + DATE + ' (+' + [2,3,7,14,21][d] + 'd) (' + (d+1) + '/' + DATES.length + ')...');

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
            if (!results[name].opens_in) results[name].opens_in = DATE;
            found++;
          }
        }
      } catch (e) {}
      await sleep(700);
    }

    console.log('  → ' + found + ' restaurants have availability on ' + DATE);
    window.__OT_FUTURE = results;
  }

  // Summary
  const locked = ENTRIES.filter(([n]) => !results[n]).map(([n]) => n);
  console.log('\n═══════════════════════════════════════');
  console.log('✅ Done! ' + Object.keys(results).length + '/' + ENTRIES.length + ' have future availability');
  console.log('🔒 Fully locked (' + locked.length + '): ' + locked.join(', '));
  console.log('\nResults in window.__OT_FUTURE');

  const blob = new Blob([JSON.stringify(results, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ot_future_booked_97.json';
  a.click();
})();
