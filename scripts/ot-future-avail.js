(async () => {
  const TIME = '19:00';
  const PARTY_SIZE = 2;
  const GQL_HASH = 'cbcf4838a9b399f742e3741785df64560a826d8d3cc2828aa01ab09a8455e29e';
  const BATCH_SIZE = 3;
  const BASE_HOUR = 19;
  const TOKEN = 'eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjowLCJuIjowfQ';
  const ENTRIES = [["big apple brunch", 1279057], ["exquisite restaurant", 1404829], ["gallagher's steakhouse", 104182], ["the palm court", 42739], ["le veau d'or", 220387], ["don angie", 994474], ["palma", 30196], ["the river café", 820], ["café mars", 1278811], ["aska", 334675], ["tsukimi", 1047511], ["zou zou’s", 1197907], ["one if by land, two if by sea", 336], ["potluck club 佰樂", 1358950], ["mymoon restaurant", 13906], ["fig & olive", 1470637], ["crave fishbar upper east side", 1380592], ["flex mussels - ues", 1318996], ["u omakase", 1255084], ["pure thai cookhouse", 238921], ["agenda restaurant", 1366672], ["tabu", 1324447], ["peaches hothouse", 1438570], ["barosa", 42103], ["bird pepper", 1352587], ["rumba cubana", 1331809], ["briciola harlem", 731335], ["ainslie", 1211932], ["alfie's", 1308469], ["due amici", 461241], ["aria west village", 986008], ["asian kitchen", 4816], ["astoria provisions", 1493881], ["birdy's", 1189612], ["blue", 1400668], ["bruno's restaurant", 46048], ["caribe restaurant", 469767], ["cibao restaurant", 1071946], ["cotenna", 253276], ["crystal", 394386], ["central park boathouse restaurant", 1294132], ["eagle trading co", 185453], ["eloise", 1057504], ["fei ma", 161255], ["impasto", 205047], ["indian summer", 441273], ["kyoto sushi", 124820], ["living room", 289092], ["mamma rosa's", 364341], ["marrakesh", 1484632], ["medusa", 445656], ["mizumi", 89977], ["osteria 106", 1027621], ["oxido", 97156], ["papi's grill", 381720], ["r40", 1052983], ["rebecca's edgewater", 1386283], ["salsa con fuego", 251827], ["sapporo", 53594], ["spring food spot", 1362397], ["taste of punjab", 135767], ["testo restaurant", 422103], ["the common", 327352], ["warique", 1210783], ["spanglish", 1359898], ["baci", 317847], ["saigon social", 1144579], ["yara", 1040596], ["attaboy", 1460605], ["bistro so", 1386064], ["neta shari", 1228567], ["moko", 1207474], ["bartley dunnes", 1411927], ["ketchy shuby", 1275217], ["harbor nyc", 253246], ["rice bird", 1344652], ["la catrina", 1468771], ["yokox omakase", 1362172], ["the vintage tea", 1355557], ["l'incontro by rocco", 1369099], ["little honey", 1403254], ["mansion", 1367293], ["hyun", 1042186], ["lundy's of brooklyn", 1417438], ["salt hank's", 1485760], ["messy", 1284862], ["lele", 1430824], ["flushing house", 31156], ["d kitchen", 299449], ["sirrah", 1319164], ["sunday", 1168609], ["match 65 brasserie", 6420], ["smoke & mirrors", 1226545], ["shi", 1048321], ["fabrika", 1426240], ["paros tribeca", 1329034], ["burger club", 376356], ["shokudo", 1470925], ["prime time", 1339894], ["la sova", 472989], ["trattoria pesce pasta", 239758], ["mezze on the river", 1245115], ["farmhouse restaurant", 142392], ["via brasil restaurant", 239761], ["tio pepe", 86482], ["punch", 7525], ["carroll place", 1426318], ["artesano", 1296847], ["gargiulo's coney island", 166234], ["grand view events", 1076863], ["blue note", 480520], ["viva toro", 161926], ["lailas", 1384936], ["loft", 1490242], ["bond 45", 1318528], ["mari", 1237195], ["han bat restaurant", 1242289], ["matisse 167", 87889], ["kamal palace", 1090168], ["ariella's restaurant", 1402240], ["china bar", 301559], ["tavern on the green", 118102], ["puebla mexican food", 1496965], ["metropolis by marcus samuelsson", 1317532], ["le gigot", 33067], ["sangarita's", 192763], ["the highlight room ny", 1269739], ["abc kitchen", 570], ["craft", 2085], ["roberta's - domino park", 1406719], ["two twenty one restaurant", 1469839], ["simple بسيط", 487612], ["urban cove society and kitchen", 1275334], ["ploume", 1474696], ["the last call", 1283902], ["chuko", 243097], ["parklife", 1154464], ["north fork", 1469806], ["members only west village", 1483219], ["pappas - new york", 1101250], ["ladurée soho", 1423174], ["the paris cafe", 1436572], ["catch new york", 70204], ["the parisian tea room- nyc", 1064044], ["silver lining lounge", 1261987], ["dough by licastri silver lake", 1368994], ["gamsung pocha - emokase table bar", 1481569], ["the hidden tiger", 1481752], ["insa karaoke room", 1422271], ["holiday cocktail lounge", 1078159], ["fusion hk bar and grill", 444544], ["docks off 5th", 1372909], ["shun lee cafe", 18778], ["bloom botanical bistro", 1175431], ["albert's", 1270420], ["gansevoort rooftop", 1165225], ["drai's supper club", 1419100], ["carne by allora brooklyn", 1434082], ["lady mendls", 96886], ["lazzara's pizza cafe", 112417], ["néo restaurant", 1415839], ["early terrible new york citynew", 1453231], ["xiang hotpot - brooklyn", 1320220], ["potluck club", 1263916], ["ascent lounge", 173878], ["gather espresso & wine bar", 1488028]];
  const DATES = ["2026-04-15", "2026-04-16", "2026-04-20", "2026-04-27", "2026-05-04", "2026-05-11"];

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let CSRF_TOKEN = window.OT_CSRF;
  if (!CSRF_TOKEN) { console.error('No CSRF. Set window.OT_CSRF first.'); return; }

  console.log('[OT Future Avail] ' + ENTRIES.length + ' restaurants x ' + DATES.length + ' dates = ' + (ENTRIES.length * DATES.length) + ' checks');

  const results = {};
  window.__OT_FUTURE = results;

  for (let d = 0; d < DATES.length; d++) {
    const DATE = DATES[d];
    let found = 0;
    console.log('\n📅 Checking ' + DATE + ' (' + (d+1) + '/' + DATES.length + ')...');

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

  console.log('\n[Done] ' + Object.keys(results).length + ' restaurants found future availability');
  const d = JSON.stringify(results, null, 2);
  const b = new Blob([d], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = 'ot_future_avail.json';
  a.click();
})();