(async () => {
  const DATE = new Date().toISOString().split('T')[0];
  const PARTY_SIZE = 2;
  const GQL_HASH = 'cbcf4838a9b399f742e3741785df64560a826d8d3cc2828aa01ab09a8455e29e';
  const BATCH_SIZE = 3;
  const TOKEN = 'eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjowLCJuIjowfQ';

  let CSRF_TOKEN = window.OT_CSRF || document.cookie.match(/csrf_token=([^;]+)/)?.[1];
  if (!CSRF_TOKEN) { CSRF_TOKEN = prompt('Paste CSRF for Part 1/3:'); }
  if (!CSRF_TOKEN) { console.error('No CSRF'); return; }
  window.OT_CSRF = CSRF_TOKEN;

  const ENTRIES = [["886", 1021771], ["nobu downtown", 4528], ["the odeon", 2221], ["peking duck house", 236290], ["serafina tribeca", 732637], ["serafina osteria", 460558], ["frenchette", 1028608], ["soothr", 1461292], ["san sabino", 1274416], ["momofuku noodle bar", 1072219], ["la grande boucherie", 1142380], ["exquisite restaurant", 1404829], ["new york city center", 107920], ["gallagher's steakhouse", 104182], ["bad roman", 1268701], ["carmine's - 44th street", 2295], ["the palm court", 42739], ["markjoseph steakhouse", 69349], ["strip house", 3181], ["the smith lincoln square", 98185], ["caviar russe", 6145], ["Northshore Brasserie", 269902], ["oceans", 1050274], ["chez josephine", 35647], ["Tarallucci E Vino Upper West Side", 261745], ["le veau d'or", 220387], ["odo", 1366528], ["sushi noz", 1283581], ["lady mendl's", 96886], ["westville ues", 1399819], ["joe allen", 107137], ["tony's di napoli", 3745], ["don angie", 994474], ["wild cherry", 1427557], ["cherry point", 444469], ["smith and wollensky", 6648], ["del frisco's double eagle steakhouse", 67849], ["quality italian", 110224], ["quality meats", 6438], ["quality bistro", 1048807], ["trattoria dell'arte", 31231], ["ocean prime", 149845], ["le rivage", 18745], ["Lattanzi Ristorante", 5920], ["the hunt and fish club", 151972], ["osteria al doge", 4568], ["Langan's Brasserie", 22071], ["Calle Dao Bryant Park", 149428], ["club a steakhouse", 21631], ["brasserie cognac east", 1464841], ["aretsky's patroon", 1300], ["park ave kitchen by david burke", 1266931], ["il corso", 27115], ["nami nori", 1210780], ["palma", 30196], ["anton's", 1307248], ["la marchande", 1242889], ["golden steer at one fifth", 1426876], ["Blue Ribbon Sushi Bar & Grill - Columbus Circle", 1335778], ["indian accent", 193822], ["grand central oyster bar", 268384], ["tao uptown", 1266], ["TAO Downtown Restaurant", 112918], ["stk - nyc midtown", 5923], ["mastro's steakhouse", 151816], ["morton's the steakhouse", 2741], ["sparks steak house", 78106], ["wolfgang's steakhouse", 3603], ["il mulino prime - soho", 147904], ["Aquavit Restaurant", 281], ["lincoln ristorante", 102115], ["hakkasan", 5002], ["philippe chow", 995113], ["mr chow", 42436], ["sushi on me", 1257526], ["gage and tollner", 1123618], ["caf\u00e9 mars", 1278811], ["clover hill", 1479529], ["michael's of brooklyn", 150217], ["frankies spuntino", 251353], ["maiella", 162811], ["Park Rose", 1463863], ["kochi", 1054912], ["sunn's", 1428529], ["beauty and essex", 1255435], ["locanda verde tribeca", 22762], ["wildair", 1173958], ["insa", 90991], ["aska", 334675], ["noda", 459310], ["tsukimi", 1047511], ["sushi by scratch restaurants", 1382866], ["tamarind - tribeca", 41389], ["trattoria zero otto nove - flatiron", 1424596], ["chambers", 145225], ["san carlo osteria piemonte", 212347], ["pera soho", 76933], ["da nico restaurant", 166810], ["lucky's soho", 1403800], ["lucky restaurant", 1435879], ["buona notte", 995437], ["olio e pi\u00f9 - bryant park", 1477168], ["the parliament new york", 1434793], ["fairfax", 985804], ["ilili restaurant", 15550], ["godunk thai street food", 1474591], ["sailor", 1474528], ["gjelina", 76651], ["momofuku noodle bar - uptown", 1392934], ["cecconi's dumbo", 730843], ["Hawksmoor Seven Dials", 1052086], ["Zou Zou\u2019s", 1197907], ["gigino trattoria", 3948], ["one dine", 172837], ["metropolis by marcus samuelsson", 1317532], ["gran morsi", 151951], ["industry kitchen", 161413], ["casa d'angelo new york", 1229806], ["One if by Land, Two if by Sea", 336], ["sushi on me williamsburg", 1412056], ["kaizen flushing", 1387495], ["yakiniku toraji", 1177648], ["nubeluz", 1328500], ["jaba nyc restaurant", 1423975], ["mike's bistro", 144154], ["la masseria", 21001], ["gaonnuri", 92776], ["casa carmen tribeca", 1226611], ["landmark cevicheria", 1460293], ["markette", 1380997], ["Korali Estiatorio", 167623], ["mrs. georgia", 1485112], ["panda restaurant", 1224304], ["brass", 1331476], ["Red Rooster Harlem", 1436560], ["noz 17", 1246441], ["tempura matsui", 172303], ["fogo de ch\u00e3o - brooklyn", 1344280], ["botte brooklyn", 1242835], ["henry's end", 1270645], ["jules", 1406191], ["khaosan", 1370884], ["Potluck Club \u4f70\u6a02", 1263916], ["mango bay", 1391695], ["parcelle chinatown", 1281262], ["emporio", 30754], ["palm street", 1457866], ["d garden", 1255381], ["aura cocina", 1068712], ["mymoon restaurant", 13906], ["be pasta", 1005574], ["altro paradiso", 212494], ["Christo's Steak House", 6109], ["il poeta", 74059], ["the smith - midtown", 72178], ["Carmine's Italian Restaurant - Upper West Side", 2296], ["Da Andrea Greenwich Village", 192976], ["St John's Restaurant", 84049], ["alley 41", 1462774], ["chalong", 1308475], ["chutney masala", 271555], ["la dong", 1390435], ["oso", 346570], ["Pranakhon Thai Restaurant", 1275997], ["tolo", 1356769], ["zaab zaab", 1260610], ["kabawa", 1412569], ["blu on the hudson", 1257628], ["demo", 1344496], ["di an di", 1279321], ["joseph leonard", 226681], ["le burger", 1319164], ["mitsuru", 1414090], ["muku", 1311958], ["parcelle greenwich village", 1381117], ["sappeisan", 1356454], ["little italy", 1228705], ["basta pasta", 267433], ["becco", 139195], ["il gattopardo", 99922], ["scalini fedeli", 6417], ["the palm", 13384], ["blt prime", 19300], ["bowery meat company", 152578], ["beefbar new york", 1329304], ["costata", 343939], ["atlantic grill", 1175752], ["lure fishbar", 1075021], ["flex mussels - ues", 1318996], ["little owl", 8033], ["sarabeth's", 36058], ["rosa mexicano", 4946], ["dos caminos", 1256302], ["Toloache Upper East Side", 68032], ["fonda of chelsea", 139885], ["amali", 4871], ["the smith - east village", 19258], ["the mermaid inn", 110988], ["majorelle", 192367], ["noz kitchen", 1208302], ["samwon garden", 1432876], ["miss korea", 115573], ["grand banks", 191182], ["Nomad Restaurant", 1239310], ["ammos estiatorio", 5796], ["ginger ristorante", 1466335], ["la boite en bois", 54394], ["pizzarte", 67183], ["loi estiatorio", 28960], ["delbianco italian restaurant", 1307260], ["wagamama - midtown", 1068469], ["brooklyn diner", 212800], ["socarrat east", 1281727], ["saperavi", 1467301], ["la pecora bianca bryant park", 1207555], ["la pecora bianca soho", 1182799], ["friedman's lunch", 1489594], ["skinos", 1248067], ["betty", 191617], ["Sabai Thai Restaurant", 1009492], ["lokal mediterranean kitchen", 348019], ["felice columbus", 1404796], ["dudley's", 257515], ["rucola restaurant", 20950], ["Hoexter\u2019s", 1279159], ["hayashi japanese cuisine", 1408222], ["ler lers", 1438759], ["u omakase", 1255084], ["thai cuisine", 334924], ["osteria nonnino", 1294987], ["london and martin co", 1005613], ["breeze", 1369933], ["cactus restaurant", 174400], ["piccola cucina uptown", 1068631], ["psaraki", 82420], ["chiko", 171985], ["bombay grill house", 1281415], ["bombay kitchen", 1430551], ["thai villa", 334744], ["thep thai restaurant", 1401595], ["barbounia", 5072], ["sala thai", 1023928], ["le monde", 349132], ["what the fish", 1278718], ["lulu mediterranean grill - edgewater", 1272766], ["zoi mediterranean nomad", 1379803], ["leticias restaurant", 1395307], ["tudor city steakhouse", 1321891], ["capt loui cajun seafood boil", 1458868], ["sojourn social", 1213360], ["l'osteria", 1215034], ["diwali indian cuisine", 1350520], ["il monello", 1269436], ["resident", 1100389], ["half moon", 262672], ["pure thai cookhouse", 238921], ["toro loco", 1017223], ["sushi yasaka", 76567], ["cull and pistol", 1022116], ["surfish bistro", 74362], ["la contenta", 1014631], ["piccoli trattoria", 243259], ["bernie's", 1376887], ["mariella", 269023], ["senza gluten by jemiko -100% gluten free restaurant", 1278301], ["may kaidee", 1321465], ["koma sushi", 1466113], ["tootles and french", 1359865], ["bixi", 63250], ["ikyu \u4e00\u4f11", 1293676], ["tulum brooklyn", 1374379], ["keg and lantern southside", 1021288], ["parker and quinn", 102817], ["fiore harlem", 1207060], ["beso", 762883], ["oceana", 178], ["wokuni broadway", 986998], ["satis bistro", 51094], ["vinateria", 160450], ["stone park", 1414477], ["gnoccheria east village", 242416], ["marshal", 247060], ["charoen krung thai", 1403164], ["agenda restaurant", 1366672], ["copinette", 1011319], ["wenwen", 1229422], ["kosher grill", 1491538], ["meet the meat", 172396], ["aunt jake's", 215104], ["tabu", 1324447], ["levant", 72700], ["deux amis", 111292], ["sfoglia", 58072], ["nisi estiatorio", 1274452], ["little ruby's williamsburg", 1377925], ["piccolo trattoria", 38011], ["naya", 3204], ["tanner smith's", 1326514], ["orale mexican kitchen restaurants jersey city", 104488], ["treadwell park", 1225828], ["maison harlem", 105004], ["barosa", 42103], ["superfine", 109453], ["ponty bistro", 1264960], ["fumo upper west side", 193816], ["citrico", 1266418], ["manchego", 1254664], ["little ruby's west village", 1311601], ["villa erasamo", 1464163], ["hudson hound", 188140], ["medium rare", 1380319], ["tra di noi", 110182], ["bird pepper", 1352587], ["grissini", 10585], ["limosneros", 231793], ["fumo kips bay", 1432669], ["botte ues", 1207576], ["just pho you", 1425325], ["sallys", 262915], ["nyy steak", 1496767], ["aliada restaurant", 88639], ["sandro's", 344095], ["the river palm terrace - edgewater", 1388086], ["rumba cubana", 1331809], ["cavatappi nyc", 1329493], ["emilia's", 1315969], ["pastavino", 1055140], ["54 below", 3716], ["7 spices", 1349767], ["a sushi", 144244], ["ainslie", 1211932], ["alfie's", 1308469], ["altesi ristorante", 145837], ["alwaha restaurant", 21216], ["amelie", 82891], ["amici ristorante", 1052695], ["amuni", 419175], ["amuse restaurant", 1363387], ["anejo", 148711], ["angelo gordon", 135899], ["animal", 1260211], ["barking dog nyc", 1220014], ["aperibar", 1267177], ["arabesque", 158528], ["arcadia", 1322983], ["aria west village", 986008], ["aroma brazil", 254538], ["asian kitchen", 4816], ["astoria provisions", 1493881], ["aunt butchies of brooklyn", 1005982], ["Baza\u0301r Tapas Bar & Restaurant", 984619], ["benjamin steakhouse prime", 10918], ["berlin currywurst", 388023], ["birdy's", 1189612], ["blackbarn", 5337], ["blend astoria", 267007], ["blue", 1400668], ["blue ribbon sushi izakaya", 160621], ["boon thai", 1437274], ["bottega restaurant", 40051], ["briciola", 1057042], ["bronx burger house", 1164655], ["brooklyn lantern", 190099], ["bubba gump shrimp co.", 1024645], ["Burger & Lobster - Bryant Park", 1195105], ["burger one nyc", 1358461], ["burgos restaurant", 357540], ["campagnola restaurant", 219844], ["capital restaurant", 34576], ["caribe restaurant", 469767], ["jasmine's caribbean cuisine", 1395208], ["casa galicia", 417105], ["cena", 1008295], ["charlie's place", 1404364], ["chihuahua", 1288132], ["china city", 756532], ["Chop Shop", 103945], ["cibao restaurant", 1071946], ["cielito", 1397332], ["cocina latina", 331704], ["codino", 109822], ["concettina", 402018], ["cotenna", 253276], ["crown heights mozzarella", 136066], ["central park boathouse restaurant", 1294132], ["curry leaf", 424920], ["dai hachi", 1039750], ["del frisco's grille", 730255], ["Denino's Greenwich Village", 343351], ["district tap house", 150865], ["il divino", 1259536], ["don miguel restaurant", 1144126], ["double rainbow", 118508], ["dragon garden", 138643], ["dumpling house", 1424407], ["Caffe Buon Gusto", 1477963], ["el salvador restaurant", 1368328], ["enzo's restaurant", 1276744], ["ernesto's", 1064494], ["essen", 205167], ["essex taqueria", 1266922], ["factory 380", 1386358], ["family kitchen", 189961], ["famous", 313840], ["fratelli restaurant", 289764], ["fushimi at times square", 1292557], ["gazala's", 238465], ["gelso & grand", 1361086], ["global kitchen", 1241422], ["gyu kaku", 7703], ["havana height", 1090282], ["henry & the lions", 1347988], ["hilton garden inn long island city", 1062907], ["hong kong restaurant", 290579], ["ikea", 421467], ["impasto", 205047], ["inca's grill peruvian kitchen", 293158], ["inday", 1370200], ["istanbul bay", 1360291], ["japonica", 198781], ["javelina", 1201135], ["joanne trattoria", 103105], ["josie's", 1224313], ["kanan", 1147168], ["kandela", 1083319], ["kiku japanese cuisine", 1475989], ["king's kitchen", 988825], ["kitchen grill", 87019], ["kumo", 1271257], ["kyoto sushi", 124820], ["l'angeletto", 1092370], ["l'express", 335782], ["la mesita", 1210195], ["La Nacional Restaurant", 1015270], ["lafayette", 105322], ["le jardinier nyc", 1041964], ["lex restaurant", 1421917], ["lima", 1425832], ["limani", 1214593], ["living room", 289092], ["los amigos restaurant", 1235608], ["ltauha", 252202], ["madison restaurant", 1231321], ["mama's", 1460638], ["mama pisco kitchen", 1042156], ["mama rosa's", 347160], ["mamasushi", 1317040], ["manhattan west", 79393], ["marcellino", 1339957], ["margarita island", 984949], ["marian's", 168364], ["marina restaurant", 11887], ["marrakesh", 1484632], ["max", 64861], ["medusa", 445656], ["mexican american restaurant", 160426], ["lolita", 82939], ["mila's bistro", 1165708], ["mirador restaurant", 1174156], ["misirizzi", 1392820], ["miyako", 263095], ["mizu sushi", 36541], ["momo ramen", 151737], ["monty's nyc", 1275421], ["morso", 1152931], ["mountain fusion", 1052236], ["muse", 1481041], ["mussels & more", 30211], ["nana's kitchen", 1010182], ["new york burger co.", 7865], ["newtown", 1365697], ["nick's bistro", 334963], ["nomo soho", 57043], ["nordstrom bistro verde", 1038469], ["The North Fork", 1036561], ["nusret steakhouse", 988885], ["oasis", 1069150], ["ofrenda", 1215337], ["olympia steakhouse", 198037], ["osteria 106", 1027621], ["oxido", 97156], ["ozen", 53426], ["palace restaurant", 1428691], ["panini grill", 238648], ["patricia's", 51244], ["patrizia's of maspeth", 1048972], ["pedro's", 206562], ["ponte vecchio", 1388074], ["porchlight", 1072027], ["port o call", 1467625], ["press box", 1282756], ["pronto restaurant", 1053970], ["puebla restaurant", 1238722], ["puerto plata restaurant", 1402387], ["qingdao", 136226], ["queens burger", 1485586], ["queens palace", 1187032], ["r40", 1052983], ["rebecca's edgewater", 1386283], ["republica", 1165546], ["circle", 1474903], ["rocco's steakhouse", 1388695], ["rogers burgers", 1425802], ["rw prime", 230029], ["sagar restaurant", 190140], ["sage", 1266619], ["sajoma", 1253278], ["salsa con fuego", 251827], ["san marzano", 1418368], ["pietro's", 986275], ["santa ana restaurant", 59998], ["santo domingo restaurant", 267175], ["sapphire", 1380403], ["sapporo", 53594], ["senza gluten", 1496218], ["serafina always", 104029], ["shanghai chinese restaurant", 236299], ["shogun japanese restaurant", 136458], ["sofia's taqueria", 1026466], ["sonora", 1268239], ["souvlaki gr midtown", 186463], ["spice", 1351921], ["spice & grill", 162888], ["spring", 1083082], ["spring food spot", 1362397], ["spring garden restaurant", 1146820], ["springfield little dumpling", 392754], ["ssam", 174870], ["st. cloud, charlie palmer at the knick", 33133], ["verona american grill", 150565], ["sunny restaurant", 1363453], ["sunrise", 1038397], ["surf city", 1465357], ["surprise scoop", 1279711], ["Swagat Indian Cuisine", 145321], ["tandoor restaurant", 78766], ["taste of punjab", 135767], ["tequila & mezcal", 1237057], ["Testo Restaurant", 422103], ["Thai72", 1293373], ["that sushi spot", 1062823], ["the butcher's daughter", 187420], ["the common", 327352], ["the edge", 729940], ["the grounds of brooklyn", 171773], ["the harold", 1237696], ["The Meatball Shop - Hell's Kitchen", 1282117], ["the penthouse", 1267852]];

  const TIMES = [
    { time: '17:45', label: 'early', baseHour: 17.75 },
    { time: '19:30', label: 'prime', baseHour: 19.5 },
    { time: '21:00', label: 'late', baseHour: 21 }
  ];

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  console.log('%c[OT Part 1/3] ' + ENTRIES.length + ' restaurants x 3 times for ' + DATE, 'color: #00b894; font-weight: bold');

  const results = {};
  window.__OT_AVAIL = results;

  for (let t = 0; t < TIMES.length; t++) {
    const { time, label, baseHour } = TIMES[t];
    let found = 0;
    console.log('\n\u{1f4c5} Checking ' + label + ' (' + time + ')...');

    for (let i = 0; i < ENTRIES.length; i += BATCH_SIZE) {
      const batch = ENTRIES.slice(i, i + BATCH_SIZE);
      const rids = batch.map(b => b[1]);

      try {
        const res = await fetch('https://www.opentable.com/dapi/fe/gql?optype=query&opname=RestaurantsAvailability', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF_TOKEN, 'ot-page-group': 'search', 'ot-page-type': 'search_results', 'x-query-timeout': '4000' },
          body: JSON.stringify({ operationName: 'RestaurantsAvailability', variables: { onlyPop: false, forwardDays: 0, requireTimes: false, requireTypes: [], privilegedAccess: [], restaurantIds: rids, date: DATE, time: time, partySize: PARTY_SIZE, databaseRegion: 'NA', restaurantAvailabilityTokens: rids.map(() => TOKEN), slotDiscovery: rids.map(() => 'on'), loyaltyRedemptionTiers: [], attributionToken: '' }, extensions: { persistedQuery: { version: 1, sha256Hash: GQL_HASH } } })
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

          if (!results[name]) results[name] = { rid, early_slots: [], prime_slots: [], late_slots: [], checked_date: DATE };

          const slots = (rd?.availabilityDays?.[0]?.slots || []).filter(s => s.isAvailable);
          for (const slot of slots) {
            const h = baseHour + (slot.timeOffsetMinutes || 0) / 60;
            const hr = Math.floor(h), mn = Math.round((h - hr) * 60);
            const ap = hr >= 12 ? 'pm' : 'am';
            const h12 = hr > 12 ? hr - 12 : hr === 0 ? 12 : hr;
            const timeStr = h12 + ':' + String(mn).padStart(2, '0') + ap;

            if (h >= 17 && h < 18.5) {
              if (!results[name].early_slots.includes(timeStr)) results[name].early_slots.push(timeStr);
            } else if (h >= 18.5 && h < 20.25) {
              if (!results[name].prime_slots.includes(timeStr)) results[name].prime_slots.push(timeStr);
            } else if (h >= 20.5) {
              if (!results[name].late_slots.includes(timeStr)) results[name].late_slots.push(timeStr);
            }
          }
          found++;
        }
      } catch (e) {}
      await sleep(500);
    }

    console.log('  \u2192 ' + found + ' restaurants checked for ' + label);
    window.__OT_AVAIL = results;
  }

  // Calculate tiers
  let open = 0, limited = 0, booked = 0;
  for (const [name, r] of Object.entries(results)) {
    const e = r.early_slots.length > 0;
    const p = r.prime_slots.length > 0;
    const l = r.late_slots.length > 0;
    r.has_early = e;
    r.has_prime = p;
    r.has_late = l;
    r.early = e ? 'available' : 'booked';
    r.prime = p ? 'available' : 'booked';
    r.late = l ? 'available' : 'booked';
    r.dinner_slots = r.early_slots.length + r.prime_slots.length + r.late_slots.length;
    r.sample_times = [...r.early_slots, ...r.prime_slots, ...r.late_slots].slice(0, 10);

    if (e && p && l) { r.tier = 'open'; open++; }
    else if (r.dinner_slots === 0) { r.tier = 'booked'; booked++; }
    else { r.tier = 'limited'; limited++; }
  }

  console.log('\n%c[Phase 1 Done] \u{1f7e2}' + open + ' \u{1f7e1}' + limited + ' \u{1f534}' + booked, 'color: #00b894; font-weight: bold');

  // Phase 2: Future check for booked
  const bookedEntries = ENTRIES.filter(([n]) => results[n]?.tier === 'booked');
  if (bookedEntries.length > 0) {
    console.log('\n\u{1f52e} Phase 2: Future check for ' + bookedEntries.length + ' booked restaurants');
    const OFFSETS = [2, 3, 7, 14];
    let opensUp = 0, locked = 0;

    for (const [name, rid] of bookedEntries) {
      let opensIn = null;
      for (const offset of OFFSETS) {
        const fd = new Date(); fd.setDate(fd.getDate() + offset);
        const fDate = fd.toISOString().split('T')[0];
        try {
          const res = await fetch('https://www.opentable.com/dapi/fe/gql?optype=query&opname=RestaurantsAvailability', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF_TOKEN, 'ot-page-group': 'search', 'ot-page-type': 'search_results', 'x-query-timeout': '4000' },
            body: JSON.stringify({ operationName: 'RestaurantsAvailability', variables: { onlyPop: false, forwardDays: 0, requireTimes: false, requireTypes: [], privilegedAccess: [], restaurantIds: [rid], date: fDate, time: '19:30', partySize: PARTY_SIZE, databaseRegion: 'NA', restaurantAvailabilityTokens: [TOKEN], slotDiscovery: ['on'], loyaltyRedemptionTiers: [], attributionToken: '' }, extensions: { persistedQuery: { version: 1, sha256Hash: GQL_HASH } } })
          });
          if (!res.ok) continue;
          const json = await res.json();
          const avail = json?.data?.availability || [];
          const rd = avail.find(a => a.restaurantId === rid);
          if (rd) {
            const slots = (rd?.availabilityDays?.[0]?.slots || []).filter(s => s.isAvailable);
            if (slots.length >= 2) { opensIn = offset; break; }
          }
        } catch(e) {}
        await sleep(700);
      }
      if (opensIn) {
        results[name].opens_in = opensIn;
        opensUp++;
        console.log('  \u{1f7e2} ' + name + ': opens +' + opensIn + 'd');
      } else {
        results[name].fully_locked = true;
        locked++;
        console.log('  \u{1f512} ' + name + ': locked');
      }
    }
    console.log('\n   \u{1f7e2} Opens up: ' + opensUp + '  \u{1f512} Locked: ' + locked);
  }

  window.__OT_AVAIL = results;
  console.log('\n' + '='.repeat(50));
  console.log('\u2705 Done! ' + Object.keys(results).length + ' restaurants');

  const blob = new Blob([JSON.stringify(results, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ot_tonight_avail_part1.json';
  a.click();
})();