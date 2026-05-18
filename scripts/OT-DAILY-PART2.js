(async () => {
  const DATE = new Date().toISOString().split('T')[0];
  const PARTY_SIZE = 2;
  const GQL_HASH = 'cbcf4838a9b399f742e3741785df64560a826d8d3cc2828aa01ab09a8455e29e';
  const BATCH_SIZE = 3;
  const TOKEN = 'eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjowLCJuIjowfQ';

  let CSRF_TOKEN = window.OT_CSRF || document.cookie.match(/csrf_token=([^;]+)/)?.[1];
  if (!CSRF_TOKEN) { CSRF_TOKEN = prompt('Paste CSRF for Part 2/3:'); }
  if (!CSRF_TOKEN) { console.error('No CSRF'); return; }
  window.OT_CSRF = CSRF_TOKEN;

  const ENTRIES = [["the pomeroy", 212056], ["the stinger", 985759], ["The Terrace And Outdoor Gardens", 4664], ["tijuana", 1393894], ["trattoria il gusto", 732517], ["the art of prime", 187072], ["yamato", 318900], ["Osteria Delbianco Midtown", 1065583], ["merchants ny", 456762], ["mera", 83845], ["sunday to sunday", 1330483], ["festival", 1122760], ["sesamo restaurant", 1069174], ["chef papa vietnamese kitchen", 1481866], ["the lions", 1433980], ["warique", 1210783], ["spanglish", 1359898], ["baci", 317847], ["yogi by barnjoo", 1216453], ["marbella", 1425421], ["cka ka qellue", 1130173], ["masala king", 1378504], ["supreme restaurant", 266029], ["simply greek", 1193503], ["saigon social", 1144579], ["yara", 1040596], ["mista oh", 1144366], ["atithi indian cuisine", 1192015], ["paola's restaurant", 1361659], ["the gallery", 1374229], ["belo", 117358], ["rustico", 242167], ["oita", 291903], ["lil chef mama", 87547], ["chef yu", 242299], ["rosa's at park", 1198819], ["sabor argentino", 1204168], ["los dos hermanos", 1411408], ["ambo", 1175209], ["neta shari", 1228567], ["the rabbit hole", 1113472], ["Patrick's Restaurant", 34009], ["flame", 1054327], ["spes", 1228861], ["moko", 1207474], ["bad habits", 1230778], ["sereneco", 1208164], ["the mayfly", 1431280], ["sip sak", 1471564], ["el zason", 1214026], ["hey yuet", 1244986], ["valbella at the park", 87394], ["Valbella Midtown", 1231504], ["the dawson", 1491391], ["sobre masa", 1213048], ["reyna restaurant", 168805], ["maestro pasta", 1267753], ["ramerino prime italian restaurant", 10447], ["fresco's grand cantina", 1218565], ["sessions", 1246570], ["daddies", 1257574], ["kantu peruvian cuisine", 1276024], ["dim sum sam", 1274422], ["nudibranch", 1238359], ["jaz indian cuisine", 1229818], ["peaches prime", 1438567], ["momoya soho", 1328854], ["mino brasserie", 1232089], ["brooklyn kebab house", 1489915], ["akdeniz mediterranean cuisine", 1479478], ["addictive nyc", 1257529], ["yasouvlaki", 1240981], ["l'amore restaurant", 1231750], ["essential by christophe", 1296886], ["masseria east", 220543], ["shan", 1462447], ["gatsby's landing", 1237513], ["harlem breakfast club", 731647], ["sushi lab - east village", 90400], ["mochi dolci", 1270633], ["rice x beans", 1036375], ["naro", 1268866], ["dimsum garden", 1359391], ["amber", 1464550], ["taco vista (governors island)", 1448224], ["manhattan valley", 44515], ["sugar'd", 1364446], ["il tinello", 1259956], ["casa cruz", 1396297], ["secret kitchen", 168956], ["monterey", 1242103], ["the ainsworth midtown", 142273], ["jupiter", 1251379], ["kalye", 1278193], ["El Paso Mexican Restaurants East Harlem", 1158406], ["bellini", 229045], ["valdari", 1267909], ["plue", 986089], ["uncle ted's", 1320898], ["mermaid oyster bar times square", 1233247], ["diaspora", 1340860], ["gosht restaurant", 1272238], ["sally's caribbean restaurant", 1284832], ["o'toole's way", 1063342], ["via toscana", 1268776], ["yves", 334822], ["fiorentina steakhouse", 1312015], ["ketchy shuby", 1275217], ["the corner chinese restaurant", 1282405], ["tinos", 1357879], ["song e' napule uws", 1005166], ["mesiba", 1266421], ["zara forest", 1485181], ["zara terrace mediterranean restaurant", 1485013], ["ambra", 1328782], ["porta 23", 191431], ["tara kitchen tribeca", 1435009], ["kraam", 1403569], ["sushi goda", 1287553], ["mama mezze", 1482988], ["mamazul", 1309417], ["malone's", 1319872], ["florentin", 118003], ["Docks Oyster Bar - Midtown East, Nyc", 35893], ["the laurels", 1328290], ["mr. broadway restaurant", 1342942], ["the shell", 1276408], ["le chai", 480922], ["zen astoria", 1348429], ["harbor nyc", 253246], ["rice bird", 1344652], ["yayo's latin cuisine", 1421926], ["tokugawa", 1310197], ["water & wheat", 1346821], ["seahorse", 1348330], ["jimmy's on the go", 48460], ["fossetta", 1363492], ["the red stache", 1291558], ["blue ribbon sushi and steak", 1021735], ["meraki greek bistro", 1322275], ["mykonian house", 1390303], ["mexi", 1384624], ["peking house", 109144], ["yingtao", 1295479], ["shhh omakase", 1334689], ["lagos tsq", 1237165], ["poppy's", 1400527], ["osteria delbianco bryant park", 1331539], ["curry flavor", 1334077], ["cloves indian cuisine", 1333927], ["oyamel", 1101643], ["sushi ouji", 1227028], ["boske", 1342744], ["fred's", 269122], ["bombay grill", 212098], ["little maven", 1369840], ["roscioli nyc", 152566], ["animo!", 1421236], ["fusion kitchen", 1477120], ["bally's golf links", 1363624], ["yokox omakase", 1362172], ["kizuna", 1283566], ["serena bistro", 1340215], ["flavor east", 1479427], ["kaew jao jorm", 1403101], ["lava rock kitchen", 1379896], ["l'incontro by rocco", 1369099], ["little honey", 1403254], ["mansion", 1367293], ["hyun", 1042186], ["Altair Restaurant", 1335472], ["early terrible", 1182805], ["greyz bistro", 1390147], ["sozai japanese restaurant (izakaya ramen)", 1377130], ["simply caribbean", 1055389], ["santi", 1389610], ["pb brasserie", 1383910], ["miss nellie's", 1387666], ["salad house of brooklyn", 1230112], ["la contenta les", 253987], ["yezo thai isankaya", 1230202], ["the mouth", 1403188], ["lundy's of brooklyn", 1417438], ["ming mun", 1437466], ["lulla", 1287094], ["tutto apposto", 1408576], ["upon the palace", 1399753], ["dumpling", 103810], ["lume west village", 1402666], ["gaia restaurant", 1389583], ["audace", 1394212], ["house of pasta", 1397323], ["dagg thai restaurant", 232369], ["sushi counter", 1238299], ["kei", 78148], ["dilli dilli", 1395760], ["aves", 1439167], ["patrick's on the hill", 1431049], ["messy", 1284862], ["sarabeth's greenwich village", 102730], ["bananas", 1377592], ["lele", 1430824], ["sushi beauu", 1411447], ["castell's", 1018810], ["enso omakase", 1406629], ["xisan de classic", 1438558], ["fushimi at bay ridge", 149560], ["altamirano's italian ristorante", 1433932], ["happy cake bistro", 1485673], ["bartolo", 1389607], ["tenjou new york", 1438537], ["maison nur", 1458571], ["casa colven", 1422211], ["nuyores", 1459951], ["wok in duane", 1468528], ["uka omakase", 1475236], ["inkaico", 1323652], ["teruko", 1470052], ["bucatini", 1423393], ["borik\u00e9n", 1458526], ["ubani bistro", 1474177], ["miriam west village", 1481440], ["emporium brasil", 218188], ["history", 1425028], ["d kitchen", 299449], ["palladino's", 1409887], ["limusina", 1448041], ["greca", 1210060], ["the east pole", 107512], ["yum cha restaurant", 1345993], ["soothr lic", 116164], ["ikyu sushi ii", 1469323], ["jan jao kha", 1468732], ["renaissance times square", 988573], ["elias casa bianca", 90223], ["telio", 1483153], ["bufon", 52456], ["roast", 3783], ["la cava", 114262], ["sunday", 1168609], ["leandro's kitchen & wine", 1487926], ["le bistroquet", 101122], ["giulietta", 1402591], ["pulperia latin mediterranean kitchen", 1460650], ["Santa Fe Restaurant", 1043479], ["Bobby Van's Steakhouse - 50th Street", 4567], ["bobby van's grill", 7289], ["Melba's Restaurant", 232258], ["rebel", 1432960], ["Match 65 Brasserie", 6420], ["smoke & mirrors", 1226545], ["baci & abbracci", 1146772], ["la nonna", 215710], ["hell's kitchen", 1349761], ["jadis", 236503], ["buenos aires", 107185], ["mr. chow tribeca", 28759], ["the mean fiddler", 478183], ["nica trattoria", 236296], ["trattoria 35", 2216], ["juliette", 251191], ["boqueria", 992293], ["nizza", 29137], ["the grey dog", 1146670], ["trattoria tre colori", 216481], ["matteo's of howard beach", 1345927], ["blend", 82540], ["the russian tea room", 7626], ["buceo 95", 215659], ["madison & vine", 19306], ["The Vine", 65266], ["casa di isacco", 1360072], ["shi", 1048321], ["lavagna", 38509], ["siena", 994609], ["deniz turkish mediterranean", 1014082], ["mazzat", 90628], ["petite boucherie", 157048], ["fabrika", 1426240], ["the archer", 275144], ["salvaje social club nyc", 1321192], ["matsuri", 109243], ["paros tribeca", 1329034], ["talay", 1423012], ["yard house", 1499092], ["lobster place", 314788], ["el santo", 1329835], ["marty's", 1273819], ["blue anchor", 410409], ["da raffaele", 188257], ["saigon bistro", 1498726], ["deccan spice", 1120852], ["aurora brooklyn", 96874], ["barzola", 140968], ["shokudo", 1470925], ["prime time", 1339894], ["5 napkin burger - hell's kitchen", 22765], ["atlas kitchen", 1030606], ["coral omakase", 1318897], ["Frida", 145657], ["madame", 1295464], ["the otter", 1386088], ["prime bistro", 1272577], ["sloane's", 1386091], ["zara forest grill", 1486006], ["fish grill - brooklyn", 284614], ["la sova", 472989], ["bergen hall", 1277287], ["Paesano of Mulberry Street", 26122], ["Da Andrea - Chelsea", 1328881], ["wagamama - Murray Hill", 1027582], ["The Jin", 1043158], ["Zaytinya - New York", 1183219], ["Risotteria Melotti NYC", 1005856], ["Balvanera", 152380], ["Trattoria Pesce Pasta", 239758], ["Barolo East", 1032436], ["Bombay Bistro", 144433], ["Patrizia's Of Sheepshead Bay", 1239529], ["Mezze on the River", 1245115], ["Momokawa", 266611], ["Osteria Nando", 1131385], ["Alice Restaurant", 1313887], ["Finestra Restaurant", 42829], ["Blue Ribbon Sushi Bar & Grill - Financial District", 1228645], ["Allora Fifth Ave", 1262110], ["Le Jardin Bistro", 1386064], ["George's", 1250911], ["IL Punto Ristorante", 4042], ["Ribalta", 1493359], ["Blue Fin", 30505], ["Cuba", 346609], ["Bustronome New York", 1377070], ["Pershing Square Restaurant", 219301], ["Fogo de Chao Brazilian Steakhouse", 40552], ["Via Brasil Restaurant", 239761], ["Rosemary's West Village", 150718], ["Ristorante Il Melograno", 19492], ["Redeye Grill", 31216], ["The Grey Dog (Chelsea)", 389038], ["Banter", 47848], ["Mari Vanna", 34735], ["Le Parisien", 57316], ["The Grey Dog (West Village)", 1146658], ["Nougatine at Jean Georges", 3297], ["The Grey Dog (Union Square)", 1146676], ["wagamama, nomad, new york", 1008775], ["Butcher & Banker NYC", 987040], ["Bread & Butter", 1004143], ["Il Mulino New York", 125724], ["Tarallucci e Vino Union Square", 24979], ["Gnocco", 36592], ["The Wilson", 1026124], ["Under The Bridge", 1020640], ["Cowgirl", 278254], ["Pomodoro Rosso", 111208], ["Seven Hills Mediterranean Grill", 1387627], ["Mezzaluna", 26302], ["Maz Mezcal", 225757], ["Valhalla", 991714], ["Bobby Van's Steakhouse - 54th Street", 6767], ["Sauce", 113692], ["Tio Pepe", 86482], ["Sons of Essex", 13675], ["Punch", 7525], ["Bedford & Co.", 55666], ["Via 13", 76384], ["Westville Chelsea", 228472], ["Giano Restaurant", 37102], ["Om", 63796], ["La Bella Vita", 98683], ["Maya by Chef Richard Sandoval - NYC", 2501], ["Gao's BBQ & Crab", 1347895], ["Medusa The Greek", 1259230], ["Izakaya", 193846], ["Yopparai", 85645], ["Bill's", 110521], ["La Vecina", 1186222], ["Le Gigot", 33067], ["Bistro Vendome", 2535], ["Rickard Ridge BBQ", 2298], ["Churrascaria Plataforma", 14839], ["Forno Grill", 112282], ["Amata", 14275], ["Sardi's Restaurant", 1703], ["The Perfect Pint", 76822], ["Rossini's Restaurant", 63403], ["Trinity Place", 14812], ["Jackson Hole Burgers", 235450], ["Osteria Laguna Restaurant", 12196], ["La Pecora Bianca Nomad", 189079], ["Masseria Dei Vini", 151432], ["Il Cantinori", 6242], ["Russian Samovar", 334735], ["Uncle Jack\u2019s Steakhouse Westside", 2654], ["Wolfgang's Steakhouse - Tribeca", 6491], ["Trattoria Bianca", 18766], ["Novita", 30202], ["Alcala Restaurant", 101], ["A la Turka", 35173], ["Sushi of Gari 46", 17965], ["Bistango at the Kimberly Hotel", 152107], ["Row House", 189436], ["Il Violino", 41950], ["Da Umberto", 108874], ["Toledo Restaurant", 144997], ["Barawine", 114856], ["Restaurant Nippon", 45151], ["Jasper's Taphouse", 255265], ["Gari Columbus", 4196], ["Carroll Place", 1426318], ["Luna Rossa Ristorante", 63865], ["Fulton Fish Co.", 265163], ["La Mela", 60160], ["Rosso", 1028644], ["Caliente Cab Co.", 254017], ["The Stand", 86878], ["La Bergamote (Chelsea)", 105370], ["Bite", 1409815], ["Tarallucci e Vino NoMad", 261748], ["Sushi Ryusei", 1023988], ["Bubo", 1029376], ["Bazaar Meat", 1183222], ["Sinigual", 24487], ["Brasserie Cognac Midtown East", 1272856], ["Thai Pavilion NYC", 1476229], ["AOC East", 443365], ["Red Star", 1234903], ["BKK New York", 1415416], ["txula steak", 1463491], ["zimmis", 1350598], ["LA FUSTA", 225358], ["POKE", 242224], ["SANGARITA'S", 192763], ["THE EVERGREEN", 248356], ["nerina", 1462069], ["tha phraya", 1364308], ["Artesano", 1296847], ["Souvlaki Gr", 81409], ["Stk Meatpacking", 7098], ["The Boil Brooklyn", 1490755], ["The Modern", 3695], ["Eataly NYC Flatiron - Il Pesce", 152836], ["Gargiulo's Coney Island", 166234], ["Sugar Factory - Time Square", 1224835], ["\u00c7ka Ka Q\u00ebllu", 1008895], ["t\u00e1n by Chef Richard Sandoval", 1259293], ["Amylos", 991990], ["Da' Franco & Tony's Ristorante", 173623], ["The Alderman", 1283761], ["Botte Ditmars", 1421797], ["Amelie - UWS", 1183693], ["The Butcher's Daughter - Nolita", 1203121], ["Giardino 54", 64705], ["The Marshal", 1180861], ["Antoya (fka Samwon Garden)", 1009441], ["BONDST Hudson Yards", 1292767], ["Cafe Cluny", 8027], ["Cafe d'Alsace", 6363], ["Eataly NYC Soho - Il Ristorante", 1329094], ["Emily West Village", 732124], ["Fogo de Ch\u00e3o - New York - World Trade Center", 1381732], ["Frankie & Johnnie's Steakhouse - Manhattan", 2792], ["Fumo UES", 1036774], ["Lure New York", 3358], ["Marlow East", 1424188], ["Mermaid Inn Upper West Side", 1123207], ["Nami Nori West Village", 1283572], ["Reilly's Plates & Pours", 262690], ["Rosa Mexicano - Lincoln Center", 1207771], ["San Babila", 1413223], ["San Matteo", 1277488], ["Serafina 79", 211075], ["Street Taco", 989140], ["The Dining Room at RH Guesthouse New York", 1092874], ["WILD - West Village", 158068], ["Blue Note", 480520], ["Fine & Rare", 100438], ["Skin Contact", 1086838], ["Viva Toro", 161926], ["clark's", 93517], ["crane club", 1387297], ["deja vu", 1481998], ["estela", 212488], ["foxy", 1403008], ["lailas", 1384936], ["maria's", 1021942], ["nono", 390357], ["patiala grill", 1323238], ["rynn", 1329181], ["vetro", 34984], ["Afghan Kebab House", 91891], ["Dulce Vida Latin Bistro", 92353], ["Pasta Corner", 1329169], ["Five Acres", 1251205], ["Caf\u00e9 D'Anvers", 1185301], ["Kaiyo Omakase", 1389331], ["AnTalia", 63739], ["Bond 45", 1318528], ["Mapo Asian Restaurant", 1460437], ["Mari", 1237195], ["Hyo Dong Gak", 237601], ["Han Bat Restaurant", 1242289], ["Mama Mia", 144406], ["Via Vai", 149557], ["Roberta's", 1267768], ["Knori Hand Roll Bar", 1461037], ["Casa Carmen - Flatiron", 1359169], ["Oyamel Cocina Mexicana", 1421776], ["Kyma", 1123090], ["Afuri Ramen", 1376770], ["Socarrat Nolita", 58891], ["Seven Valleys", 1269766], ["Fonda Tribeca", 1237951], ["Westville Dumbo", 349276], ["Kiosko 787", 1425970], ["Mario's Restaurant", 104587], ["Lilli Restaurant", 1323382], ["Matisse 167", 87889], ["Kamal Palace", 1090168], ["Laila", 290712], ["NoMa Social", 66856], ["179 Bar & Grill", 1142341], ["Ariella's Restaurant", 1402240], ["Naxos Estiatorio", 1026277], ["Fusion 27", 1213069], ["Anatolia", 1427164], ["fil\u00e9 gumbo bar", 1178713], ["casa mono / bar jamon", 34048], ["warren street bar and restaurant", 1235140], ["papillon bistro and bar", 6584], ["drift restaurant and bar", 1345699], ["ovelia psistaria bar", 1265713], ["china bar", 301559], ["rh rooftop restaurant at rh", 1050247], ["savvy bistro and bar", 1054981], ["gabriel's bar & restaurant", 58741], ["haymaker bar & kitchen", 256153], ["pico de gallo bar & kitchen", 1259050], ["route bar restaurant", 1242730], ["Shalel Kitchen & Bar", 237325], ["gu japanese fusion sushi & bar", 1012894], ["BuenaVista Restaurant & Bar", 1023658], ["Thai Tara Sushi & Bar", 1348912], ["Sean's Bar And Kitchen", 1071337], ["West End Bar & Grill", 1426390], ["Socarrat Paella Bar - Chelsea", 60874], ["Knickerbocker Bar & Grill", 45412]];

  const TIMES = [
    { time: '17:45', label: 'early', baseHour: 17.75 },
    { time: '19:30', label: 'prime', baseHour: 19.5 },
    { time: '21:00', label: 'late', baseHour: 21 }
  ];

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  console.log('%c[OT Part 2/3] ' + ENTRIES.length + ' restaurants x 3 times for ' + DATE, 'color: #00b894; font-weight: bold');

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
  a.download = 'ot_tonight_avail_part2.json';
  a.click();
})();