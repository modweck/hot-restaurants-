(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const CHECK_DATE = '2026-04-11';
  const TIME = '19:00';
  const PARTY_SIZE = 2;
  const results = {};
  window.__OT_BULK_TONIGHT = results;

  console.log('%c[OT Bulk Availability — ' + CHECK_DATE + ' @ ' + TIME + ']', 'color: #00b894; font-weight: bold; font-size: 14px');

  let page = 1;
  let consecutiveEmpty = 0;
  const MAX_PAGES = 300;
  let totalOpen = 0, totalLimited = 0, totalBooked = 0;

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

  while (page <= MAX_PAGES && consecutiveEmpty < 3) {
    try {
      const url = 'https://www.opentable.com/s?metroId=8' +
        '&dateTime=' + CHECK_DATE + 'T' + encodeURIComponent(TIME + ':00') +
        '&covers=' + PARTY_SIZE +
        '&page=' + page;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        console.log('%c  ⚠️ Page ' + page + ': HTTP ' + res.status, 'color: red');
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

      let found = 0;
      const ridPat = /"restaurantId":(\d+)[\s\S]{0,200}?"name":"([^"]+)"([\s\S]{0,8000}?)(?=(?:"restaurantId":\d+|"__typename":"SearchRestaurantConnection"|$))/g;
      let m;
      while ((m = ridPat.exec(html)) !== null) {
        const rid = parseInt(m[1]);
        const name = m[2];
        const block = m[3];
        const slugMatch = block.match(/\/r\/([a-z0-9-]+)/);
        const slug = slugMatch ? slugMatch[1] : null;
        const slots = [];
        const timePat = /(\d{1,2}:\d{2}\s*[AP]M)/g;
        let tm;
        while ((tm = timePat.exec(block)) !== null) {
          if (!slots.includes(tm[1])) slots.push(tm[1]);
        }
        if (results[name]) continue;
        const parsed = parseTimes(slots);
        const tier = parsed.total === 0 ? 'booked' : parsed.total <= 3 ? 'limited' : 'open';
        results[name] = {
          tier,
          dinner_slots: parsed.total,
          early: tier === 'open' ? 'available' : (parsed.early > 0 ? 'limited' : 'booked'),
          prime: tier === 'open' ? 'available' : (parsed.prime > 0 ? 'limited' : 'booked'),
          late: tier === 'open' ? 'available' : (parsed.late > 0 ? 'limited' : 'booked'),
          has_early: parsed.early > 0 || tier === 'open',
          has_prime: parsed.prime > 0 || tier === 'open',
          has_late: parsed.late > 0 || tier === 'open',
          sample_times: parsed.parsed.slice(0, 5),
          rid, slug,
          checked_date: CHECK_DATE
        };
        if (tier === 'open') totalOpen++;
        else if (tier === 'limited') totalLimited++;
        else totalBooked++;
        found++;
      }

      if (found === 0) consecutiveEmpty++;
      else consecutiveEmpty = 0;

      console.log('  Page ' + page + ': +' + found + ' (🟢' + totalOpen + ' 🟡' + totalLimited + ' 🔴' + totalBooked + ')');
      window.__OT_BULK_TONIGHT = results;

      page++;
      await sleep(3000);
    } catch (e) {
      console.log('  ⚠️ Page ' + page + ': ' + e.message);
      consecutiveEmpty++;
      page++;
      await sleep(10000);
    }
  }

  console.log('%c\n[Done] Total ' + Object.keys(results).length + ': 🟢' + totalOpen + ' 🟡' + totalLimited + ' 🔴' + totalBooked, 'color: #00b894; font-weight: bold; font-size: 14px');
  
  // Auto-download
  const d = JSON.stringify(results, null, 2);
  const b = new Blob([d], {type:'application/json'});
  const x = document.createElement('a');
  x.href = URL.createObjectURL(b);
  x.download = 'ot_bulk_tonight_2026-04-11.json';
  x.click();
  console.log('💾 Downloaded: ot_bulk_tonight_2026-04-11.json');
})();
