// OT Availability Check — 1,123 restaurants, tonight (2026-04-11)
// FIX: Validates batch response rids to prevent mis-alignment bug

(async () => {
  const DATE = '2026-04-12';
  const TIME = '19:00';
  const PARTY_SIZE = 2;
  const GQL_HASH = 'b2d05a06151b3cb21d9dfce4f021303eeba288fac347068b29c1cb66badc46af';
  const BATCH_SIZE = 3;
  const BASE_HOUR = 19;
  const TOKEN = 'eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjoxLCJuIjowfQ';
  const ENTRIES = [["markjoseph steakhouse", 69349], ["the smith lincoln square", 98185], ["sushi noz", 1283581], ["trattoria dell'arte", 31231], ["morton's the steakhouse", 2741], ["the river café", 820], ["café mars", 1278811], ["da nico restaurant", 166810], ["lucky restaurant", 1435879], ["olio e più - bryant park", 1477168], ["ilili restaurant", 15550], ["zou zou’s", 1197907], ["fogo de chão - brooklyn", 1344280], ["potluck club 佰樂", 1358950], ["olio e più", 1477168], ["dudley's", 257515], ["hoexter’s", 1279159], ["aqua boil", 1401595], ["resident", 1100389], ["pure thai restaurant", 238921], ["ikyu 一休", 1293676], ["tulum brooklyn", 1374379], ["beso", 762883], ["marshal", 247060], ["orale mexican kitchen restaurants jersey city", 104488], ["bird pepper", 1352587], ["just pho you", 1425325], ["briciola harlem", 731335], ["angelo gordon", 135899], ["bacchus", 20950], ["birdy's", 1189612], ["blue", 1400668], ["bronx burger house", 1164655], ["burgos restaurant", 357540], ["capital restaurant", 34576], ["charo restaurant", 1403164], ["chihuahua", 1288132], ["cocina latina", 331704], ["concettina", 402018], ["curry leaf", 424920], ["don miguel restaurant", 1144126], ["double rainbow", 118508], ["eagle trading co", 185453], ["essen", 205167], ["fei ma", 161255], ["gazala's", 1018084], ["hong kong restaurant", 290579], ["king's kitchen", 988825], ["kyoto sushi", 124820], ["la mesita", 1210195], ["madison restaurant", 1231321], ["mamma rosa's", 364341], ["marina restaurant", 11887], ["miyako", 263095], ["mughlai indian cuisine", 1458367], ["mussels & more", 30211], ["new york burger co.", 7865], ["nick's bistro", 334963], ["nordstrom bistro verde", 1038469], ["pronto restaurant", 1053970], ["puebla restaurant", 1238722], ["rogers burgers", 1425802], ["rw prime", 230029], ["sagar restaurant", 190140], ["santa ana restaurant", 59998], ["surprise scoop", 1279711], ["taqueria gramercy", 1266922], ["testo restaurant", 422103], ["the art of prime", 187072], ["festival", 1122760], ["baci", 317847], ["belo", 117358], ["oita", 291903], ["addictive nyc", 1257529], ["gatsby's landing", 1237513], ["natural restaurant", 1005574], ["secret kitchen", 168956], ["via toscana", 1268776], ["kraam", 1403569], ["ra sushi bar restaurant", 144244], ["docks oyster bar - midtown east, nyc", 35893], ["mr. broadway restaurant", 1342942], ["blend (williamsburg)", 1266421], ["yayo's latin cuisine", 1421926], ["jimmy's on the go", 48460], ["shhh omakase", 1334689], ["animo!", 1421236], ["baires grill", 1282117], ["sozai japanese restaurant (izakaya ramen)", 1377130], ["salt hank's", 1485760], ["dilli dilli", 1395760], ["tipsy shanghai restaurant", 1462447], ["sushi beauu", 1411447], ["enso omakase", 1406629], ["flushing house", 31156], ["uka omakase", 1475236], ["santa fe restaurant", 1043479], ["match 65 brasserie", 6420], ["matteo's of howard beach", 1345927], ["the russian tea room", 7626], ["lobster place", 314788], ["marty's", 1273819], ["the broadway", 1342942], ["blue anchor", 410409], ["aurora brooklyn", 96874], ["5 napkin burger - hell's kitchen", 22765], ["fish grill - brooklyn", 284614], ["bergen hall", 1277287], ["anejo tribeca", 148711], ["the jin", 1043158], ["for u", 1036561], ["bustronome new york", 1377070], ["butcher & banker nyc", 987040], ["alta", 2809], ["the wilson", 1026124], ["cowgirl", 278254], ["mas (farmhouse)", 84103], ["uncle jack’s steakhouse westside", 2654], ["fulton fish co.", 1357186], ["red star", 139], ["zimmis", 1350598], ["iris", 1063336], ["poke", 242224], ["artesano", 1296847], ["sushi by m", 1257526], ["the boil brooklyn", 1490755], ["gargiulo's coney island", 166234], ["sofia's taqueria - amboy rd", 1175209], ["sugar factory - time square", 1224835], ["çka ka qëllu", 1008895], ["tán by chef richard sandoval", 1259293], ["amylos", 991990], ["da' franco & tony's ristorante", 173623], ["botte ditmars", 1421797], ["amelie - uws", 1183693], ["supperclub @ le petit parisien", 1318996], ["bazaar meat by josé andrés - new york", 1183219], ["dolly's", 1057042], ["fogo de chão - new york - world trade center", 1381732], ["grand view events", 1076863], ["marlow east", 1424188], ["mermaid inn upper west side", 1123207], ["nick & stef’s steakhouse - new york", 2216], ["san matteo", 1277488], ["victor's café", 3716], ["blue note", 480520], ["chinatown’s", 1428529], ["viva toro", 161926], ["crane club", 1387297], ["deja vu", 1481998], ["maria's", 1021942], ["nono", 390357], ["pasta corner", 1329169], ["antalia", 63739], ["omakaseed", 1238299], ["westville hell’s kitchen", 1349761], ["westville - uws", 1349761], ["frankie & johnnie's steakhouse", 211633], ["mari", 1237195], ["contento", 1194328], ["han bat restaurant", 1242289], ["bartolo’s", 1389607], ["roberta's", 1267768], ["tipsy shanghai - east village", 1462447], ["chloe", 49144], ["socarrat nolita", 58891], ["villa erasmo", 1464163], ["mario's restaurant", 104587], ["lilli restaurant", 1323382], ["matisse 167", 87889], ["laila", 290712], ["179 bar & grill", 1142341], ["ariella's restaurant", 1402240], ["fusion 27", 1213069], ["filé gumbo bar", 1178713], ["china bar", 301559], ["rh rooftop restaurant at rh", 1050247], ["savvy bistro and bar", 1054981], ["foxy john's bar & kitchen", 1403008], ["gabriel's bar & restaurant", 58741], ["state grill and bar", 150565], ["gnocchi bar", 209236], ["bar rocco", 1492840], ["arturo's", 237589], ["lola's", 1344301], ["casa dani", 1147633], ["next door by wegmans – noho", 1410961], ["sarabeth’s greenwich village", 102730], ["cathédrale", 1237237], ["olio e più– greenwich village", 55837], ["casa d’angelo new york", 1229806], ["ernesto’s", 1064494], ["simple بسيط", 487612], ["café fleuri", 263413], ["the capital grille – ny – metlife", 29884], ["cap’t loui", 1458868], ["elcielo bistró nyc", 1438918], ["akb, a hotel bar – new york", 254290], ["añejo tribeca", 148711], ["isabelle’s osteria", 335782], ["novitá - new york city, manhattan", 30202], ["çka ka qellue", 1130173], ["carnegie diner & café – 828 8th ave, new york, ny", 1306750], ["tang by mr sun 唐", 1392421], ["ladurée soho", 1423174], ["l’adresse nomad", 1181653], ["gyu-kaku japanese bbq – long island city, ny | hunters point", 7700], ["川雲涧 sky pavilion nyc", 1348507], ["estiatorio milos – hudson yards", 1044916], ["fogo de chão - elmhurst, queens ny", 1083319], ["wollensky’s grill", 190840], ["carnegie diner & café – martinique new york", 1475392], ["emmy squared pizza - hell’s kitchen", 1252909], ["nanshan hot pot - flushing｜南山•熊猫烫火锅 - 法拉盛店", 1462804], ["nanshan hot pot - bayside｜南山•熊猫烫火锅 - 贝赛店", 1462807], ["eli’s table", 71485], ["sir henry’s", 1347988], ["néo restaurant", 1415839], ["la diáspora bar & restaurant", 1340860], ["starbucks reserve® empire state building® store", 1379803], ["beijing hot pot 京门铜火锅", 1462984], ["blake’s tavern nycnew", 1496218], ["mēdüzā mediterrania", 1322749], ["cherry point", 444469], ["blake’s tavern", 1492048], ["5th & mad", 171055], ["bill's supper club", 1371079]];

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
  x.download = 'ot_avail_227.json';
  x.click();
})();
