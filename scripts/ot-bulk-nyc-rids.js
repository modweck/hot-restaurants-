// OT Bulk NYC RID Scraper
//
// HOW TO USE (run on OTHER computer so it doesn't interfere with v3):
//   1. Open Chrome → opentable.com
//   2. DevTools Console (Cmd+Opt+J)
//   3. Type: allow pasting
//   4. Paste THIS ENTIRE FILE + Enter
//   5. Wait ~10-15 min
//   6. Download: (()=>{const d=JSON.stringify(window.__OT_BULK_RIDS,null,2);const b=new Blob([d],{type:'application/json'});const x=document.createElement('a');x.href=URL.createObjectURL(b);x.download='ot_bulk_nyc_rids.json';x.click();})()

(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rids = {};
  window.__OT_BULK_RIDS = rids;

  console.log('%c[OT Bulk NYC RID Scraper]', 'color: #00b894; font-weight: bold; font-size: 14px');

  let page = 1;
  let consecutiveEmpty = 0;
  const MAX_PAGES = 300; // Safety limit

  while (page <= MAX_PAGES && consecutiveEmpty < 3) {
    const url = `https://www.opentable.com/s?metroId=8&page=${page}`;
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        console.log(`%c  ⚠️  Page ${page}: HTTP ${res.status}`, 'color: red');
        if (res.status === 403 || res.status === 429) {
          console.log('  Waiting 2 min...');
          await sleep(120000);
          continue;
        }
        consecutiveEmpty++;
        page++;
        await sleep(5000);
        continue;
      }

      const html = await res.text();

      // Extract all data-rid + associated slug
      const cardPattern = /data-rid="(\d+)"[^]{0,2000}?\/r\/([a-z0-9-]+)/g;
      let found = 0;
      let m;
      while ((m = cardPattern.exec(html)) !== null) {
        const rid = parseInt(m[1]);
        const slug = m[2];
        if (rid && slug && !rids[slug]) {
          rids[slug] = rid;
          found++;
        }
      }

      // Also extract standalone rids with nearby restaurant name
      const namePattern = /data-rid="(\d+)"[^]{0,1000}?data-test="res-card-name"[^>]*>([^<]+)</g;
      while ((m = namePattern.exec(html)) !== null) {
        const rid = parseInt(m[1]);
        const name = m[2].trim();
        if (rid && name && !rids['_' + name]) {
          rids['_' + name] = rid;
        }
      }

      if (found === 0) consecutiveEmpty++;
      else consecutiveEmpty = 0;

      console.log(`  Page ${page}: +${found} rids (total: ${Object.keys(rids).filter(k => !k.startsWith('_')).length})`);
      window.__OT_BULK_RIDS = rids;

      page++;
      await sleep(3000); // 3s between pages
    } catch (e) {
      console.log(`  ⚠️ Page ${page} error: ${e.message}`);
      consecutiveEmpty++;
      page++;
      await sleep(10000);
    }
  }

  const slugRids = Object.keys(rids).filter(k => !k.startsWith('_')).length;
  const nameRids = Object.keys(rids).filter(k => k.startsWith('_')).length;
  console.log(`%c\n[Done] ${slugRids} slug→rid pairs, ${nameRids} name→rid pairs`, 'color: #00b894; font-weight: bold');
  console.log('Download: (()=>{const d=JSON.stringify(window.__OT_BULK_RIDS,null,2);const b=new Blob([d],{type:"application/json"});const x=document.createElement("a");x.href=URL.createObjectURL(b);x.download="ot_bulk_nyc_rids.json";x.click();})()');
})();
