(async () => {
  const DATE = new Date().toISOString().split('T')[0];
  const PARTY_SIZE = 2;
  const GQL_HASH = 'cbcf4838a9b399f742e3741785df64560a826d8d3cc2828aa01ab09a8455e29e';
  const BATCH_SIZE = 3;
  const TOKEN = 'eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjowLCJuIjowfQ';

  let CSRF_TOKEN = window.OT_CSRF || document.cookie.match(/csrf_token=([^;]+)/)?.[1];
  if (!CSRF_TOKEN) { CSRF_TOKEN = prompt('Paste CSRF for Part 3/3:'); }
  if (!CSRF_TOKEN) { console.error('No CSRF'); return; }
  window.OT_CSRF = CSRF_TOKEN;

  const ENTRIES = [["Pineapple Club", 1050919], ["k sushi & bar", 1418608], ["Village Taverna", 187549], ["tavern on the green", 118102], ["Glass House Tavern", 32650], ["Taverna by Gyro Project", 1463938], ["ez paella and tapas", 1229998], ["Caravaggio New York", 38926], ["Roscioli", 1419004], ["bar rocco", 1492840], ["bar mexicana", 1328575], ["bar san miguel carroll gardens", 1014709], ["dao dim sum & chinese cuisine", 1368226], ["la nonna ristorante & bar", 141607], ["Numero 28 Pizzeria - West Village", 188065], ["Emmy Squared Pizza - Upper East Side", 1262035], ["red hook tavern", 1048522], ["arturo's", 237589], ["scarr's pizza", 1216000], ["r slice pizza", 230599], ["lola's", 1344301], ["bar kabawa", 1387021], ["zimmi's", 15751], ["lodi", 1268917], ["gui steakhouse nyc times square", 1275472], ["china kitchen", 35927], ["golden dragon restaurant", 1054330], ["green lake", 158545], ["kuzina", 278799], ["prime astoria", 1227829], ["puebla mexican food", 1496965], ["puebla puebla", 1030372], ["puerta del sol", 393813], ["taste of italy", 1308400], ["eatzy thai", 1194202], ["jue lan club", 191161], ["blake\u2019s tavern", 1492048], ["c\u00f4 l\u1ea1c", 1039162], ["nounou", 1490017], ["wanglang", 1492888], ["Next Door by Wegmans \u2013 NoHo", 1410961], ["Brooklyn Chop House - Downtown", 1017331], ["Foxtail", 1242220], ["The Highlight Room NY", 1269739], ["Hide Rooftop", 1328422], ["Smyth Tavern", 1260085], ["ABC Kitchen", 570], ["Bookmarks", 1025197], ["Sarabeth\u2019s Greenwich Village", 1388308], ["Cath\u00e9drale", 1046641], ["Fraunces Tavern", 45523], ["Antica 'Ancora'", 116047], ["Patrizia's of 2nd Avenue", 173674], ["Soothr East Village", 1084915], ["Eataly NYC Downtown - Vino &", 1014571], ["Casasalvo", 1458070], ["Grand Brasserie", 1363489], ["Legasea Bar & Grill", 745729], ["The Butcher's Daughter - Williamsburg", 1317235], ["Savelli Restaurant and Bar", 1071061], ["London & Martin Co.", 1322743], ["Westville - East Village", 257821], ["Dirty French NYC", 151027], ["Friedman's - Battery Park", 1331485], ["Craft", 2085], ["Eataly NYC Flatiron - AMALFI Rooftop by Birreria", 152821], ["Olio e Pi\u00f9\u2013 Greenwich Village", 55837], ["Fellini", 1385662], ["Roberta's - Domino Park", 1406719], ["ART SoHo", 1040839], ["Everything's Jake NYC Bar & Lounge", 1284766], ["Chelsea Ristorante Italiano", 31204], ["Funny Bar", 1447963], ["Blue Ribbon Sushi - Sullivan St", 1085551], ["The Mermaid Inn - Chelsea", 1053313], ["Little Ruby's - West Village", 1311439], ["Little Ruby's - Murray Hill", 1311598], ["Orient Express Cocktail Bar", 90538], ["Two Twenty One Restaurant", 1469839], ["Zutto Tribeca", 1026358], ["White Oak Tavern", 145786], ["Ruta Oaxaca - Brooklyn", 1361029], ["SIMPLE \u0628\u0633\u064a\u0637", 487612], ["Caf\u00e9 Fleuri", 263413], ["Turks & Frogs", 478663], ["Penthouse on Park", 1220269], ["Bar Primi Penn District", 1376434], ["Eataly NYC Flatiron - Bar Milano", 1108453], ["Amelias", 1270021], ["Wolfgang's Steakhouse - Broadway  (37th St.)", 1042963], ["Black Tap - Soho", 1408510], ["Bar Milagro", 1239427], ["Counter & Bodega", 1030387], ["Bar Cima", 1256218], ["Pierre Loti Union Square", 62233], ["Retro Polish Restaurant and Wine Bar", 1477012], ["A to Z on the fifth Rooftop", 1240651], ["Urban Cove Society and Kitchen", 1275334], ["Bazaar Bar", 1346179], ["STK - Rooftop", 65470], ["The Champagne & Caviar Bar at RH Guesthouse New York", 1202023], ["Alphabet Bar", 1237237], ["Ploume", 1474696], ["a.lounge+bar - New York", 1374061], ["Cheeseboat - Williamsburg", 269923], ["The Flatiron Room - Murray Hill", 340021], ["42nd and Sky Lounge - Hilton New York Times Square", 1381105], ["The Capital Grille \u2013 NY \u2013 MetLife", 3359], ["Yard House - Times Square", 1221061], ["SHIRO", 1476970], ["Love and Dough", 211318], ["La Contenta Greenpoint", 1463638], ["The Last Call", 1283902], ["Burger Village - Tribeca", 1478971], ["Top of the Strand Rooftop Bar - Marriott Vacation Club New York City", 1198519], ["Beer Authority", 99973], ["Beer Street South", 1270678], ["Chuko", 243097], ["Bo Peep Cocktail & Highball Store", 1330567], ["Bellhop", 1436500], ["Elcielo Bistr\u00f3 NYC", 1438918], ["Complete Cafe", 1414252], ["DOLCE MOMENTO- Asian/Mediterranean Fusion", 1503079], ["El Castillo De Jagua Restaurant", 1113694], ["Red Lobster - New York - Times Square", 314206], ["AKB, a hotel bar \u2013 New York", 254290], ["Anjappar Chettinad", 101134], ["Parklife", 1154464], ["CUT By Wolfgang Puck at FS Downtown New York", 268411], ["ATRIO Wine Bar & Restaurant", 78982], ["Max Brenner - Union Square", 41677], ["Cibar Lounge", 246286], ["Eataly NYC Flatiron - La Pizza & La Pasta", 152827], ["Morton's The Steakhouse - Midtown Manhattan", 3018], ["North Fork", 1469806], ["Bobo Restaurant", 17293], ["The Ready Cantina Rooftop", 1168642], ["Joe & Pat\u2019s NYC", 1326979], ["Members Only West Village", 1483219], ["Bar Nena", 1317541], ["Tucci", 1383130], ["Tokyo Record Bar", 992566], ["The Olive Tree Cafe", 443512], ["Pappas - New York", 1101250], ["Cafe Chelsea", 1324291], ["Teruko - The Hotel Chelsea", 729868], ["Kahlo Restaurant", 1027528], ["Hav & Mar", 1259890], ["Death Ave.", 115729], ["Bocca Di Bacco (Chelsea - 20th St.)", 100966], ["Oscar Wilde", 989221], ["Bottino", 345], ["The Argyle", 1467235], ["Blue Ribbon Sushi & Steak", 1328581], ["Elea", 1011193], ["The Grey Dog - Flatiron", 1146664], ["Boqueria Soho", 188416], ["THE GALLERY by odo", 1246903], ["Javelina - Union Square", 160624], ["Bukhara Grill : Indian Spice Rave & Catering NYC", 1434355], ["Serafina 38th", 1273837], ["Tavern 29", 79678], ["Le Jardin Rooftop", 1411927], ["The Blue Dog Cookhouse And Bar", 269173], ["Estiatorio Milos \u2013 Midtown New York", 1973], ["Benihana - New York, NY", 87049], ["Koi - New York", 4035], ["Elsie Rooftop", 1026898], ["The Whitby Bar and Restaurant", 1406188], ["Carnegie Diner & Caf\u00e9 \u2013 205 W 57th St, New York, NY", 1065109], ["Frankie and Johnnie's Steakhouse - 46th Street", 211633], ["Pasta Lovers Trattoria", 102103], ["Magic Hour Rooftop Bar & Lounge", 1014073], ["Strip House Midtown", 97504], ["Serafina Broadway", 3579], ["Sarabeth's Central Park South", 34816], ["Carnegie Diner & Caf\u00e9 \u2013 1185 6th Ave, New York NY", 1470865], ["Carnegie Diner & Caf\u00e9 \u2013 828 8th Ave, New York, NY", 1306750], ["Dos Caminos - Times Square", 186067], ["The Elgin", 1052227], ["Gatsby's Landing - Times Square", 1394434], ["Fuji Hibachi - Times Square", 340531], ["Caffe Buon Gusto - UES", 93817], ["San Matteo Pizzeria e Cucina", 231208], ["Boqueria UES", 169510], ["Sistina", 96577], ["Brasserie Cognac Upper East Side", 107842], ["Oda House - Upper East Side", 1043122], ["Tang By Mr Sun \u5510", 1392421], ["Momoya", 242434], ["Crave Fishbar - UWS", 1380592], ["Cafe Luxembourg", 4020], ["The Consulate Upper West Side", 1051522], ["5 Napkin Burger - Upper West Side", 40456], ["Hi-Life Restaurant - Upper West Side", 58861], ["Water & Wheat Upper West", 1469995], ["Gazala\u2019s", 1018084], ["Yasouvlaki UWS", 160741], ["Tarallucci e Vino - Upper West Side", 1494187], ["Arte Cafe - Upper West Side", 17530], ["Native Harlem", 1426930], ["Community Food & Juice", 1307194], ["L' Artista", 1200718], ["Sofrito NYC", 82576], ["Harlem Tavern", 114283], ["Radio Restaurant", 1240942], ["Roberto's Restaurant", 1188082], ["Bourbon Steak New York", 96478], ["Bar Contra", 186589], ["Leciel", 1437091], ["La Caverna", 229030], ["Swan Room", 1369843], ["Omar's Kitchen and Rum Bar", 1053427], ["Rebel Restaurant and Bar", 1211512], ["The Crosby Bar", 96922], ["Piccola Cucina Osteria - Spring St.", 105838], ["Piccola Cucina Enoteca", 1465012], ["Ladur\u00e9e Soho", 1423174], ["Kabin", 1368061], ["Rei Restaurant", 1476553], ["Felix Roasting Co.", 1317145], ["Corner Bar", 1470322], ["FOOD", 1437523], ["The Crown", 486175], ["Yakiniku Toraji - Bowery", 1286242], ["Zia Maria Little Italy", 1026814], ["Osteria Barocca", 1283818], ["TOKIODELIC", 1458166], ["Serafina FiDi", 1328698], ["The Paris Cafe", 1436572], ["Number One Caviar", 1308841], ["Beckett's Sports Bar", 94009], ["Friedman's Herald Square - 138 W 31 St", 1365226], ["Friedman's Hell's Kitchen - 450 10th Ave", 1399750], ["Friedman's - 72nd St", 1310206], ["Holywater", 1271509], ["Catch New York", 70204], ["Sahara's Turkish Cuisine", 61060], ["Zuma Japanese Restaurant - NY", 162010], ["Revel & Rye Bar and Restaurant", 1221583], ["Broadway Lounge", 1221586], ["Hard Rock Cafe - Times Square", 174004], ["Gyu-Kaku Japanese BBQ - New York, NY | Times Square Manhattan", 7700], ["Jams - NYC", 170722], ["Lips NYC", 1294486], ["Limani - NYC", 158017], ["The Parisian Tea Room- NYC", 1064044], ["STK - NYC - Midtown", 65347], ["Arco Cafe", 145900], ["Azara Kitchen", 1364164], ["SAPERAVI UES", 1467088], ["Paola's Cafe", 1490602], ["Silver Lining Lounge", 1261987], ["Seed Library", 1470610], ["DOUGH by Licastri Silver Lake", 1368994], ["Queensyard", 1039885], ["Lumen Dining & Rooftop", 1419088], ["Glass Ceiling Rooftop", 1180834], ["L\u2019Adresse NoMad", 1181653], ["Tiny Tapas and Bites", 1388896], ["Paris Bar", 1393621], ["Hutong", 1283758], ["Rosemary's Midtown", 1401259], ["Brasserie Cognac Central Park South", 1392550], ["Empellon Midtown", 729934], ["Anejo Restaurant", 1130059], ["Vida Verde", 732586], ["\u5ddd\u96f2\u6da7 Sky Pavilion NYC", 1348507], ["CHILI - Midtown", 1410934], ["MR CHOW - 57th", 28762], ["Shun Lee West", 18781], ["Spice Symphony Times Square", 94075], ["Dagg Thai", 1413217], ["Lemongrass", 1237924], ["Chatti", 1410160], ["Mughlai Indian Cuisine - Hell's Kitchen", 1458373], ["Mughlai Indian Cuisine - Upper West Side", 1458337], ["GuestHouse", 1285174], ["Gandhi Cafe", 246016], ["Taste of India II", 111514], ["Gamsung Pocha - Emokase Table Bar", 1481569], ["The Hidden Tiger", 1481752], ["Insa Karaoke Room", 1422271], ["TEN 11 LOUNGE & BAR", 1379806], ["Wolfgang's Steak House - Times Square", 75409], ["Empire Steak House- East", 212278], ["Estiatorio Milos \u2013 Hudson Yards", 1044916], ["Sammy's Fish Box", 171667], ["Fasano", 1269127], ["Gossip Restaurant", 42301], ["Sea Shore Restaurant & Marina", 94261], ["Holiday Cocktail Lounge", 1078159], ["INTI NYC Restaurant", 86554], ["Fusion HK Bar and Grill", 444544], ["Republic Latin Asian Fusion", 1477483], ["Creatures Rooftop", 1339888], ["Madera Cuban Grill", 90340], ["Bamboo Walk", 1227751], ["Sugar Bar", 75583], ["Tommy Bahama Restaurant & Bar - New York", 94612], ["Wollensky\u2019s Grill", 190840], ["Bocca Di Bacco (Theatre District - 45th St.)", 4478], ["Docks Off 5th", 1372909], ["Carnegie Diner & Caf\u00e9 \u2013 Martinique New York", 1475392], ["Zutto Nolita", 1240897], ["Bua Thai Ramen & Robata Grill", 1013191], ["Sushi Damo", 34939], ["Patrizias of Brooklyn", 1006366], ["Emmy Squared Pizza - Hell\u2019s Kitchen", 1252909], ["F&F Restaurant and Bar", 1388317], ["Shun Lee Cafe", 18778], ["Vista Sky Lounge", 170863], ["Moonstone Modern Asian Cuisine & Bar", 268759], ["Nanshan Hot Pot - Flushing\uff5c\u5357\u5c71\u2022\u718a\u732b\u70eb\u706b\u9505 - \u6cd5\u62c9\u76db\u5e97", 1462804], ["Wa Jeal", 99967], ["Nanshan Hot Pot - Bayside\uff5c\u5357\u5c71\u2022\u718a\u732b\u70eb\u706b\u9505 - \u8d1d\u8d5b\u5e97", 1462807], ["Kid Pizza", 1457899], ["Pig n Whistle on 36th", 66772], ["The Ragtrader", 1371430], ["JoJo", 3154], ["The Mary Lane", 1206802], ["Eli\u2019s Table", 71485], ["Nittis", 1034716], ["Bloom Botanical Bistro", 1175431], ["Interlude Rooftop Lounge", 1275934], ["Albert's", 1270420], ["Croton Reservoir Tavern", 2385], ["The Bronze Owl", 1318894], ["Dive Bar LIC", 1085755], ["Aurora - Williamsburg", 14158], ["Have & Meyer | Vineria Naturale con cucina", 486139], ["Harta", 1256209], ["The Parlour Room", 989143], ["Upstairs at the Kimberly", 98503], ["Duomo51", 173662], ["Starchild Rooftop Bar & Lounge", 1269733], ["The Fleur Room NYC", 1347265], ["Gansevoort Rooftop", 1165225], ["High Bar New York", 1432942], ["Black Tap - 35th Street", 489184], ["Drai's Supper Club", 1419100], ["Allora", 270322], ["Grand Salon & Bar at Baccarat Hotel New York", 167698], ["The Stinger Cocktail Bar and Kitchen", 984730], ["Sushi by Bou - Jersey City NJ @ Ani Ramen", 1257523], ["Song E Napule - West Village NYC", 1294174], ["The River Cafe", 820], ["The Ivory Peacock", 1246276], ["Planet Hollywood - New York City", 1390531], ["Red Lobster - Bronx", 314182], ["Tiny's", 77635], ["David Burke Tavern", 1028503], ["Cantina Rooftop", 115351], ["Refinery Rooftop", 170911], ["Proving Ground Waterfront Dining", 1481032], ["Boat House Waterfront Dining", 13495], ["The Fireside Restaurant, Waterfront Dining", 116710], ["Carne by Allora Brooklyn", 1434082], ["Montesacro BK", 342952], ["Tick Tock Diner NY", 486352], ["Rustik Tavern", 85489], ["Askili Orchard", 1470478], ["Ubani - West Village", 1280239], ["MEAMA Georgian Kitchen and Wine Bar", 1405144], ["Ubani - Bay Ridge", 1368862], ["Lilya's Restaurant & Grill-Cafe Gourmand", 863707], ["Elcielo New York", 1438912], ["Palermo Argentinian Bistro NYC- Gramercy Park", 1428664], ["Amaze44", 990799], ["Uno Pizzeria & Grill - New York", 314203], ["Lazzara's Pizza Cafe", 112417], ["Ascent Lounge New York", 173878], ["Austin's Ale House", 57862], ["Miriam", 66544], ["N\u00e9o Restaurant", 1415839], ["Empire Diner - NYC", 162634], ["Plado - East Village, NYC", 1055296], ["Westville - Williamsburg", 1269433], ["Baci Abbracci", 20914], ["Oregano", 1334569], ["D.O.C. Wine Bar", 333766], ["Bee's Knees & Honey Lounge", 1212772], ["Mole - Williamsburg", 1208575], ["Don Rique", 1463959], ["Sushi by Bou - East Village NYC", 1490242], ["Chito Gvrito", 1152943], ["Early Terrible New York City", 1453231], ["Bar Fes", 1496143], ["GATHER espresso & wine bar", 1488028], ["Aromati Cafe and Wine Bar", 1475119], ["Carversteak New York City", 1443148], ["Bogota Latin Bistro", 40612], ["Taishoken NY - Ramen and Dipping Ramen Bar", 1497883], ["Jazz Genius", 1376752], ["Art House Georgian Restaurant", 1493335], ["Faena Restaurant", 191386], ["Drift BK Restaurant & Lounge", 1382656], ["Golden Child - Hotel Park Ave NYC", 1463866], ["5th & Mad", 171055], ["Bella Luna", 6422], ["Ben and Jack's Steakhouse 44th Street", 13717], ["Bill's Supper Club", 1371079], ["Butcher Bar", 148675], ["Cafe DAnvers", 1078468], ["Cafe Fiorello", 34012], ["Chano's Cantina", 1198516], ["Crave Fishbar UWS", 190753], ["Golden HOF", 1405666], ["HEI Tiki Sushi & Bar", 1403416], ["Inside Park at St. Barts", 12739], ["INTI Peruvian Restaurant", 1316809], ["Kurant", 988234], ["Mission Ceviche", 1261129], ["Mughlai Indian Cuisine", 1458367], ["NINO'S 46Th", 1207360], ["Prime Catch", 1142869], ["Root & Vine", 1497751], ["Rosa Mexicano Lincoln Center", 1787], ["Sultan Mediterranean", 1053280], ["Sutton Bar Room", 171334], ["Tap", 1273084], ["The Beast Next Door", 1168600], ["The Dakota Bar", 255484], ["Westville", 729682], ["kyu", 1215478], ["crab house", 1492618], ["the basement", 43657], ["tanner smiths", 333217], ["Yakar Kosher Steakhouse", 1141900], ["Sushi by Bou- Fins and Scales- NYC @ Chabad Loft", 1220323], ["Emmy Squared Pizza - East Village", 1266631], ["Shiraz Kitchen & Wine Bar - Chelsea", 1070116], ["Little Ruby's - SoHo", 1311595], ["Bar Basic", 1039978], ["Boni & Mott", 1384003], ["Mole West Village", 1208329], ["Piccola Cucina Casa", 1121425], ["lithos", 1504306], ["Houston Hall", 1330780], ["At Cave", 1470445], ["Water St. Tavern", 1255066], ["Gair", 1268680], ["Watami Sushi", 1484881], ["Fragole", 422659], ["J Kennedys", 1504585], ["Sogno Toscano - High Line", 1275448], ["SORS\u00d3", 1276315], ["T-Squared Social", 1331374], ["El Cedro", 1374034], ["Emmy Squared Pizza - Park Slope", 1268449], ["Ziggy's Roman Cafe", 1482676], ["hawksmoor seven dials", 1410643], ["farmhouse restaurant", 142392], ["the evergreen", 208264], ["fumo chelsea", 1227352], ["dave & buster's - brooklyn - atlantic center", 1237615], ["pierre loti union square", 1286], ["the capital grille \u2013 ny \u2013 metlife", 29884], ["kyma - hudson yards", 1011196], ["the factory 380", 1329166], ["bistro vendome - nyc", 74089], ["jhoanes bakery & coffee", 1434694], ["dave & buster's - staten island", 1221385], ["ascent lounge new york", 1484749], ["labeille", 1238458], ["the tygernew", 1088008], ["boobliq bistronew", 1051966], ["bardough nyc", 1270147], ["la'mode bk", 1390150], ["d garden caribbean bar & grill", 1292686], ["beijing hot pot \u4eac\u95e8\u94dc\u706b\u9505", 1462984], ["xiang hotpot - brooklyn", 1320220], ["m\u0113d\u00fcz\u0101 mediterrania", 1322749], ["moca asian bistro - queens", 53020], ["hasalon - nyc", 1055530], ["potluck club \u2030\u03c9\u221e\u00ea\u00ae\u00e7", 1358950], ["bruno's italian bistro", 46048], ["bistro eloise", 1057504], ["babylon", 239827], ["grand view events", 1076863], ["massawa   ny", 238003], ["big apple brunch", 1279057], ["briciola harlem", 731335], ["crystal", 394386], ["eagle trading co", 185453], ["fei ma", 161255], ["attaboy", 1460605], ["la catrina", 1468771], ["salt hank's", 1485760], ["flushing house", 31156], ["numero 28 pizzeria   west village", 1261054], ["ocean prime   new york", 60058], ["sushi by bou chelsea nyc at super nice coffee", 1257586], ["la pizza and la pasta eataly nyc downtown", 1014574], ["nerea greenwich", 1272229], ["ma de", 1280428], ["trattoria zero otto nove flatiron", 89980], ["the smith nomad", 193615], ["abc kitchens dumbo", 1464439], ["sicily", 1214629], ["osteria figa", 1403734], ["linden", 1213444], ["dimes new york", 429910], ["black iron burger 38th street", 1358503], ["keg and lantern red hook", 1467643], ["delmonicos new york", 1288075], ["antons", 1283545], ["rosemarys east", 1186936], ["rafs", 1250887], ["lexpress", 115630], ["carne by allora", 1332040], ["bar primi penn district new york", 1357930], ["the simpson restaurant and bar", 1172638], ["frank restaurant", 113689], ["verde nyc", 1468372], ["uncle teds", 247471], ["frenchette bakery at the whitney", 1372120], ["l and b spumoni gardens dumbo brooklyn", 1215946], ["wooga", 1368217], ["wonderland bar", 1410943], ["talavera", 1331371], ["stone park cafe", 6858], ["the tavern at gramercy tavern", 144958], ["the brooklyn diner times square", 46786], ["dawson", 1399549], ["ai fiori new york", 52969], ["pizza secret", 1018147], ["upstate craft beer and oyster bar", 285139], ["hill country barbecue market flatiron", 24202], ["ramerino italian prime restaurant", 1239697], ["otooles way", 1276375], ["evalyns tap house", 1283887], ["fyc", 1482319], ["amaze 44 restaurant", 78115], ["starbucks reserve new york roastery", 1346173], ["the beer garage", 1427887], ["starbucks reserve tasting room and experiences empire state building", 1262797], ["marthas osteria", 1493053], ["coffee and cocktails", 1189288], ["caviar cafe", 1486207], ["chu", 1502821], ["mughlai indian cuisine kipps bay", 300163], ["akb", 1339624], ["dave and busters new york city times square", 1221391], ["lastindex", 1859], ["nobu fifty seven", 4524], ["totalchecked", 1487]];

  const TIMES = [
    { time: '17:45', label: 'early', baseHour: 17.75 },
    { time: '19:30', label: 'prime', baseHour: 19.5 },
    { time: '21:00', label: 'late', baseHour: 21 }
  ];

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  console.log('%c[OT Part 3/3] ' + ENTRIES.length + ' restaurants x 3 times for ' + DATE, 'color: #00b894; font-weight: bold');

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
  a.download = 'ot_tonight_avail_part3.json';
  a.click();
})();