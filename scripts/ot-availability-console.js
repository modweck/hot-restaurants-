// OT Availability Check (by RID) - Tomorrow 2026-04-12
// Uses restaurant IDs to fetch availability directly from OT search page.
//
// HOW TO USE:
//   1. Open Chrome → opentable.com
//   2. DevTools Console (Cmd+Opt+J)
//   3. Type: allow pasting (if asked)
//   4. Paste this entire file + Enter
//   5. Wait ~90 min (257 restaurants × 20s delay + pauses)
//   6. Download: see end of script

(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const RESTAURANTS = [["Potluck Club 佰樂", 1263916, "potluck-club-new-york"], ["osteria nonnino", 1294987, "osteria-nonnino-new-york"], ["thai villa", 334744, "thai-villa-new-york"], ["zoi mediterranean nomad", 1379803, "zoi-mediterranean-nomad-new-york"], ["surfish bistro", 74362, "surfish-bistro"], ["la contenta", 253987, "la-contenta-les-new-york"], ["may kaidee", 1321465, "may-kaidee-new-york"], ["wenwen", 1229422, "wenwen-brooklyn"], ["treadwell park", 1225828, "treadwell-park-battery-park-new-york"], ["superfine", 109453, "superfine"], ["medium rare", 1380319, "medium-rare-new-york"], ["altesi ristorante", 4205, "altesi-downtown-new-york"], ["amelie", 82891, "amelie"], ["amici ristorante", 1052695, "amici-ristorante-new-york"], ["boon thai", 1437274, "boonthai-brooklyn"], ["capital restaurant", 3359, "the-capital-grille-ny-metlife-new-york"], ["chinatown restaurant", 1281262, "parcelle-chinatown"], ["Chop Shop", 103945, "chop-shop-new-york"], ["Denino's Greenwich Village", 343351, "deninos-greenwich-village-new-york"], ["essex taqueria", 1266922, "taqueria-on-tenth-new-york"], ["gyu kaku", 7703, "gyu-kaku-japanese-bbq-new-york-ny-east-village-manhattan"], ["hilton garden inn long island city", 1062907, "pauls-on-time-square-hilton-garden-inn-new-york"], ["inday", 1370200, "indays-bar-and-restaurant-brooklyn"], ["l'angeletto", 1092370, "langeletto-new-york"], ["lafayette", 105322, "lafayette-new-york-3"], ["mango mango", 1391695, "mango-bay-brooklyn"], ["medusa", 1259230, "medusa-the-greek-brooklyn"], ["mila's bistro", 1165708, "milas-bistro-new-york"], ["The North Fork", 1036561, "north-fork-new-york"], ["palace restaurant", 1358950, "phoenix-palace-new-york"], ["porchlight", 1072027, "porchlight-new-york"], ["taqueria gramercy", 1266922, "taqueria-on-tenth-new-york"], ["the butcher's daughter", 1203121, "the-butchers-daughter-nolita-new-york"], ["the little one", 8033, "little-owl-west-village"], ["gran morelos", 151951, "gran-morsi-new-york"], ["the lions", 1433980, "henry-and-the-lions-new-york"], ["saigon social", 1144579, "saigon-social-new-york"], ["atithi indian cuisine", 1192015, "atithi-indian-cuisine-brooklyn"], ["chef yu", 242299, "chef-yu-new-york"], ["sabor argentino", 1204168, "sabor-argentino-new-york"], ["aunt bernie's", 1376887, "aunt-bernies-new-york"], ["spes", 1228861, "spes-vino-naturale-e-cucina-new-york"], ["moko", 1207474, "moko-new-york"], ["sereneco", 1208164, "sereneco-brooklyn"], ["the mayfly", 1431280, "the-mayfly-2-new-york"], ["el zason", 1214026, "el-zason-brooklyn"], ["maestro pasta", 1267753, "maestro-pasta-new-york-2"], ["daddies", 1257574, "daddies-new-york"], ["nudibranch", 1238359, "nudibranch-new-york"], ["l'amore restaurant", 1231750, "lamore-new-york"], ["natural restaurant", 1005574, "terre-pasta-natural-wine-brooklyn"], ["casa carmen", 1226611, "casa-carmen-tribeca-new-york"], ["hilton garden inn -manhattan- midtown east", 1062907, "pauls-on-time-square-hilton-garden-inn-new-york"], ["the ainsworth midtown", 142273, "ainsworth-midtown-new-york"], ["kalye", 1278193, "kalye-at-rivington-new-york"], ["diaspora", 1340860, "la-diaspora-bar-and-restaurant-new-york"], ["yves", 334822, "yves-new-york"], ["the corner chinese restaurant", 1470322, "corner-bar-new-york"], ["tara kitchen tribeca", 1435009, "tara-kitchen-tribeca-new-york"], ["mama mezze", 1482988, "mama-mezze-new-york"], ["the laurels", 1328290, "the-laurels-new-york"], ["mr. broadway restaurant", 1342942, "mr-broadway-new-york-2"], ["rice bird", 1344652, "rice-bird-nyc-new-york"], ["yayo's latin cuisine", 1421926, "yayos-latin-cuisine-brooklyn"], ["seahorse", 1348330, "seahorse-new-york"], ["jimmy's on the go", 48460, "paul-and-jimmys-ristorante-new-york"], ["fossetta", 1363492, "fossetta-new-york"], ["osteria delbianco bryant park", 1331539, "osteria-delbianco-bryant-park-new-york"], ["curry flavor", 1334077, "curry-flavor-new-york"], ["cloves indian cuisine", 1333927, "cloves-indian-cuisine-new-york"], ["yokox omakase", 1362172, "yokox-omakase-new-york"], ["hyun", 1042186, "hyun-new-york"], ["la contenta les", 253987, "la-contenta-les-new-york"], ["the mouth", 1403188, "the-mouth-kitchen-and-bar-brooklyn"], ["ming mun", 1437466, "ming-mun-brooklyn"], ["lume west village", 1402666, "lume-new-york"], ["audace", 1394212, "audace-nyc-new-york"], ["house of pasta", 1397323, "house-of-pasta-new-york"], ["castell's", 1018810, "castell-rooftop-lounge-new-york"], ["hilton garden inn chelsea", 1062907, "pauls-on-time-square-hilton-garden-inn-new-york"], ["xisan de classic", 1438558, "xisan-de-classic-brooklyn"], ["bartolo", 1389607, "bartolo-new-york"], ["casa colven", 1422211, "casa-colven-new-york"], ["nuyores", 1459951, "nuyores-new-york"], ["wok in duane", 1468528, "wok-in-duane-new-york"], ["ubani bistro", 1474177, "ubani-bistro-new-york"], ["palladino's", 1409887, "palladinos-steak-and-seafood-new-york"], ["limusina", 1448041, "limusina-new-york"], ["yum cha restaurant", 1345993, "yum-cha-new-york"], ["sunday", 1168609, "sunday-to-sunday-new-york"], ["buenos aires", 107185, "buenos-aires-new-york"], ["mr. chow tribeca", 28759, "mr-chow-tribeca-new-york"], ["wicked willy's", 1005166, "wicked-willys-bar-and-grill-new-york"], ["boqueria", 992293, "boqueria-west-40th-street-new-york"], ["the grey dog", 1146670, "the-grey-dog-nolita-new-york"], ["lavagna", 38509, "lavagna-new-york"], ["deniz turkish mediterranean", 1014082, "deniz-turkish-mediterranean-brooklyn"], ["mazzat", 90628, "mazzat"], ["petite boucherie", 157048, "petite-boucherie-new-york"], ["yard house", 1221061, "yard-house-times-square-new-york"], ["posx asian bistro", 1479529, "posx-asian-bistro-brooklyn"], ["bergen hall", 1277287, "clinton-hall-new-york-2"], ["Anejo Tribeca", 148711, "anejo-tribeca-new-york"], ["wagamama - Murray Hill", 1027582, "wagamama-murray-hill-new-york"], ["Zaytinya - New York", 1183219, "zaytinya-new-york"], ["Balvanera", 152380, "balvanera-new-york"], ["Mezze on the River", 1245115, "mezze-on-the-river-new-york"], ["Blue Ribbon Sushi Bar & Grill - Financial District", 1228645, "blue-ribbon-sushi-bar-and-grill-financial-district-new-york"], ["Allora Fifth Ave", 1262110, "allora-fifth-ave-new-york"], ["Le Jardin Bistro", 1386064, "le-jardin-bistro-new-york"], ["Ribalta", 1493359, "ribalta-new-york"], ["Pershing Square Restaurant", 219301, "pershing-square-new-york"], ["The Grey Dog (Nolita)", 1146670, "the-grey-dog-nolita-new-york"], ["Rosemary's West Village", 150718, "rosemarys-west-village"], ["Le Parisien", 57316, "le-parisien-new-york"], ["The Grey Dog (West Village)", 1146658, "the-grey-dog-west-village-new-york"], ["wagamama, nomad, new york", 1008775, "wagamama-nomad-new-york"], ["Tarallucci e Vino Union Square", 24979, "tarallucci-e-vino-union-square-new-york1"], ["Gnocco", 36592, "gnocco-new-york"], ["The Wilson", 1026124, "the-wilson-nyc-new-york"], ["Tio Pepe", 86482, "tio-pepe-new-york"], ["Bazaar Meat", 1183222, "bazaar-meat-by-jose-andres-new-york"], ["txula steak", 1463491, "txula-steak-new-york"], ["Sushi By M", 1228645, "blue-ribbon-sushi-bar-and-grill-financial-district-new-york"], ["The Butcher's Daughter - Nolita", 1203121, "the-butchers-daughter-nolita-new-york"], ["Bazaar Meat by José Andrés - New York", 1183222, "bazaar-meat-by-jose-andres-new-york"], ["BONDST Hudson Yards", 1292767, "bondst-hudson-yards-new-york"], ["Nami Nori West Village", 1283572, "nami-nori-west-village-new-york"], ["Nick & Stef’s Steakhouse - New York", 2216, "nick-and-stefs-steakhouse-new-york"], ["Chinatown’s", 1281262, "parcelle-chinatown"], ["zutto", 1026358, "zutto-tribeca-new-york"], ["Socarrat Paella Bar - Nolita", 58891, "socarrat-paella-bar-nolita-new-york"], ["RYNN Thai Restaurant & Bar", 1329181, "rynn-thai-restaurant-and-bar-new-york"], ["Pineapple Club", 1050919, "pineapple-club-new-york"], ["hawksmoor nyc", 1052086, "hawksmoor-new-york"], ["nounou", 1490017, "nounou-noodle-bar-new-york"], ["Gjelina - New York", 1328854, "gjelina-new-york"], ["The Highlight Room NY", 1269739, "the-highlight-room-ny-new-york"], ["Medium Rare - New York", 1380319, "medium-rare-new-york"], ["Butcher and Banker NYC", 987040, "butcher-and-banker-new-york"], ["Sarabeth’s Greenwich Village", 1388308, "sarabeths-greenwich-village-new-york"], ["Casasalvo", 1458070, "casasalvo-new-york"], ["The Butcher's Daughter - Williamsburg", 1317235, "the-butchers-daughter-williamsburg-brooklyn"], ["Friedman's - Battery Park", 1331485, "friedmans-battery-park-new-york"], ["Fellini", 1385662, "fellini-new-york"], ["Gage & Tollner", 1123618, "gage-and-tollner-brooklyn"], ["Wicked Willy's Bar & Grill", 1005166, "wicked-willys-bar-and-grill-new-york"], ["Everything's Jake NYC Bar & Lounge", 1284766, "everythings-jake-nyc-bar-and-lounge-new-york"], ["Blue Ribbon Sushi - Sullivan St", 1085551, "blue-ribbon-sushi-sullivan-st-new-york"], ["Little Ruby's - Murray Hill", 1311598, "little-rubys-cafe-murray-hill-new-york"], ["SIMPLE بسيط", 487612, "simple-brooklyn"], ["Turks & Frogs", 478663, "turks-and-frogs-new-york"], ["Penthouse on Park", 1220269, "penthouse-on-park-new-york"], ["Twist Bar", 1246441, "twist-bar-new-york"], ["Amelias", 1270021, "amelias-new-york"], ["Black Tap - Soho", 1408510, "black-tap-soho-new-york"], ["Bar Cima", 1256218, "bar-cima-new-york"], ["Meraki Greek Bistro - Brooklyn", 1322275, "meraki-greek-bistro-brooklyn"], ["A to Z on the fifth Rooftop", 1240651, "a-to-z-on-fifth-rooftop-new-york"], ["Bazaar Bar", 1346179, "bazaar-bar-new-york"], ["Keg & Lantern West Village", 1467625, "keg-and-lantern-west-village-new-york"], ["The Champagne & Caviar Bar at RH Guesthouse New York", 1202023, "the-champagne-and-caviar-bar-at-rh-guesthouse-new-york-1"], ["a.lounge+bar - New York", 1374061, "alounge-and-bar-new-york"], ["wagamama, murray hill, new york", 1027582, "wagamama-murray-hill-new-york"], ["The Capital Grille – NY – MetLife", 3359, "the-capital-grille-ny-metlife-new-york"], ["SHIRO", 1476970, "shiro-brooklyn"], ["The Last Call", 1283902, "the-last-call-brooklyn"], ["Burger Village - Tribeca", 1478971, "burger-village-tribeca-new-york"], ["Yayos Latin cuisine", 1421926, "yayos-latin-cuisine-brooklyn"], ["Jackson Hole - Murray Hill", 235450, "jackson-hole-murray-hill-new-york"], ["Beer Street South", 1270678, "beer-street-south-brooklyn-2"], ["Red Lobster - New York - Times Square", 314206, "red-lobster-new-york-times-square"], ["Añejo Tribeca", 148711, "anejo-tribeca-new-york"], ["Del Frisco's Grille - World Trade Center", 730255, "del-friscos-grille-world-trade-center-new-york"], ["Oceans - New York", 1050274, "oceans-new-york"], ["Eataly NYC Flatiron - La Pizza & La Pasta", 152827, "la-pizza-and-la-pasta-eataly-nyc-flatiron-new-york"], ["Isabelle’s Osteria", 335782, "isabelles-osteria-new-york"], ["Members Only West Village", 1483219, "members-only-west-village-new-york"], ["Rosemary's - West Village", 150718, "rosemarys-west-village"], ["Yum Cha", 1345993, "yum-cha-new-york"], ["Hav & Mar", 1259890, "hav-and-mar-new-york"], ["Westville - Chelsea", 228472, "westville-new-york"], ["Bocca Di Bacco (Chelsea - 20th St.)", 100966, "bocca-di-bacco-chelsea-20th-st-new-york"], ["Casa Carmen Flatiron", 1359169, "casa-carmen-flatiron-new-york"], ["ilili - Nomad", 15550, "ilili-new-york"], ["Bazar Tapas Bar and Restaurant", 984619, "bazar-tapas-bar-and-restaurant-new-york"], ["Tenjou", 1438537, "tenjou-new-york"], ["Novitá - New York City, Manhattan", 30202, "novita-new-york-city-manhattan-new-york"], ["Javelina - Union Square", 160624, "javelina-union-square-new-york"], ["Ainsworth Midtown", 142273, "ainsworth-midtown-new-york"], ["Bukhara Grill : Indian Spice Rave & Catering NYC", 1434355, "bukhara-grill-indian-spice-rave-and-catering-nyc-new-york"], ["Koi - New York", 4035, "koi-new-york"], ["Elsie Rooftop", 1026898, "elsie-rooftop-new-york"], ["Delos Greek Restaurant", 1491391, "delos-greek-restaurant-new-york"], ["Carnegie Diner & Café – 828 8th Ave, New York, NY", 1306750, "carnegie-diner-and-cafe-new-york-8th"], ["Fuji Hibachi - Times Square", 340531, "fuji-hibachi-times-square-new-york"], ["Barking Dog Hell's Kitchen", 1220014, "barking-dog-hells-kitchen-new-york-4"], ["Leciel", 1437091, "leciel-new-york"], ["La Caverna", 229030, "la-caverna-new-york"], ["Balvanera - NYC", 152380, "balvanera-new-york"], ["Swan Room", 1369843, "swan-room-new-york"], ["FOOD", 1437523, "food-new-york"], ["The Crown", 486175, "the-crown-new-york"], ["Zia Maria Little Italy", 1026814, "zia-maria-little-italy-new-york"], ["Osteria Barocca", 1283818, "osteria-barocca-new-york"], ["Da Nico Restaurant - Manhattan", 166810, "da-nico-restaurant-manhattan"], ["TOKIODELIC", 1458166, "tokiodelic-new-york"], ["Number One Caviar", 1308841, "number-one-caviar-new-york"], ["Old Homestead Steakhouse- New York City", 7865, "old-homestead-steakhouse-new-york-city-new-york-2"], ["Audace NYC", 1394212, "audace-nyc-new-york"], ["STK - NYC - Midtown", 65347, "stk-nyc-midtown-new-york"], ["Queensyard", 1039885, "queensyard-new-york"], ["The Wilson NYC", 1026124, "the-wilson-nyc-new-york"], ["Kraam Thai", 1403569, "kraam-thai-new-york"], ["Palladino's Steak and Seafood", 1409887, "palladinos-steak-and-seafood-new-york"], ["Jajaja Mexicana - Williamsburg", 1369933, "jajaja-mexicana-williamsburg-brooklyn"], ["CHILI - Midtown", 1410934, "chili-midtown-new-york"], ["Lemongrass", 1237924, "lemongrass-new-york"], ["Chatti", 1410160, "chatti-manhattan"], ["Insa - BK", 253246, "insa-bk-brooklyn"], ["The Hidden Tiger", 1481752, "the-hidden-tiger-new-york"], ["Insa Karaoke Room", 1422271, "insa-karaoke-room-brooklyn"], ["Carnegie Diner & Café – Martinique New York", 1475392, "carnegie-diner-and-cafe-martinique-new-york"], ["Gyu-Kaku Japanese BBQ - New York, NY | East Village Manhattan", 7703, "gyu-kaku-japanese-bbq-new-york-ny-east-village-manhattan"], ["The Mary Lane", 1206802, "the-mary-lane-new-york"], ["Nittis", 1034716, "nittis-new-york"], ["The Bronze Owl", 1318894, "the-bronze-owl-new-york"], ["Have & Meyer | Vineria Naturale con cucina", 486139, "have-and-meyer-vineria-naturale-con-cucina-brooklyn"], ["Pershing Square", 219301, "pershing-square-new-york"], ["Castell Rooftop Lounge", 1018810, "castell-rooftop-lounge-new-york"], ["Gansevoort Rooftop", 1165225, "gansevoort-rooftop-new-york"], ["Black Tap - 35th Street", 489184, "black-tap-35th-street-new-york"], ["Drai's Supper Club", 1419100, "drais-supper-club-new-york"], ["The Ivory Peacock", 1246276, "the-ivory-peacock-new-york"], ["Spyglass Rooftop Bar", 254290, "spyglass-new-york"], ["Carne by Allora Brooklyn", 1434082, "carne-by-allora-brooklyn"], ["Montesacro BK", 342952, "montesacro-bk-brooklyn"], ["Tick Tock Diner NY", 486352, "tick-tock-diner-ny-new-york"], ["Poppy", 1400527, "poppy-new-york"], ["Askili Orchard", 1470478, "askili-orchard-new-york"], ["Perry St", 3948, "perry-st-new-york"], ["Plado - East Village, NYC", 1055296, "plado-east-village-nyc"], ["Baci Abbracci", 20914, "baci-abbracci-brooklyn"], ["D.O.C. Wine Bar", 333766, "doc-wine-bar-brooklyn"], ["The MOUTH Kitchen + Bar", 1403188, "the-mouth-kitchen-and-bar-brooklyn"], ["Chito Gvrito", 1152943, "chito-gvrito-new-york"], ["Miti Miti Modern Mexican", 160426, "miti-miti-modern-mexican-brooklyn"], ["Wanglang NYC", 1492888, "wang-lang-new-york"], ["Taishoken NY - Ramen and Dipping Ramen Bar", 1497883, "taishoken-ny-ramen-and-dipping-ramen-bar-new-york"], ["Ubani", 1280239, "ubani-new-york"], ["the corner", 1470322, "corner-bar-new-york"], ["rooftop bar", 1026898, "elsie-rooftop-new-york"], ["kyu", 1215478, "kyu-nyc-new-york"], ["the tusk bar", 1331476, "brass-and-the-tusk-bar-new-york"], ["the river", 1245115, "mezze-on-the-river-new-york"], ["leo", 1307248, "leons-new-york-city"], ["turtle bay tavern", 1463938, "taverna-by-gyro-project-new-york"]];
  const CHECK_DATE = '2026-04-12';
  const PARTY_SIZE = 2;
  const TIME = '19:30';
  const results = {};
  window.__OT_AVAIL = results;

  console.log('%c[OT Availability Check — ' + CHECK_DATE + ']', 'color: #00b894; font-weight: bold; font-size: 14px');
  console.log('  Restaurants: ' + RESTAURANTS.length);
  console.log('  ETA: ~' + Math.round(RESTAURANTS.length * 20 / 60 + RESTAURANTS.length / 25 * 5) + ' min');

  let open = 0, limited = 0, booked = 0, notFound = 0, errors = 0, blocked = 0, consecutiveErrors = 0;

  function parseTimes(slots) {
    let early = 0, prime = 0, late = 0;
    const parsed = [];
    for (const t of slots) {
      const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!m) continue;
      let h = parseInt(m[1]);
      const min = parseInt(m[2]);
      if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
      if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
      const hour = h + min / 60;
      if (hour < 17 || hour >= 24) continue;
      parsed.push(t);
      if (hour < 18.5) early++;
      else if (hour < 20.5) prime++;
      else late++;
    }
    return { parsed, early, prime, late, total: parsed.length };
  }

  for (let i = 0; i < RESTAURANTS.length; i++) {
    if (i > 0 && i % 25 === 0) {
      console.log('%c  ⏸️  Pausing 5 min at ' + i + '/' + RESTAURANTS.length, 'color: #f39c12');
      await sleep(300000);
      console.log('  ▶️  Resuming');
    }

    const [name, rid, slug] = RESTAURANTS[i];

    try {
      // Search for the specific restaurant with date/time — filters by rid
      const url = 'https://www.opentable.com/s?term=' + encodeURIComponent(name) +
                  '&dateTime=' + CHECK_DATE + 'T' + encodeURIComponent(TIME + ':00') +
                  '&covers=' + PARTY_SIZE + '&metroId=8';
      const res = await fetch(url, { credentials: 'include' });

      if (res.status === 403) {
        blocked++;
        errors++;
        consecutiveErrors++;
        results[name] = { tier: 'error', error: 'blocked', rid };
        if (blocked >= 3) {
          console.log('%c  🚫 Blocked 3× — waiting 5 min...', 'color: red');
          await sleep(300000);
          blocked = 0;
        }
        await sleep(20000);
        continue;
      }

      if (!res.ok) {
        errors++;
        consecutiveErrors++;
        results[name] = { tier: 'error', error: 'http_' + res.status, rid };
        await sleep(20000);
        continue;
      }

      blocked = 0;
      consecutiveErrors = 0;
      const html = await res.text();

      // Find the card matching our rid
      // Look for "restaurantId":RID then nearby for slots
      const ridPattern = new RegExp('"restaurantId":' + rid + '[\\s\\S]{0,5000}', 'g');
      const match = html.match(ridPattern);
      if (!match) {
        // rid not on page — restaurant may not have availability today or not indexed
        notFound++;
        results[name] = { tier: 'not_found', rid };
        await sleep(20000);
        continue;
      }

      const section = match[0];
      // Extract time slots from the section
      const slotMatches = section.match(/"dateTime":"[^"]*","time":"(\d{1,2}:\d{2}\s*[AP]M)"/gi) ||
                          section.match(/"(\d{1,2}:\d{2}\s*[AP]M)"/g) ||
                          [];
      const slots = [];
      for (const s of slotMatches) {
        const tm = s.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
        if (tm && !slots.includes(tm[1])) slots.push(tm[1]);
      }

      const parsed = parseTimes(slots);
      const tier = parsed.total === 0 ? 'booked' : parsed.total <= 3 ? 'limited' : 'open';
      const r = {
        tier,
        dinner_slots: parsed.total,
        early: tier === 'open' ? 'available' : (parsed.early > 0 ? 'limited' : 'booked'),
        prime: tier === 'open' ? 'available' : (parsed.prime > 0 ? 'limited' : 'booked'),
        late: tier === 'open' ? 'available' : (parsed.late > 0 ? 'limited' : 'booked'),
        has_early: parsed.early > 0 || tier === 'open',
        has_prime: parsed.prime > 0 || tier === 'open',
        has_late: parsed.late > 0 || tier === 'open',
        sample_times: parsed.parsed.slice(0, 5),
        rid,
        slug,
        checked_date: CHECK_DATE
      };
      results[name] = r;

      if (tier === 'open') open++;
      else if (tier === 'limited') limited++;
      else booked++;

      const icon = tier === 'open' ? '🟢' : tier === 'limited' ? '🟡' : '🔴';
      const times = r.sample_times.length > 0 ? ' → ' + r.sample_times.join(', ') : '';
      console.log('  ' + icon + ' [' + (i+1) + '/' + RESTAURANTS.length + '] ' + name + ': ' + tier + ' (' + parsed.total + ')' + times);

      if ((i+1) % 10 === 0) window.__OT_AVAIL = results;
    } catch (e) {
      errors++;
      consecutiveErrors++;
      results[name] = { tier: 'error', error: e.message?.slice(0, 80) };
    }

    if (consecutiveErrors >= 5) {
      console.log('%c  🚫 5 errors in a row — pausing 10 min...', 'color: red');
      await sleep(600000);
      consecutiveErrors = 0;
    }

    await sleep(20000);
  }

  window.__OT_AVAIL = results;
  console.log('%c\n[Done] 🟢' + open + ' 🟡' + limited + ' 🔴' + booked + ' ❓' + notFound + ' ⚠️' + errors, 'color: #00b894; font-weight: bold; font-size: 14px');
  console.log('Download: (()=>{const d=JSON.stringify(window.__OT_AVAIL,null,2);const b=new Blob([d],{type:"application/json"});const x=document.createElement("a");x.href=URL.createObjectURL(b);x.download="ot_availability_2026-04-12.json";x.click();})()');
})();
