// OT Slug→RID Console Script — paste into opentable.com console
// Visits each slug page and extracts RID from the loaded page
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ENTRIES = [["sushi by scratch restaurants", "sushi-by-scratch-new-york"], ["what the fish", "what-the-fish-queens"], ["ainslie", "ainslie-bowery-new-york"], ["puerto plata restaurant", "puerto-plata-restaurant-and-billiards-queens"], ["shanghai chinese restaurant", "shanghai-pavillion-new-york"], ["pavin86", "pavin-86-new-york"], ["p.f. chang's", "pf-changs-union-square-new-york"], ["bite", "tiny-tapas-and-bites-new-york"], ["la fusta", "la-fusta-north-bergen"], ["the evergreen", "evergreen-restaurant"], ["café d'anvers", "magia-restaurant-and-bar-danvers"], ["drift restaurant and bar", "drift-restaurant-and-bar-weehawken"], ["patiala indian grill & bar", "patiala-new-york"], ["pico de gallo bar & kitchen", "pico-de-gallo-bar-and-kitchen-new-york"], ["route bar restaurant", "route-66-bar-and-grill-new-york"], ["yuca bar & restaurant", "yuca-bar-new-york"], ["gu japanese fusion sushi & bar", "gu-japanese-fusion-sushi-and-bar-new-york"], ["bar san miguel carroll gardens", "bar-san-miguel-brooklyn"], ["palladino's steak & seafood", "palladinos-steak-and-seafood-new-york"], ["taste of italy", "taste-of-italy-23-latham"], ["eatzy thai", "eatzy-thai-astoria"], ["l'angeletto", "langeletto-new-york"], ["il carino restaurant", "il-carino-restaurant-new-york"], ["crane club restaurant", "crane-club-restaurant-new-york"], ["white oak tavern", "white-oak-tavern"], ["ploume", "ploume-new-york"], ["cheeseboat - williamsburg", "cheeseboat-williamsburg-brooklyn"], ["the brooklyn deli - times square", "the-brooklyn-deli-times-square-new-york"], ["cibar lounge", "cibar-lounge-new-york"], ["morton's the steakhouse - midtown manhattan", "mortons-the-steakhouse-midtown-manhattan-new-york"], ["joe & pat’s nyc", "joe-and-pats-nyc-new-york"], ["golden steer steakhouse nyc", "golden-steer-steakhouse-nyc-new-york"], ["pappas - new york", "pappas-new-york"], ["the argyle", "the-argyle-new-york"], ["elea", "elea-new-york"], ["estiatorio milos – midtown new york", "estiatorio-milos-midtown-new-york-2"], ["quality italian - new york", "quality-italian-new-york"], ["carnegie diner & café – 205 w 57th st, new york, ny", "carnegie-diner-and-cafe-new-york-57th"], ["kings of kobe - wagyu kitchen & bar", "kings-of-kobe-wagyu-kitchen-and-bar-new-york"], ["serafina broadway", "serafina-broadway-new-york"], ["carnegie diner & café – 1185 6th ave, new york ny", "carnegie-diner-and-cafe-1185-6th-ave-new-york-ny-new-york"], ["blue fin - new york", "blue-fin-new-york"], ["the elgin", "the-elgin-new-york"], ["toloache - upper east side", "toloache-upper-east-side-new-york"], ["island", "island-new-york"], ["oda house - upper east side", "oda-house-upper-east-side-new-york-2"], ["zoi mediterranean ues", "zoi-mediterranean-ues-new-york"], ["bustan", "bustan-new-york"], ["the consulate upper west side", "the-consulate-upper-west-side-new-york"], ["5 napkin burger - upper west side", "5-napkin-burger-upper-west-side-new-york"], ["playa betty's", "playa-bettys-new-york"], ["gazala’s", "gazalas-new-york"], ["saperavi uws", "saperavi-uws-new-york"], ["native harlem", "native-harlem-new-york"], ["community food & juice", "community-food-and-juice-new-york"], ["l' artista", "l-artista-new-york"], ["vida nyc", "vida-nyc-astoria"], ["bar contra", "bar-contra-new-york"], ["piccola cucina osteria - spring st.", "piccola-cucina-osteria-spring-st-new-york"], ["kabin", "kabin-new-york"], ["the paris cafe", "the-paris-cafe-new-york"], ["friedman's - 72nd st", "friedmans-72nd-st-new-york"], ["broadway lounge", "broadway-lounge-new-york-3"], ["mapo asian restaurant & bar", "mapo-asian-restaurant-and-bar-new-york"], ["gyu-kaku japanese bbq - new york, ny | times square manhattan", "gyu-kaku-japanese-bbq-new-york-ny-midtown-manhattan"], ["jams - nyc", "jams-nyc"], ["palermo argentinian bistro nyc", "palermo-argentinian-bistro-nyc-new-york"], ["russian tea room - nyc", "russian-tea-room-nyc-new-york"], ["the parisian tea room- nyc", "the-parisian-tea-room-nyc-morganville"], ["rosa mexicano - second avenue", "rosa-mexicano-second-avenue-new-york"], ["atlantic grill at lincoln center", "atlantic-grill-at-lincoln-center-new-york"], ["azara kitchen", "azara-kitchen-new-york"], ["ikyu", "ikyu-sushi-ii-new-york"], ["saperavi ues", "saperavi-ues-new-york"], ["silver lining lounge", "silver-lining-lounge-new-york"], ["dough by licastri silver lake", "dough-by-licastri-silver-lake-richmond-county"], ["lumen dining & rooftop", "lumen-dining-and-rooftop-new-york"], ["the corner chinese", "the-corner-chinese-new-york"], ["the ivy room", "the-ivy-room-new-york"], ["glass ceiling rooftop", "glass-ceiling-rooftop-new-york"], ["tiny tapas and bites", "tiny-tapas-and-bites-new-york"], ["chef papa vietnamese kitchen lic", "chef-papa-vietnamese-kitchen-lic-long-island-city"], ["rosemary's midtown", "rosemarys-midtown-new-york"], ["match 65 brasserie (formerly paris match)", "match-65-brasserie-formerly-paris-match-new-york"], ["brasserie cognac central park south", "brasserie-brasserie-cognac-central-park-south-new-york"], ["empellon midtown", "empellon-midtown-new-york-2"], ["vida verde", "vida-verde-new-york"], ["mr chow - 57th", "mr-chow-57th-new-york"], ["shun lee west", "shun-lee-west-new-york"]];
  const results = {};
  window.__OT_SLUG_RID = results;
  console.log('[OT Slug→RID] ' + ENTRIES.length + ' to check');
  let found = 0, notFound = 0;

  for (let i = 0; i < ENTRIES.length; i++) {
    if (i > 0 && i % 25 === 0) {
      console.log('⏸️ Pausing 90s at ' + i + '/' + ENTRIES.length);
      await sleep(90000);
    }

    const [name, slug] = ENTRIES[i];

    try {
      const res = await fetch('https://www.opentable.com/r/' + slug, { credentials: 'include', redirect: 'follow' });
      if (!res.ok) { notFound++; console.log('✗ [' + (i+1) + '/' + ENTRIES.length + '] ' + name + ' (HTTP ' + res.status + ')'); await sleep(3000); continue; }

      const html = await res.text();
      let rid = 0;
      const pats = [/"rid"\s*:\s*(\d+)/g, /"restaurantId"\s*:\s*(\d+)/g];
      for (const pat of pats) {
        let mm;
        while ((mm = pat.exec(html)) !== null) {
          const v = parseInt(mm[1]);
          if (v > 0) { rid = v; break; }
        }
        if (rid > 0) break;
      }

      if (rid > 0) {
        results[name] = { rid, slug };
        found++;
        console.log('✓ [' + (i+1) + '/' + ENTRIES.length + '] ' + name + ' → ' + rid);
      } else {
        notFound++;
        console.log('✗ [' + (i+1) + '/' + ENTRIES.length + '] ' + name + ' (no rid in html, len=' + html.length + ')');
      }
    } catch (e) {
      notFound++;
      console.log('err [' + (i+1) + '] ' + name + ': ' + e.message);
    }

    window.__OT_SLUG_RID = results;
    await sleep(5000);
  }

  window.__OT_SLUG_RID = results;
  console.log('[Done] ✓' + found + ' ✗' + notFound);
  const d = JSON.stringify(results, null, 2);
  const b = new Blob([d], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = 'ot_slug_rid_89.json';
  a.click();
})();
