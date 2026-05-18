(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const PARTY_SIZE = 2;
  const d = new Date(); d.setDate(d.getDate() + 1);
  const DATE = d.toISOString().split('T')[0];

  const NAMES = ["Tarallucci E Vino Upper West Side", "tony's di napoli", "Lattanzi Ristorante", "nami nori", "wolfgang's steakhouse", "Aquavit Restaurant", "tastings", "kopitiam", "wildair", "San Carlo Cicchetti", "mike's bistro", "stars", "markette", "Korali Estiatorio", "seva indian cuisine", "bahari estiatorio", "PLATEIA GR", "stk - nyc downtown", "alley 41", "bayon", "cho dang gol", "Vietnaam Restaurant", "oso", "pierozek", "soba totto", "tolo", "demo", "meximodo", "mitsuru", "muku", "lydia's", "blt steak", "dos caminos", "great ny noodletown", "grand banks", "Pio Pio 8", "beija flor", "la pecora bianca bryant park", "soho park", "good guy's", "Avena", "acre", "tsion", "for all things good bedstuy", "mayfield", "wayne and sons", "sushi lin upper west side", "amy thai bistro", "cocina consuelo", "daphne's", "dept of culture", "palo santo", "naked dog", "jack jones gastropub", "chick chick", "kuku korean cuisine forest hills", "casa tulum", "tenny's", "Hao Noodle Chelsea", "ondo jersey city", "san patricios jersey city", "max soha", "terravita edgewater", "kuku korean cuisine lic", "el fish marisqueria", "purple waves", "bcd tofu house", "bison and bourbon", "domodomo jersey city", "chez oskar", "am thai bistro", "Rare Chelsea", "redwood pleasure club", "bkb | brooklyn brasserie", "roberto's"];

  console.log('[OT Batch 1 — Live DOM] ' + NAMES.length + ' restaurants | Date: ' + DATE);
  console.log('This will navigate this tab to each search. Do NOT click anything.');

  const results = {};
  window.__OT_BATCH = results;
  let found = 0, noMatch = 0, errors = 0;

  function matchScore(search, found) {
    const c = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const sc = c(search), fc = c(found);
    if (sc === fc) return 1.0;
    if (fc.includes(sc) || sc.includes(fc)) return 0.9;
    const stop = ['the','and','restaurant','bar','grill','cafe','kitchen','nyc','new','york'];
    const sw = sc.split(' ').filter(w => w.length > 2 && !stop.includes(w));
    const fw = fc.split(' ').filter(w => w.length > 2 && !stop.includes(w));
    if (sw.length === 0) return 0;
    const overlap = sw.filter(w => fw.some(f => f.includes(w) || w.includes(f)));
    return overlap.length / sw.length;
  }

  for (let i = 0; i < NAMES.length; i++) {
    const name = NAMES[i];
    const clean = name.replace(/\(.*?\)/g, '').replace(/[^\w\s\'&-]/g, '').replace(/\s+/g, ' ').trim();
    const url = 'https://www.opentable.com/s?term=' + encodeURIComponent(clean) + '&dateTime=' + DATE + 'T19%3A30%3A00&covers=' + PARTY_SIZE + '&metroId=8';

    try {
      window.location.href = url;
      // Wait for page to load and render
      await sleep(4000);

      // Wait for cards to appear (up to 8 more seconds)
      let cards = [];
      for (let wait = 0; wait < 4; wait++) {
        cards = document.querySelectorAll('[data-test="pinned-restaurant-card"],[data-test="restaurant-card"]');
        if (cards.length > 0) break;
        await sleep(2000);
      }

      if (cards.length === 0) {
        errors++;
        continue;
      }

      let bestMatch = null, bestScore = 0;
      for (const card of Array.from(cards).slice(0, 5)) {
        const cardName = card.querySelector('a[data-test="res-card-name"]')?.textContent?.trim() || '';
        const rid = card.getAttribute('data-rid') || '';
        const score = matchScore(name, cardName);
        const slotEls = card.querySelectorAll('li[data-test^="time-slot"]');
        const slots = [];
        for (const s of slotEls) {
          const m = s.textContent.trim().match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
          if (m) slots.push(m[1]);
        }
        const notOnOT = card.innerText.includes('not on the OpenTable reservation network');
        if (score > bestScore) { bestScore = score; bestMatch = { name: cardName, rid: rid ? parseInt(rid) : null, slots, notOnOT, score }; }
      }

      if (bestMatch && bestScore >= 0.7 && !bestMatch.notOnOT && bestMatch.rid) {
        results[name] = { rid: bestMatch.rid, matched_name: bestMatch.name, score: bestScore, slots: bestMatch.slots.length, times: bestMatch.slots.slice(0, 5), bookable: bestMatch.slots.length > 0 };
        found++;
        console.log((bestMatch.slots.length > 0 ? '🟢' : '🔴') + ' [' + (i+1) + '/' + NAMES.length + '] ' + name + ' → ' + bestMatch.name + ' (rid:' + bestMatch.rid + ', ' + bestMatch.slots.length + ' slots)');
      } else {
        noMatch++;
        console.log('❌ [' + (i+1) + '/' + NAMES.length + '] ' + name + ': no match');
      }
    } catch(e) { errors++; }

    await sleep(2000);
  }

  window.__OT_BATCH = results;
  console.log('\n' + '='.repeat(40));
  console.log('Batch 1 done! Found: ' + found + ' | No match: ' + noMatch + ' | Errors: ' + errors);
  console.log('Results in window.__OT_BATCH — copy with: copy(JSON.stringify(window.__OT_BATCH, null, 2))');
})();