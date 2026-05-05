(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ENTRIES = [["smith & wollensky - new york", "smith-and-wollensky-new-york"], ["fogo de chão - new york", "fogo-de-chao-new-york"], ["tony's di napoli - upper east side", "tonys-di-napoli-upper-east-side-new-york"], ["bocca di bacco (theatre district - 45th st.)", "bocca-di-bacco-theatre-district-45th-st-new-york"], ["serafina upper west", "serafina-upper-west-side-new-york"], ["serafina long island city", "serafina-long-island-city-long-island-city"], ["red lobster - brooklyn", "red-lobster-brooklyn"], ["red lobster - bronx", "red-lobster-bronx"], ["ocean prime - new york", "ocean-prime-new-york"], ["cafe luxembourg", "cafe-luxembourg-new-york"], ["john's pizzeria", "johns-of-times-square-new-york"], ["ophelia", "ophelia-new-york"], ["gyu-kaku japanese bbq - new york, ny | midtown manhattan", "gyu-kaku-japanese-bbq-new-york-ny-midtown-manhattan-new-york"], ["roberta's - bushwick", "robertas-bushwick-brooklyn"], ["the smith- lincoln square", "the-smith-lincoln-square-new-york"], ["knickerbocker bar & grill", "knickerbocker-bar-and-grill-new-york"], ["shun lee cafe", "shun-lee-cafe-new-york"], ["da raffaele - nyc", "da-raffaele-new-york"], ["russian samovar & tolstoy's lounge", "russian-samovar-new-york"], ["sushi by bou - jersey city nj @ ani ramen", "sushi-by-bou-jersey-city-nj-at-ani-ramen-jersey-city"], ["holiday cocktail lounge", "holiday-cocktail-lounge-new-york"], ["musaafer - new york", "musaafer-new-york"], ["chalong southern thai", "chalong-southern-thai-new-york"], ["spice symphony – 50th st.", "spice-symphony-50th-st-new-york"], ["warique - williamsburg", "warique-williamsburg-brooklyn"], ["haven rooftop", "haven-rooftop-new-york"], ["creatures rooftop", "creatures-rooftop-new-york"], ["the fleur room nyc", "the-fleur-room-nyc-new-york"], ["the east pole - kitchen and bar", "the-east-pole-kitchen-and-bar-new-york"], ["refinery rooftop", "refinery-rooftop-new-york"], ["majorelle at the lowell", "majorelle-at-the-lowell-new-york"], ["grand salon & bar at baccarat hotel new york", "grand-salon-and-bar-at-baccarat-hotel-new-york"], ["moonstone modern asian cuisine & bar", "moonstone-modern-asian-cuisine-and-bar-new-york"], ["la mela", "la-mela-new-york"], ["pig n whistle - rockefeller center", "pig-n-whistle-rockefeller-center-new-york"], ["numero 28 pizzeria - west village", "numero-28-pizzeria-west-village-new-york"], ["savvy bistro & bar", "savvy-bistro-and-bar-new-york"], ["gazala's", "gazalas-place-new-york"], ["bread & butter", "bread-and-butter-new-york"], ["nino's 46", "ninos-46-new-york"], ["corrado's cucina", "corrados-cucina-new-york"], ["empire burger house", "empire-burger-house-new-york"], ["a la turka restaurant", "a-la-turka-new-york"], ["zaab zaab - queens", "zaab-zaab-queens"], ["the rabbit hole astoria", "the-rabbit-hole-astoria-queens"], ["richmond republic", "richmond-republic-bar-and-grill-staten-island"], ["cheeseboat - hell's kitchen", "cheeseboat-hells-kitchen-new-york"], ["platform by the james beard foundation", "platform-by-the-james-beard-foundation-new-york"], ["west end bar & grill", "west-end-bar-and-grill-new-york"], ["interlude rooftop lounge", "interlude-rooftop-lounge-new-york"]];
  const results = {};
  window.__OT_MANUAL_RID = results;
  console.log('[OT Manual Slug→RID] ' + ENTRIES.length + ' to check');
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
        console.log('✗ [' + (i+1) + '/' + ENTRIES.length + '] ' + name + ' (no rid, len=' + html.length + ')');
      }
    } catch (e) {
      notFound++;
      console.log('err [' + (i+1) + '] ' + name + ': ' + e.message);
    }

    if ((i+1) % 10 === 0) window.__OT_MANUAL_RID = results;
    await sleep(5000);
  }

  window.__OT_MANUAL_RID = results;
  console.log('[Done] ✓' + found + ' ✗' + notFound);
  const d = JSON.stringify(results, null, 2);
  const b = new Blob([d], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = 'ot_manual_rid_50.json';
  a.click();
})();