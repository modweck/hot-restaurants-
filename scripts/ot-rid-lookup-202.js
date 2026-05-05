(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const NAMES = ["bamboo walk caribbean restaurant", "nino's 46", "sushi by scratch restaurants", "what the fish", "resident", "just pho you", "ainslie", "alwaha restaurant", "gazala's", "puerto plata restaurant", "sayori", "shanghai chinese restaurant", "the little one", "harlem breakfast club", "sally's caribbean restaurant", "sauced up", "animo!", "castell's", "pavin86", "sips", "bombay's", "the jin", "bustronome new york", "bread & butter", "alta", "the wilson", "cowgirl", "mas (farmhouse)", "fulton fish co.", "la mela", "p.f. chang's", "bite", "red star", "zimmis", "iris", "la fusta", "poke", "the evergreen", "café d'anvers", "contento", "chloe", "drift restaurant and bar", "patiala indian grill & bar", "pico de gallo bar & kitchen", "state grill and bar", "route bar restaurant", "gnocchi bar", "yuca bar & restaurant", "gu japanese fusion sushi & bar", "west end bar & grill", "knickerbocker bar & grill", "bar rocco", "bar san miguel carroll gardens", "numero 28 pizzeria - west village", "arturo's", "lola's", "casa dani", "palladino's steak & seafood", "golden dragon restaurant", "puerta del sol", "taste of italy", "eatzy thai", "cô lạc", "l'angeletto", "il carino restaurant", "crane club restaurant", "giano", "white oak tavern", "ploume", "cheeseboat - williamsburg", "love and dough", "the brooklyn deli - times square", "cibar lounge", "morton's the steakhouse - midtown manhattan", "joe & pat’s nyc", "golden steer steakhouse nyc", "pappas - new york", "the argyle", "elea", "estiatorio milos – midtown new york", "quality italian - new york", "carnegie diner & café – 205 w 57th st, new york, ny", "kings of kobe - wagyu kitchen & bar", "serafina broadway", "carnegie diner & café – 1185 6th ave, new york ny", "blue fin - new york", "pig n whistle - rockefeller center", "the elgin", "toloache - upper east side", "island", "oda house - upper east side", "zoi mediterranean ues", "serafina upper west", "bustan", "the consulate upper west side", "5 napkin burger - upper west side", "playa betty's", "gazala’s", "saperavi uws", "native harlem", "community food & juice", "l' artista", "vida nyc", "bar contra", "piccola cucina osteria - spring st.", "kabin", "the paris cafe", "friedman's - 72nd st", "broadway lounge", "mapo asian restaurant & bar", "gyu-kaku japanese bbq - new york, ny | times square manhattan", "jams - nyc", "palermo argentinian bistro nyc", "russian tea room - nyc", "the parisian tea room- nyc", "rosa mexicano - second avenue", "atlantic grill at lincoln center", "arco cafe", "azara kitchen", "ikyu", "saperavi ues", "silver lining lounge", "dough by licastri silver lake", "lumen dining & rooftop", "the corner chinese", "the ivy room", "glass ceiling rooftop", "tiny tapas and bites", "chef papa vietnamese kitchen lic", "rosemary's midtown", "ocean prime - new york", "match 65 brasserie (formerly paris match)", "brasserie cognac central park south", "empellon midtown", "vida verde", "mr chow - 57th", "shun lee west", "chalong southern thai", "zaab zaab - queens", "spice symphony – 50th st.", "musaafer - new york", "smith & wollensky - new york", "a la turka restaurant", "sammy's smokehouse bbq & grill", "sultan mediterranean cuisine nyc", "celon bar and lounge", "fogo de chão - new york", "empire burger house", "corrado's cucina", "holiday cocktail lounge", "warique - williamsburg", "creatures rooftop", "private room", "savvy bistro & bar", "da raffaele - nyc", "tony's di napoli - upper east side", "bocca di bacco (theatre district - 45th st.)", "haven rooftop", "gyu-kaku japanese bbq - new york, ny | midtown manhattan", "roberta's - bushwick", "serafina long island city", "shun lee cafe", "moonstone modern asian cuisine & bar", "kid pizza", "the east pole - kitchen and bar", "5 acres", "fernando's hideaway", "the dickens", "bonsaii tapas & wine bar", "interlude rooftop lounge", "langan's", "haswell green's", "westland roe", "jasper's tap house", "the rabbit hole astoria", "richmond republic", "the smith- lincoln square", "the fleur room nyc", "ophelia", "grand salon & bar at baccarat hotel new york", "sushi by bou - jersey city nj @ ani ramen", "red lobster - brooklyn", "red lobster - bronx", "majorelle at the lowell", "refinery rooftop", "sally's waterfront dining", "platform by the james beard foundation", "cheeseboat - hell's kitchen", "russian samovar & tolstoy's lounge", "kween", "sol de colombia", "porteno restaurant", "la gran uruguaya restaurant", "john's pizzeria", "violette's restaurant", "mythos authentic greek cuisine", "don rique", "cafe luxembourg", "carnegie diner & cafe, 711 7th avenue", "bar goyana", "dolly varden", "mission ceviche"];
  const results = {};
  window.__OT_LOOKUP_202 = results;
  console.log('[OT 202 Lookup] ' + NAMES.length + ' to lookup');
  let found = 0, notFound = 0, blocked = 0;

  for (let i = 0; i < NAMES.length; i++) {
    // Pause 3 min every 30 lookups
    if (i > 0 && i % 30 === 0) {
      console.log('⏸️  Pausing 3 min at ' + i + '/' + NAMES.length);
      await sleep(180000);
    }
    const name = NAMES[i];
    const clean = name.replace(/[^\w\s'&-]/g, '').replace(/\s+/g, ' ').trim();
    if (!clean) { notFound++; continue; }

    try {
      const res = await fetch('https://www.opentable.com/s?term=' + encodeURIComponent(clean) + '&metroId=8', {credentials:'include'});
      if (res.status === 403) {
        blocked++;
        console.log('🚫 blocked [' + (i+1) + '] ' + name);
        if (blocked >= 3) { console.log('Pausing 5 min...'); await sleep(300000); blocked = 0; }
        await sleep(8000);
        continue;
      }
      if (!res.ok) continue;
      blocked = 0;

      const html = await res.text();
      const pat = /"restaurantId":(\d+)[^}]*?"name":"([^"]+)"/g;
      const cands = [];
      let m;
      while ((m = pat.exec(html)) !== null) cands.push({rid: parseInt(m[1]), name: m[2]});

      const nl = clean.toLowerCase();
      let best = null, bestScore = 0;
      for (const c of cands) {
        const cl = c.name.toLowerCase();
        let s = 0;
        if (cl === nl) s = 1;
        else if (cl.includes(nl) || nl.includes(cl)) s = 0.9;
        else {
          const nw = nl.split(/\s+/).filter(w => w.length > 2);
          const cw = cl.split(/\s+/).filter(w => w.length > 2);
          if (nw.length) s = nw.filter(w => cw.some(x => x.includes(w))).length / nw.length;
        }
        if (s > bestScore) { bestScore = s; best = c; }
      }

      if (best && bestScore >= 0.5) {
        results[name] = { rid: best.rid, matched: best.name, score: bestScore };
        found++;
        console.log('✓ [' + (i+1) + '/' + NAMES.length + '] ' + name + ' → ' + best.rid);
      } else {
        notFound++;
        console.log('✗ [' + (i+1) + '/' + NAMES.length + '] ' + name);
      }
    } catch (e) { console.log('err ' + name); }

    if ((i+1) % 10 === 0) window.__OT_LOOKUP_202 = results;
    await sleep(6000);
  }

  window.__OT_LOOKUP_202 = results;
  console.log('[Done] ' + found + ' found, ' + notFound + ' not found');
  const d = JSON.stringify(results, null, 2);
  const b = new Blob([d], {type:'application/json'});
  const x = document.createElement('a');
  x.href = URL.createObjectURL(b);
  x.download = 'ot_lookup_202.json';
  x.click();
})();