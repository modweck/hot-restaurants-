// OT Cuisine Scraper — Japanese + American
// Paste into Chrome console on opentable.com
// Auto-downloads when done

(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rids = {};
  window.__OT_JA = rids;

  const CUISINES = ['japanese', 'american'];

  console.log('%c[OT Cuisine Scraper — Japanese + American]', 'color: #00b894; font-weight: bold; font-size: 14px');

  for (const cuisine of CUISINES) {
    console.log('\n🍽️  ' + cuisine);
    let page = 1;
    let empty = 0;
    while (page <= 30 && empty < 2) {
      try {
        const url = `https://www.opentable.com/s/?cuisine=${cuisine}&metroId=8&page=${page}`;
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) {
          console.log(`  page ${page}: HTTP ${res.status}`);
          empty++;
          page++;
          await sleep(5000);
          continue;
        }
        const html = await res.text();

        const pat = /"restaurantId":(\d+)[\s\S]{0,200}?"name":"([^"]+)"[\s\S]{0,500}?\/r\/([a-z0-9-]+)/g;
        let found = 0;
        let m;
        while ((m = pat.exec(html)) !== null) {
          const rid = parseInt(m[1]);
          const name = m[2];
          const slug = m[3];
          if (!rids[slug]) {
            rids[slug] = { rid, name, cuisine };
            found++;
          }
        }
        if (found === 0) empty++;
        else empty = 0;
        console.log(`  page ${page}: +${found} (total: ${Object.keys(rids).length})`);
        window.__OT_JA = rids;
        page++;
        await sleep(2500);
      } catch (e) {
        console.log(`  page ${page} err: ${e.message}`);
        empty++;
        page++;
        await sleep(5000);
      }
    }
  }

  console.log(`%c\n[Done] ${Object.keys(rids).length} total rids — auto-downloading`, 'color: #00b894; font-weight: bold');

  const d = JSON.stringify(rids, null, 2);
  const b = new Blob([d], { type: 'application/json' });
  const x = document.createElement('a');
  x.href = URL.createObjectURL(b);
  x.download = 'ot_rids_japanese_american.json';
  x.click();
  console.log('💾 Downloaded: ot_rids_japanese_american.json');
})();
