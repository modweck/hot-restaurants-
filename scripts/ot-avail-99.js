// OT Availability Check — 1,123 restaurants, tonight (2026-04-11)
// FIX: Validates batch response rids to prevent mis-alignment bug

(async () => {
  const DATE = '2026-04-11';
  const TIME = '19:00';
  const PARTY_SIZE = 2;
  const GQL_HASH = 'b2d05a06151b3cb21d9dfce4f021303eeba288fac347068b29c1cb66badc46af';
  const BATCH_SIZE = 3;
  const BASE_HOUR = 19;
  const TOKEN = 'eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjoxLCJuIjowfQ';
  const ENTRIES = [["markjoseph steakhouse", 69349], ["the smith lincoln square", 98185], ["sushi noz", 1283581], ["trattoria dell'arte", 31231], ["morton's the steakhouse", 2741], ["the river café", 820], ["da nico restaurant", 166810], ["lucky restaurant", 1435879], ["ilili restaurant", 15550], ["zou zou’s", 1197907], ["dudley's", 257515], ["aqua boil", 1401595], ["pure thai restaurant", 238921], ["tulum brooklyn", 1374379], ["beso", 762883], ["marshal", 247060], ["orale mexican kitchen restaurants jersey city", 104488], ["bird pepper", 1352587], ["briciola harlem", 731335], ["angelo gordon", 135899], ["bacchus", 20950], ["birdy's", 1189612], ["blue", 1400668], ["bronx burger house", 1164655], ["burgos restaurant", 357540], ["capital restaurant", 34576], ["charo restaurant", 1403164], ["chihuahua", 1288132], ["cocina latina", 331704], ["concettina", 402018], ["curry leaf", 424920], ["don miguel restaurant", 1144126], ["double rainbow", 118508], ["eagle trading co", 185453], ["essen", 205167], ["fei ma", 161255], ["hong kong restaurant", 290579], ["king's kitchen", 988825], ["kyoto sushi", 124820], ["la mesita", 1210195], ["madison restaurant", 1231321], ["mamma rosa's", 364341], ["marina restaurant", 11887], ["miyako", 263095], ["mussels & more", 30211], ["new york burger co.", 7865], ["nick's bistro", 334963], ["nordstrom bistro verde", 1038469], ["pronto restaurant", 1053970], ["puebla restaurant", 1238722], ["rogers burgers", 1425802], ["rw prime", 230029], ["sagar restaurant", 190140], ["santa ana restaurant", 59998], ["surprise scoop", 1279711], ["taqueria gramercy", 1266922], ["testo restaurant", 422103], ["the art of prime", 187072], ["festival", 1122760], ["baci", 317847], ["belo", 117358], ["oita", 291903], ["addictive nyc", 1257529], ["gatsby's landing", 1237513], ["natural restaurant", 1005574], ["secret kitchen", 168956], ["via toscana", 1268776], ["kraam", 1403569], ["ra sushi bar restaurant", 144244], ["docks oyster bar - midtown east, nyc", 35893], ["mr. broadway restaurant", 1342942], ["blend (williamsburg)", 1266421], ["yayo's latin cuisine", 1421926], ["jimmy's on the go", 48460], ["shhh omakase", 1334689], ["baires grill", 1282117], ["sozai japanese restaurant (izakaya ramen)", 1377130], ["salt hank's", 1485760], ["dilli dilli", 1395760], ["tipsy shanghai restaurant", 1462447], ["sushi beauu", 1411447], ["enso omakase", 1406629], ["flushing house", 31156], ["uka omakase", 1475236], ["santa fe restaurant", 1043479], ["match 65 brasserie", 6420], ["matteo's of howard beach", 1345927], ["the russian tea room", 7626], ["lobster place", 314788], ["marty's", 1273819], ["the broadway", 1342942], ["blue anchor", 410409], ["aurora brooklyn", 96874], ["5 napkin burger - hell's kitchen", 22765], ["fish grill - brooklyn", 284614], ["bergen hall", 1277287], ["anejo tribeca", 148711], ["for u", 1036561], ["butcher & banker nyc", 987040]];

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  console.log('%c[OT Avail] Checking ' + ENTRIES.length + ' for ' + DATE, 'color: #00b894; font-weight: bold; font-size: 14px');

  // Get CSRF token from window or ask user
  let CSRF_TOKEN = window.OT_CSRF;
  if (!CSRF_TOKEN) {
    try {
      const html = document.documentElement.innerHTML;
      const m = html.match(/"csrfToken"\s*:\s*"([0-9a-f-]{36})"/) || html.match(/x-csrf-token["']?\s*:\s*["']([0-9a-f-]{36})/i);
      if (m) CSRF_TOKEN = m[1];
    } catch {}
  }
  if (!CSRF_TOKEN) {
    console.error('❌ No CSRF. Open Network tab, find /dapi/fe/gql request, copy x-csrf-token, run: window.OT_CSRF="PASTE"; then rerun');
    return;
  }
  console.log('✅ CSRF: ' + CSRF_TOKEN);

  const results = {};
  window.__OT_AVAIL = results;
  let open = 0, limited = 0, booked = 0, errors = 0, misaligned = 0;

  for (let i = 0; i < ENTRIES.length; i += BATCH_SIZE) {
    const batch = ENTRIES.slice(i, i + BATCH_SIZE);
    const rids = batch.map(b => b[1]);

    try {
      const res = await fetch('https://www.opentable.com/dapi/fe/gql?optype=query&opname=RestaurantsAvailability', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': CSRF_TOKEN,
          'ot-page-group': 'search',
          'ot-page-type': 'search_results',
          'x-query-timeout': '4000'
        },
        body: JSON.stringify({
          operationName: 'RestaurantsAvailability',
          variables: {
            onlyPop: false, forwardDays: 0, requireTimes: false, requireTypes: [],
            privilegedAccess: [], restaurantIds: rids,
            date: DATE, time: TIME, partySize: PARTY_SIZE, databaseRegion: 'NA',
            restaurantAvailabilityTokens: rids.map(() => TOKEN),
            slotDiscovery: rids.map(() => 'on'),
            loyaltyRedemptionTiers: [], attributionToken: ''
          },
          extensions: { persistedQuery: { version: 1, sha256Hash: GQL_HASH } }
        })
      });

      if (!res.ok) { errors += batch.length; await sleep(3000); continue; }
      const json = await res.json();
      const avail = json?.data?.availability || [];

      // CRITICAL FIX: Build a map by restaurantId, don't assume order
      const byRid = {};
      for (const rd of avail) {
        const rid = rd?.restaurantId;
        if (rid) byRid[rid] = rd;
      }

      for (let j = 0; j < batch.length; j++) {
        const [name, rid] = batch[j];
        const rd = byRid[rid];
        if (!rd) {
          misaligned++;
          continue;
        }

        const slots = (rd?.availabilityDays?.[0]?.slots || []).filter(s => s.isAvailable);
        const times = [];
        let earlyN = 0, primeN = 0, lateN = 0;
        for (const slot of slots) {
          const h = BASE_HOUR + (slot.timeOffsetMinutes || 0) / 60;
          const hr = Math.floor(h), mn = Math.round((h - hr) * 60);
          const ap = hr >= 12 ? 'pm' : 'am';
          const h12 = hr > 12 ? hr - 12 : hr;
          times.push(h12 + ':' + String(mn).padStart(2, '0') + ap);
          if (h >= 17 && h < 18.5) earlyN++;
          else if (h >= 18.5 && h < 20.5) primeN++;
          else lateN++;
        }

        const tier = times.length === 0 ? 'booked' : times.length <= 3 ? 'limited' : 'open';
        results[name] = {
          rid, tier, slots: times.length, times,
          early: earlyN > 0, prime: primeN > 0, late: lateN > 0,
          checked_date: DATE
        };
        if (tier === 'open') open++;
        else if (tier === 'limited') limited++;
        else booked++;
      }

      if ((i / BATCH_SIZE) % 20 === 0) {
        console.log('[' + (i + batch.length) + '/' + ENTRIES.length + '] 🟢' + open + ' 🟡' + limited + ' 🔴' + booked + ' ⚠️' + errors + ' 🔀' + misaligned);
        window.__OT_AVAIL = results;
      }
    } catch (e) {
      errors += batch.length;
    }
    await sleep(700);
  }

  window.__OT_AVAIL = results;
  console.log('%c[Done] 🟢' + open + ' 🟡' + limited + ' 🔴' + booked + ' ⚠️' + errors + ' 🔀' + misaligned, 'color: #00b894; font-weight: bold');

  const d = JSON.stringify(results, null, 2);
  const b = new Blob([d], {type:'application/json'});
  const x = document.createElement('a');
  x.href = URL.createObjectURL(b);
  x.download = 'ot_avail_99.json';
  x.click();
})();
