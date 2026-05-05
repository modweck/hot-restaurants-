(async () => {
  const DATE = '2026-04-14';
  const TIME = '19:00';
  const PARTY_SIZE = 2;
  const GQL_HASH = 'b2d05a06151b3cb21d9dfce4f021303eeba288fac347068b29c1cb66badc46af';
  const BATCH_SIZE = 3;
  const BASE_HOUR = 19;
  const TOKEN = 'eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjoxLCJuIjowfQ';
  const ENTRIES = [["big apple brunch", 1279057], ["gallagher's steakhouse", 104182], ["le veau d'or", 220387], ["don angie", 994474], ["sushi by scratch restaurants", 1382866], ["zou zou’s", 1197907], ["one if by land, two if by sea", 336], ["il poeta", 74059], ["fig & olive", 1470637], ["crave fishbar upper east side", 1380592], ["pure thai cookhouse", 238921], ["pure thai restaurant", 238921], ["peaches hothouse", 1438570], ["bird pepper", 1352587], ["rumba cubana", 1331809], ["briciola harlem", 731335], ["alfie's", 1308469], ["due amici", 461241], ["aria west village", 986008], ["birdy's", 1189612], ["bruno's restaurant", 46048], ["cotenna", 253276], ["crystal", 394386], ["eagle trading co", 185453], ["eloise", 1057504], ["fei ma", 161255], ["kyoto sushi", 124820], ["mamma rosa's", 364341], ["mizumi", 89977], ["mughlai indian cuisine", 1458367], ["osteria 106", 1027621], ["papi's grill", 381720], ["qingdao", 136226], ["sapporo", 53594], ["attaboy", 1460605], ["the vintage tea", 1355557], ["l'incontro by rocco", 1369099], ["little honey", 1403254], ["salt hank's", 1485760], ["flushing house", 31156], ["match 65 brasserie", 6420], ["burger club", 376356], ["via brasil restaurant", 239761], ["poke", 242224], ["artesano", 1296847], ["grand view events", 1076863], ["blue note", 480520], ["viva toro", 161926], ["han bat restaurant", 1242289], ["china bar", 301559], ["sangarita's", 192763], ["zou zou's", 1197907], ["craft", 2085], ["ernesto’s", 1064494], ["ploume", 1474696], ["the brooklyn deli - times square", 1318528], ["parklife", 1154464], ["golden steer steakhouse nyc", 1426876], ["pappas - new york", 1101250], ["crave fishbar - uws", 1380592], ["the parisian tea room- nyc", 1064044], ["silver lining lounge", 1261987], ["match 65 brasserie (formerly paris match)", 6420], ["holiday cocktail lounge", 1078159], ["shun lee cafe", 18778], ["lazzara's pizza cafe", 112417], ["trattoria l'incontro", 1369099], ["carversteak new york citynew", 1443148], ["bar fes", 1496143], ["carversteak new york city", 1443148], ["rosevale cocktail room", 1443148]];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let CSRF_TOKEN = window.OT_CSRF;
  if (!CSRF_TOKEN) { console.error('No CSRF.'); return; }
  console.log('[OT Avail] ' + ENTRIES.length + ' booked restaurants for ' + DATE);
  const results = {};
  window.__OT_AVAIL = results;
  let open = 0, limited = 0, booked = 0, errors = 0, misaligned = 0;
  for (let i = 0; i < ENTRIES.length; i += BATCH_SIZE) {
    const batch = ENTRIES.slice(i, i + BATCH_SIZE);
    const rids = batch.map(b => b[1]);
    try {
      const res = await fetch('https://www.opentable.com/dapi/fe/gql?optype=query&opname=RestaurantsAvailability', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF_TOKEN, 'ot-page-group': 'search', 'ot-page-type': 'search_results', 'x-query-timeout': '4000' },
        body: JSON.stringify({ operationName: 'RestaurantsAvailability', variables: { onlyPop: false, forwardDays: 0, requireTimes: false, requireTypes: [], privilegedAccess: [], restaurantIds: rids, date: DATE, time: TIME, partySize: PARTY_SIZE, databaseRegion: 'NA', restaurantAvailabilityTokens: rids.map(() => TOKEN), slotDiscovery: rids.map(() => 'on'), loyaltyRedemptionTiers: [], attributionToken: '' }, extensions: { persistedQuery: { version: 1, sha256Hash: GQL_HASH } } })
      });
      if (!res.ok) { errors += batch.length; await sleep(3000); continue; }
      const json = await res.json();
      const avail = json?.data?.availability || [];
      const byRid = {};
      for (const rd of avail) { const rid = rd?.restaurantId; if (rid) byRid[rid] = rd; }
      for (let j = 0; j < batch.length; j++) {
        const [name, rid] = batch[j];
        const rd = byRid[rid];
        if (!rd) { misaligned++; continue; }
        const slots = (rd?.availabilityDays?.[0]?.slots || []).filter(s => s.isAvailable);
        const times = []; let earlyN = 0, primeN = 0, lateN = 0;
        for (const slot of slots) { const h = BASE_HOUR + (slot.timeOffsetMinutes || 0) / 60; const hr = Math.floor(h), mn = Math.round((h - hr) * 60); const ap = hr >= 12 ? 'pm' : 'am'; const h12 = hr > 12 ? hr - 12 : hr; times.push(h12 + ':' + String(mn).padStart(2, '0') + ap); if (h >= 17 && h < 18.5) earlyN++; else if (h >= 18.5 && h < 20.5) primeN++; else lateN++; }
        const tier = times.length === 0 ? 'booked' : times.length <= 3 ? 'limited' : 'open';
        results[name] = { rid, tier, slots: times.length, times, early: earlyN > 0, prime: primeN > 0, late: lateN > 0, checked_date: DATE };
        if (tier === 'open') open++; else if (tier === 'limited') limited++; else booked++;
      }
      if ((i / BATCH_SIZE) % 10 === 0) { console.log('[' + (i + batch.length) + '/' + ENTRIES.length + '] g' + open + ' y' + limited + ' r' + booked); }
    } catch (e) { errors += batch.length; }
    await sleep(700);
  }
  window.__OT_AVAIL = results;
  console.log('[Done] g' + open + ' y' + limited + ' r' + booked + ' e' + errors + ' m' + misaligned);
  const d = JSON.stringify(results, null, 2); const b = new Blob([d], {type:'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'ot_avail_booked_tue.json'; a.click();
})();