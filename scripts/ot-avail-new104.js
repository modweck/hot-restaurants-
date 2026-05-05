(async () => {
  const DATE = '2026-04-13';
  const TIME = '19:00';
  const PARTY_SIZE = 2;
  const GQL_HASH = 'b2d05a06151b3cb21d9dfce4f021303eeba288fac347068b29c1cb66badc46af';
  const BATCH_SIZE = 3;
  const BASE_HOUR = 19;
  const TOKEN = 'eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjoxLCJuIjowfQ';
  const ENTRIES = [["sushi by scratch restaurants", 1382866], ["what the fish", 1278718], ["ainslie", 1211932], ["puerto plata restaurant", 1402387], ["shanghai chinese restaurant", 236299], ["harlem breakfast club", 731647], ["p.f. chang's", 1320898], ["la fusta", 225358], ["the evergreen", 208264], ["café d'anvers", 1185301], ["drift restaurant and bar", 1345699], ["patiala indian grill & bar", 1323238], ["pico de gallo bar & kitchen", 1259050], ["route bar restaurant", 1242730], ["yuca bar & restaurant", 242416], ["gu japanese fusion sushi & bar", 1012894], ["bar san miguel carroll gardens", 1014709], ["palladino's steak & seafood", 1409887], ["taste of italy", 1308400], ["eatzy thai", 1194202], ["l'angeletto", 1092370], ["il carino restaurant", 986089], ["crane club restaurant", 1387297], ["white oak tavern", 145786], ["ploume", 1474696], ["cheeseboat - williamsburg", 269923], ["the brooklyn deli - times square", 1318528], ["cibar lounge", 246286], ["morton's the steakhouse - midtown manhattan", 3018], ["joe & pat’s nyc", 1326979], ["golden steer steakhouse nyc", 1426876], ["pappas - new york", 1101250], ["the argyle", 1467235], ["elea", 1011193], ["estiatorio milos – midtown new york", 1973], ["quality italian - new york", 110224], ["carnegie diner & café – 205 w 57th st, new york, ny", 1065109], ["kings of kobe - wagyu kitchen & bar", 988825], ["serafina broadway", 3579], ["carnegie diner & café – 1185 6th ave, new york ny", 1470865], ["blue fin - new york", 30505], ["the elgin", 1052227], ["toloache - upper east side", 68032], ["island", 984949], ["oda house - upper east side", 1043122], ["zoi mediterranean ues", 1201135], ["bustan", 118003], ["the consulate upper west side", 1051522], ["5 napkin burger - upper west side", 40456], ["playa betty's", 191617], ["saperavi uws", 1467301], ["native harlem", 1426930], ["community food & juice", 1307194], ["l' artista", 1200718], ["vida nyc", 1265713], ["bar contra", 186589], ["piccola cucina osteria - spring st.", 105838], ["kabin", 1368061], ["the paris cafe", 1436572], ["friedman's - 72nd st", 1310206], ["broadway lounge", 1221586], ["mapo asian restaurant & bar", 1460437], ["gyu-kaku japanese bbq - new york, ny | times square manhattan", 7700], ["jams - nyc", 170722], ["palermo argentinian bistro nyc", 1180861], ["russian tea room - nyc", 7626], ["the parisian tea room- nyc", 1064044], ["rosa mexicano - second avenue", 1207771], ["atlantic grill at lincoln center", 1175752], ["azara kitchen", 1364164], ["ikyu", 1469323], ["saperavi ues", 1467088], ["silver lining lounge", 1261987], ["dough by licastri silver lake", 1368994], ["lumen dining & rooftop", 1419088], ["the corner chinese", 1282405], ["the ivy room", 1267852], ["glass ceiling rooftop", 1180834], ["tiny tapas and bites", 1388896], ["chef papa vietnamese kitchen lic", 1481866], ["rosemary's midtown", 1401259], ["match 65 brasserie (formerly paris match)", 6420], ["brasserie cognac central park south", 1392550], ["empellon midtown", 729934], ["vida verde", 732586], ["mr chow - 57th", 28762], ["shun lee west", 18781], ["chalong southern thai", 1308475], ["smith & wollensky - new york", 6648], ["holiday cocktail lounge", 1078159], ["warique - williamsburg", 1210783], ["creatures rooftop", 1339888], ["bocca di bacco (theatre district - 45th st.)", 4478], ["haven rooftop", 90400], ["shun lee cafe", 18778], ["the east pole - kitchen and bar", 107512], ["the fleur room nyc", 1347265], ["ophelia", 995113], ["grand salon & bar at baccarat hotel new york", 167698], ["sushi by bou - jersey city nj @ ani ramen", 1257523], ["red lobster - brooklyn", 314788], ["red lobster - bronx", 314182], ["majorelle at the lowell", 192367]];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let CSRF_TOKEN = window.OT_CSRF;
  if (!CSRF_TOKEN) { console.error('No CSRF. Set window.OT_CSRF first.'); return; }
  console.log('[OT Avail] Checking ' + ENTRIES.length + ' for ' + DATE);
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
      if ((i / BATCH_SIZE) % 10 === 0) { console.log('[' + (i + batch.length) + '/' + ENTRIES.length + '] g' + open + ' y' + limited + ' r' + booked + ' e' + errors + ' m' + misaligned); }
    } catch (e) { errors += batch.length; }
    await sleep(700);
  }
  window.__OT_AVAIL = results;
  console.log('[Done] g' + open + ' y' + limited + ' r' + booked + ' e' + errors + ' m' + misaligned);
  const d = JSON.stringify(results, null, 2); const b = new Blob([d], {type:'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'ot_avail_new104.json'; a.click();
})();