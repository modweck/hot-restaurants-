(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const NAMES = ["carnegie diner & cafe, 711 7th avenue", "nomo soho", "ikyu 一休", "dim sum sam", "café fleuri", "trattoria l'incontro", "animo!", "bobby van's grill - phantom", "sugar'd", "sunday restaurant", "carnegie diner & cafe, 711 7th avenuenew", "mission ceviche", "bar goyana", "blake‚Äôs tavern", "mēdüzā mediterrania", "tanner smiths", "bogota latin bistronew", "wollensky‚Äôs grill", "eli’s table", "cafe luxembourg", "berlin currywurst", "boqueria ues", "wollensky’s grill", "amuni", "sarabeth's greenwich village 2", "casa galicia", "hoexter’s", "beijing hot pot 京门铜火锅", "that sushi spot", "blake’s tavern", "eli‚Äôs table", "dolly varden"];
  const results = {};
  window.__OT_LOOKUP_40 = results;
  console.log('[OT 40 Lookup] ' + NAMES.length + ' to lookup');
  let found = 0, notFound = 0, blocked = 0;

  for (let i = 0; i < NAMES.length; i++) {
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
        console.log('✅ [' + (i+1) + '/' + NAMES.length + '] ' + name + ' → ' + best.rid + ' (' + best.name + ')');
      } else {
        notFound++;
        console.log('❌ [' + (i+1) + '/' + NAMES.length + '] ' + name);
      }
    } catch (e) { console.log('err ' + name); }

    window.__OT_LOOKUP_40 = results;
    await sleep(4000);
  }

  console.log('[Done] ' + found + ' found, ' + notFound + ' not found');
  const d = JSON.stringify(results, null, 2);
  const b = new Blob([d], {type:'application/json'});
  const x = document.createElement('a');
  x.href = URL.createObjectURL(b);
  x.download = 'ot_lookup_40.json';
  x.click();
  console.log('💾 Downloaded: ot_lookup_40.json');
})();
