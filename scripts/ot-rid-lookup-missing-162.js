// OT RID Lookup — 162 missing restaurants
// Uses the restaurantId extraction method from the working bulk scraper
//
// HOW TO USE:
//   1. Chrome → opentable.com
//   2. DevTools Console (Cmd+Opt+J)
//   3. Type: allow pasting
//   4. Paste entire file + Enter
//   5. Wait ~15 min (162 × ~5s each including pauses)
//   6. Download when done

(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const MISSING = [["il cantinori", "il cantinori"], ["aoc east", "AOC East"], ["hoexter’s", "Hoexters"], ["hayashi japanese cuisine", "Hayashi Japanese Cuisine"], ["la pecora bianca ues", "La Pecora Bianca - UES"], ["barbounia", "barbounia"], ["lulu mediterranean grill - edgewater", "Lulu Mediterranean Grill - Edgewater"], ["ikyu 一休", "Ikyu"], ["charoen krung thai", "Charoen Krung Thai"], ["copinette", "Copinette"], ["deux amis", "deux amis"], ["sfoglia", "Sfoglia"], ["peaches hothouse", "Peaches HotHouse"], ["hudson hound", "hudson hound"], ["grissini", "Grissini"], ["amuni", "Amunì Cocktail Bar & Restaurant"], ["berlin currywurst", "Crafterie"], ["campagnola restaurant", "Campagnola"], ["casa galicia", "Casa Galleta - Castelló 12"], ["cena", "Cena 081"], ["central park boathouse restaurant", "central park boathouse restaurant"], ["impasto", "Impasto 48"], ["la nacional restaurant", "La Nacional Restaurant"], ["mama rosa's", "Mama Rosa Mexican Food"], ["marian's", "Maria's Mediterranean"], ["mountain fusion", "Mountain Fusion inc"], ["nomo soho", "Nomo Sarrià"], ["osteria 106", "Osteria 106"], ["press box", "PRESS Restaurant"], ["santo domingo restaurant", "Casa Luca"], ["spice & grill", "Indie Spice Grill - Naas"], ["spring", "Dolce Niente"], ["that sushi spot", "Sushi Spot Hibachi"], ["the harold", "Harold Black - Annapolis"], ["yamato", "yamato"], ["osteria delbianco midtown", "Osteria Delbianco"], ["chef papa vietnamese kitchen", "Chef Papa Vietnamese Kitchen LIC"], ["white radish", "White Radish"], ["rustico", "Rustic Pizza & Pasteria"], ["flame", "Flame NYC - No Hibachi (Regular Tables Only)"], ["sobre masa", "Sobre Masa"], ["fresco's grand cantina", "Fresco's Grand Cantina"], ["dim sum sam", "Dim Sum Bloom"], ["masseria east", "MASSERIA EAST"], ["sugar'd", "Sugar Factory - Queens"], ["jupiter", "Jupiter"], ["malone's", "Malone's Chop House"], ["the red stache", "The Red Stache"], ["la catrina", "La Catrina Queens"], ["lagos tsq", "Lagos TSQ"], ["animo!", "Ánimo!"], ["kebab house", "Kebab House"], ["messy", "Chez Messy"], ["millies", "Millie's of Staten Island"], ["borikén", "Borikén Restaurant & Bar"], ["miriam west village", "Miriam West Village"], ["greca", "GRECA by The Greek"], ["the east pole", "The East Pole - Kitchen and Bar"], ["telio", "Telio Restaurant"], ["la cava", "La Cava Wine Bar"], ["smoke & mirrors", "Smoke and Mirrors"], ["pera mediterranean brasserie", "Pera Mediterranean Brasserie"], ["trattoria tre colori", "Trattoria Trecolori"], ["buceo 95", "Buceo 95"], ["da raffaele", "Pizzeria Da Raffaele"], ["saigon bistro", "Saigon Bistro"], ["the hotel chelsea", "the hotel chelsea"], ["osteria nando", "Osteria Nando"], ["redeye grill", "Redeye Grill"], ["a la turka", "a la turka"], ["barawine", "Barawine"], ["patricia's of morris park", "Patricia's of Morris Park"], ["cafe d'alsace", "Cafe d'Alsace"], ["frankie & johnnie's steakhouse - manhattan", "Frankie & Johnnie's Steakhouse - Manhattan"], ["serafina - 777 third ave", "Serafina - 777 Third Ave"], ["foxy", "Foxy John's Bar & Kitchen"], ["mapo asian restaurant", "Mapo Asian Restaurant & Bar"], ["via vai", "VIA VAI - Astoria"], ["papillon bistro and bar", "Papillon Bistro and Bar"], ["roscioli", "Roscioli - The Roman Feast"], ["yopparai", "yopparai"], ["la vecina", "la vecina"], ["bistro vendome", "bistro vendome"], ["da umberto", "da Umberto"], ["toledo restaurant", "Toledo Restaurant"], ["hide rooftop", "Hide Rooftop"], ["café fleuri", "Café Fleuri"], ["greca by the greek", "GRECA by The Greek"], ["frankie and johnnie's steakhouse - 46th street", "Frankie and Johnnie's Steakhouse - 46th Street"], ["hoexters", "Hoexters"], ["la pecora bianca - uws", "La Pecora Bianca - UWS"], ["french roast", "French Roast"], ["hi-life restaurant - upper west side", "Hi-Life Restaurant - Upper West Side"], ["melba's", "Melba's"], ["shalel", "Shalel"], ["maiella - lic", "Maiella - LIC"], ["the crosby bar", "the crosby bar"], ["catch new york", "Catch New York"], ["sahara's turkish cuisine", "Sahara's Turkish Cuisine"], ["yakiniku gen", "Yakiniku Gen"], ["baires grill - new york", "Baires Grill - New York"], ["hutong", "Hutong"], ["anejo restaurant", "Anejo Restaurant"], ["om real indian food", "om real indian food"], ["taste of india ii", "Taste of India II"], ["gamsung pocha - emokase table bar", "Gamsung Pocha - Emokase Table Bar"], ["sammy's fish box", "Sammy's Fish Box"], ["medi wine bar & restaurant", "Medi Wine Bar & Restaurant"], ["wollensky’s grill", "Wollensky's Grill - New York"], ["sozai (japanese izakaya ramen)", "sozai"], ["sushi damo", "sushi damo"], ["emmy squared - midtown west - nyc", "Emmy Squared - Midtown West - NYC"], ["flame nyc - no hibachi (regular tables only)", "flame nyc"], ["eli’s table", "Eli’s Table"], ["bloom botanical bistro", "Bloom Botanical Bistro"], ["allora", "Allora"], ["uno pizzeria & grill - new york", "Uno Pizzeria & Grill - New York"], ["trattoria l'incontro", "L'Incontro by Rocco"], ["mambo latín kitchen & empanadas", "Mambo Cuban Peruvian"], ["le b.", "Le B."], ["the tygernew", "The Tyger"], ["carnegie diner & cafe, 711 7th avenuenew", "Carnegie Diner & Cafe, 711 7th Avenue"], ["cafe luxembourg", "Cafe Luxembourg"], ["bardough nyc", "BarDough NYC"], ["bogota latin bistronew", "Bogota Latin Bistro"], ["beijing hot pot 京门铜火锅", "BeiJing Hot Pot 京门铜火锅"], ["mēdüzā mediterrania", "Mēdüzā Mediterrania"], ["moca asian bistro - queens", "MoCA Asian Bistro - Queens"], ["sunday restaurant", "sunday restaurant"], ["bobby van's grill - phantom", "bobby van's grill - phantom"], ["chinatown's", "chinatown's"], ["gui steakhouse nyc times square", "gui steakhouse nyc times square"], ["sarabeth's greenwich village 2", "sarabeth's greenwich village 2"], ["aliada", "aliada"], ["ascent lounge", "ascent lounge"], ["cherry point", "cherry point"], ["mrs. georgia", "mrs. georgia"], ["hōseki", "hōseki"], ["jue lan club", "jue lan club"], ["blake’s tavern", "blake’s tavern"], ["bar fes", "bar fes"], ["aromati cafe and wine bar", "aromati cafe and wine bar"], ["carnegie diner & cafe, 711 7th avenue", "carnegie diner & cafe, 711 7th avenue"], ["drift bk restaurant & lounge", "drift bk restaurant & lounge"], ["golden child - hotel park ave nyc", "golden child - hotel park ave nyc"], ["5th & mad", "5th & mad"], ["a.o.c. east", "a.o.c. east"], ["bar goyana", "bar goyana"], ["bill's supper club", "bill's supper club"], ["blend - astoria", "blend - astoria"], ["blend on the water", "blend on the water"], ["brooklyn chop house times square", "brooklyn chop house times square"], ["dolly varden", "dolly varden"], ["mission ceviche", "mission ceviche"], ["rosevale cocktail room", "rosevale cocktail room"], ["trattoria il gusto wine bar", "trattoria il gusto wine bar"], ["westville", "westville"], ["pico de gallo", "pico de gallo"], ["ruta oaxaca", "ruta oaxaca"], ["crab house", "crab house"], ["the basement", "the basement"], ["tanner smiths", "tanner smiths"]];
  const results = {};
  window.__OT_RID_MISSING = results;

  console.log('%c[OT RID Lookup — ' + MISSING.length + ' missing]', 'color: #00b894; font-weight: bold; font-size: 14px');

  let found = 0, notFound = 0, errors = 0, consecutiveErrors = 0;

  function cleanName(name) {
    return name.replace(/\(.*?\)/g, '').replace(/[^\w\s'&-]/g, '').replace(/\s+/g, ' ').trim();
  }

  for (let i = 0; i < MISSING.length; i++) {
    // Pause 2 min every 40 to reset rate limit
    if (i > 0 && i % 40 === 0) {
      console.log('%c  ⏸️  Pausing 2 min at ' + i + '/' + MISSING.length, 'color: #f39c12');
      await sleep(120000);
    }

    const [key, name] = MISSING[i];
    const clean = cleanName(name);
    if (!clean) { notFound++; continue; }

    try {
      const url = 'https://www.opentable.com/s?term=' + encodeURIComponent(clean) + '&metroId=8';
      const res = await fetch(url, { credentials: 'include' });

      if (res.status === 403) {
        errors++;
        consecutiveErrors++;
        console.log('  🚫 [' + (i+1) + '] ' + name + ': blocked');
        if (consecutiveErrors >= 3) {
          console.log('%c  Pausing 5 min...', 'color: red');
          await sleep(300000);
          consecutiveErrors = 0;
        }
        await sleep(5000);
        continue;
      }

      if (!res.ok) {
        errors++;
        consecutiveErrors++;
        continue;
      }
      consecutiveErrors = 0;

      const html = await res.text();

      // NEW METHOD: match restaurantId + name (from the working bulk scraper)
      const pat = /"restaurantId":(\d+)[^}]*?"name":"([^"]+)"/g;
      const candidates = [];
      let m;
      while ((m = pat.exec(html)) !== null) {
        candidates.push({ rid: parseInt(m[1]), name: m[2] });
      }

      // Find best match
      const nameLower = clean.toLowerCase();
      let best = null;
      let bestScore = 0;
      for (const c of candidates) {
        const cLower = c.name.toLowerCase();
        let score = 0;
        if (cLower === nameLower) score = 1.0;
        else if (cLower.includes(nameLower) || nameLower.includes(cLower)) score = 0.9;
        else {
          // Word overlap
          const nw = nameLower.split(/\s+/).filter(w => w.length > 2);
          const cw = cLower.split(/\s+/).filter(w => w.length > 2);
          if (nw.length > 0) {
            const overlap = nw.filter(w => cw.some(x => x.includes(w) || w.includes(x)));
            score = overlap.length / nw.length;
          }
        }
        if (score > bestScore) { bestScore = score; best = c; }
      }

      if (best && bestScore >= 0.5) {
        results[key] = { rid: best.rid, matched: best.name, score: bestScore };
        found++;
        console.log('  ✅ [' + (i+1) + '/' + MISSING.length + '] ' + name + ' → rid=' + best.rid + ' (' + best.name + ')');
      } else {
        notFound++;
        console.log('  ❌ [' + (i+1) + '/' + MISSING.length + '] ' + name + ': no match');
      }
    } catch (e) {
      errors++;
      consecutiveErrors++;
    }

    // Save every 10
    if ((i+1) % 10 === 0) window.__OT_RID_MISSING = results;

    // 4s delay between requests
    await sleep(4000);
  }

  window.__OT_RID_MISSING = results;
  console.log('%c\n[Done] Found ' + found + ' | Not found ' + notFound + ' | Errors ' + errors, 'color: #00b894; font-weight: bold');
  console.log('Download: (()=>{const d=JSON.stringify(window.__OT_RID_MISSING,null,2);const b=new Blob([d],{type:"application/json"});const x=document.createElement("a");x.href=URL.createObjectURL(b);x.download="ot_rid_missing_162.json";x.click();})()');
})();
