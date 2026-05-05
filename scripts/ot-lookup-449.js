(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const NAMES = ["sojourn social", "the north fork", "bamboo walk caribbean restaurant", "nino's 46", "bazaar meat", "big apple brunch", "the river caf√©", "sushi by scratch restaurants", "zou zou‚Äôs", "wagamama - midtown", "brooklyn diner", "saperavi", "lokal mediterranean kitchen", "felice columbus", "ler lers", "bombay kitchen", "le monde", "what the fish", "l'osteria", "diwali indian cuisine", "il monello", "resident", "half moon", "pure thai cookhouse", "pure thai restaurant", "la contenta", "mariella", "tootles and french", "vinateria", "agenda restaurant", "kosher grill", "meet the meat", "orale mexican kitchen restaurants jersey city", "treadwell park", "maison harlem", "medium rare", "tra di noi", "just pho you", "emilia's", "pastavino", "7 spices", "alfie's", "altesi ristorante", "due amici", "amuse restaurant", "angelo gordon", "animal", "arabesque", "aria west village", "astoria provisions", "blackbarn", "blend astoria", "boon thai", "bronx burger house", "brooklyn lantern", "burgos restaurant", "capital restaurant", "caribe restaurant", "charlie's place", "charo restaurant", "china city", "crystal", "dai hachi", "don miguel restaurant", "dumpling house", "eagle trading co", "enzo's restaurant", "famous", "fratelli restaurant", "gazala's", "global kitchen", "gyu kaku", "hong kong restaurant", "ikea", "inday", "joanne trattoria", "josie's", "kiku japanese cuisine", "king's kitchen", "kings of kobe", "kyoto sushi", "living room", "los amigos restaurant", "madison restaurant", "mamma rosa's", "mango mango", "margarita island", "marina restaurant", "marrakesh", "medusa", "mizu sushi", "mizumi", "morso", "mughlai indian cuisine", "muse", "newtown", "oasis", "ozen", "palace restaurant", "papi's grill", "patrizia's of maspeth", "pedro's", "pronto restaurant", "puebla restaurant", "puerto plata restaurant", "qingdao", "queens palace", "rebecca's edgewater", "republica", "circle", "rogers burgers", "little ruby's murray hill", "sagar restaurant", "sajoma", "salsa con fuego", "san marzano", "santa ana restaurant", "sapporo", "sayori", "serafina always", "shanghai chinese restaurant", "sofia's taqueria", "sonora", "souvlaki gr midtown", "springfield little dumpling", "ssam", "tandoor restaurant", "taqueria gramercy", "taste of punjab", "testo restaurant", "the butcher's daughter", "the common", "the little one", "threes brewing (governors island)", "trattoria il gusto", "merchants ny", "sesamo restaurant", "the lions", "warique", "marbella", "yara", "mista oh", "paola's restaurant", "attaboy", "bistro so", "ambo", "neta shari", "the rabbit hole", "spes", "sip sak", "kantu peruvian cuisine", "jaz indian cuisine", "brooklyn kebab house", "akdeniz mediterranean cuisine", "addictive nyc", "yasouvlaki", "essential by christophe", "shan", "natural restaurant", "harlem breakfast club", "casa carmen", "mochi dolci", "rice x beans", "naro", "amber", "dim sum bloom", "il tinello", "monterey", "the ainsworth midtown", "el paso mexican restaurants east harlem", "sushi d", "gosht restaurant", "ketchy shuby", "ali baba mediterranean cuisine", "the corner chinese restaurant", "zara terrace mediterranean restaurant", "sushi goda", "docks oyster bar - midtown east, nyc", "mr. broadway restaurant", "the shell", "zen astoria", "rice bird", "yayo's latin cuisine", "tokugawa", "water & wheat", "lena trattoria", "jimmy's on the go", "yingtao", "shhh omakase", "osteria delbianco bryant park", "boske", "fred's", "bombay grill", "sauced up", "fusion kitchen", "bally's golf links", "serena bistro", "the vintage tea", "kaew jao jorm", "lava rock kitchen", "l'incontro by rocco", "little honey", "mansion", "greyz bistro", "sozai japanese restaurant (izakaya ramen)", "pb brasserie", "miss nellie's", "the mouth", "adria", "salt hank's", "lulla", "tutto apposto", "blue ribbon sushi & sake", "audace", "aves", "patrick's on the hill", "wayward fare", "tipsy shanghai restaurant", "castell's", "pavin86", "altamirano's italian ristorante", "happy cake bistro", "flushing house", "sips", "teruko", "bucatini", "emporium brasil", "history", "palladino's", "yum cha restaurant", "ikyu sushi ii", "jan jao kha", "roast", "big blue seafood & grill", "sunday", "leandro's kitchen & wine", "odo east village", "boobliq", "giulietta", "pulperia latin mediterranean kitchen", "renaissance", "santa fe restaurant", "melba's restaurant", "jadis", "the mean fiddler", "nica trattoria", "wicked willy's", "nizza", "the grey dog", "matteo's of howard beach", "the russian tea room", "the vine", "bombay's", "lavagna", "siena", "elephant ear", "fabrika", "salvaje social club nyc", "matsuri", "paros tribeca", "yard house", "lobster place", "burger club", "the broadway", "shokudo", "fish grill - brooklyn", "la sova", "bergen hall", "anejo tribeca", "wagamama - murray hill", "the jin", "barolo east", "patrizia's of sheepshead bay", "momokawa", "alice restaurant", "for u", "george's", "blue fin", "bustronome new york", "pershing square restaurant", "the grey dog (nolita)", "rosemary's west village", "the grey dog (west village)", "nougatine at jean georges", "bustan nyc", "tarallucci e vino union square", "alta", "the wilson", "cowgirl", "seven hills mediterranean grill", "tio pepe", "mas (farmhouse)", "churrascaria plataforma", "russian samovar", "wolfgang's steakhouse - tribeca", "bkk new york", "zimmis", "iris", "poke", "sushi by m", "the boil brooklyn", "sugar factory - time square", "grand view events", "marlow east", "san matteo", "blue note", "deja vu", "maria's", "la pecora bianca - midtown", "pasta corner", "caf√© d'anvers", "antalia", "lilli restaurant", "drift restaurant and bar", "gnocchi bar", "gu japanese fusion sushi & bar", "bar rocco", "casa dani", "c√¥ l·∫°c", "l'angeletto", "il carino restaurant", "ploume", "cheeseboat - williamsburg", "the brooklyn deli - times square", "cibar lounge", "morton's the steakhouse - midtown manhattan", "joe & pat‚Äôs nyc", "golden steer steakhouse nyc", "pappas - new york", "estiatorio milos ‚Äì midtown new york", "quality italian - new york", "kings of kobe - wagyu kitchen & bar", "serafina broadway", "la pecora bianca - ues", "boqueria ues", "island", "oda house - upper east side", "zoi mediterranean ues", "serafina upper west", "bustan", "the consulate upper west side", "5 napkin burger - upper west side", "saperavi uws", "native harlem", "community food & juice", "l' artista", "vida nyc", "piccola cucina osteria - spring st.", "kabin", "friedman's - 72nd st", "mapo asian restaurant & bar", "jams - nyc", "the parisian tea room- nyc", "rosa mexicano - second avenue", "atlantic grill at lincoln center", "ikyu", "silver lining lounge", "dough by licastri silver lake", "lumen dining & rooftop", "the ivy room", "glass ceiling rooftop", "tiny tapas and bites", "ocean prime - new york", "brasserie cognac central park south", "empellon midtown", "vida verde", "mr chow - 57th", "chalong southern thai", "zaab zaab - queens", "musaafer - new york", "smith & wollensky - new york", "a la turka restaurant", "sammy's smokehouse bbq & grill", "celon bar and lounge", "fogo de ch√£o - new york", "empire burger house", "corrado's cucina", "holiday cocktail lounge", "creatures rooftop", "private room", "savvy bistro & bar", "tony's di napoli - upper east side", "bocca di bacco (theatre district - 45th st.)", "gyu-kaku japanese bbq - new york, ny | midtown manhattan", "serafina long island city", "shun lee cafe", "moonstone modern asian cuisine & bar", "the east pole - kitchen and bar", "5 acres", "fernando's hideaway", "the dickens", "bonsaii tapas & wine bar", "langan's", "haswell green's", "westland roe", "the rabbit hole astoria", "richmond republic", "the fleur room nyc", "ophelia", "grand salon & bar at baccarat hotel new york", "sushi by bou - jersey city nj @ ani ramen", "red lobster - brooklyn", "red lobster - bronx", "majorelle at the lowell", "sally's waterfront dining", "platform by the james beard foundation", "cheeseboat - hell's kitchen", "russian samovar & tolstoy's lounge", "kween", "sol de colombia", "porteno restaurant", "la gran uruguaya restaurant", "dave & buster's - new york city (times square)", "dave & buster's - brooklyn", "john's pizzeria", "violette's restaurant", "mythos authentic greek cuisine", "vietnaam restaurant", "sappeisan", "capt loui cajun seafood boil", "rt 60", "maestro's italian restaurant", "r slice pizza", "giardino d'oro", "miti miti modern mexicannew", "dk", "yokox omakasenew", "bar fesnew", "gather espresso & wine barnew", "roey'snew", "veeraysnew", "bar lolanew", "aromati cafe and wine barnew", "mchale's bar & grill", "miriam upper east sidenew", "la pecora bianca - soho", "pluenew", "tarallucci e vino - nomad", "thai pavilionnew", "tandoor & co. restaurantnew", "taishoken ny - ramen and dipping ramen barnew", "bull on knife zha zha beefnew", "empire rooftop @ empire hotel", "rt60 rooftop bar & lounge", "vineapplenew", "art house georgian restaurantnew", "drift bk restaurant & loungenew", "√°nimo!", "golden child - hotel park ave nycnew"];
  const results = {};
  window.__OT_LOOKUP_449 = results;
  console.log('[OT 449 Lookup] ' + NAMES.length + ' to lookup');
  let found = 0, notFound = 0, blocked = 0, consecutiveErrors = 0;

  for (let i = 0; i < NAMES.length; i++) {
    if (i > 0 && i % 40 === 0) {
      console.log('⏸️  Pausing 2 min at ' + i + '/' + NAMES.length);
      await sleep(120000);
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
        await sleep(5000);
        continue;
      }
      if (!res.ok) {
        consecutiveErrors++;
        if (consecutiveErrors >= 5) { await sleep(300000); consecutiveErrors = 0; }
        continue;
      }
      blocked = 0;
      consecutiveErrors = 0;

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
        console.log('✅ [' + (i+1) + '/' + NAMES.length + '] ' + name + ' → ' + best.rid);
      } else {
        notFound++;
        console.log('❌ [' + (i+1) + '/' + NAMES.length + '] ' + name);
      }
    } catch (e) { console.log('err ' + name); }

    if ((i+1) % 10 === 0) window.__OT_LOOKUP_449 = results;
    await sleep(4000);
  }

  window.__OT_LOOKUP_449 = results;
  console.log('[Done] ' + found + ' found, ' + notFound + ' not found');

  // Auto-download
  const d = JSON.stringify(results, null, 2);
  const b = new Blob([d], {type:'application/json'});
  const x = document.createElement('a');
  x.href = URL.createObjectURL(b);
  x.download = 'ot_lookup_449.json';
  x.click();
  console.log('💾 Downloaded: ot_lookup_449.json');
})();
