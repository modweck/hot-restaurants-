(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const GQL_HASH = 'cbcf4838a9b399f742e3741785df64560a826d8d3cc2828aa01ab09a8455e29e';
  const TOKEN = 'eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjowLCJuIjowfQ';
  const PARTY_SIZE = 2;

  // Tomorrow's date
  const d = new Date(); d.setDate(d.getDate() + 1);
  const DATE = d.toISOString().split('T')[0];

  let CSRF_TOKEN = window.OT_CSRF || document.cookie.match(/csrf_token=([^;]+)/)?.[1] || document.querySelector('meta[name="csrf-token"]')?.content;
  if (!CSRF_TOKEN) { CSRF_TOKEN = prompt('Paste your OT CSRF token:'); }
  if (!CSRF_TOKEN) { console.error('No CSRF'); return; }
  window.OT_CSRF = CSRF_TOKEN;

  // Load the names list
  let NAMES;
  try {
    const resp = await fetch('https://raw.githubusercontent.com/modweck/hot-restaurants-/main/scripts/ot-check-website-google.json');
    const data = await resp.json();
    NAMES = data.map(e => e[0]);
  } catch(e) {
    console.error('Could not load names list from GitHub. Paste it manually.');
    return;
  }

  console.log('[OT Link Check] ' + NAMES.length + ' restaurants to search');
  console.log('Date: ' + DATE);

  const results = {};
  window.__OT_LINKS = results;
  let found = 0, notFound = 0, errors = 0;

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
    const clean = name.replace(/\(.*?\)/g, '').replace(/[^\w\s'&-]/g, '').replace(/\s+/g, ' ').trim();

    try {
      const url = `https://www.opentable.com/dapi/fe/gql?optype=query&opname=RestaurantsSearch`;
      const res = await fetch('https://www.opentable.com/s?term=' + encodeURIComponent(clean) + '&dateTime=' + DATE + 'T19%3A30%3A00&covers=' + PARTY_SIZE + '&metroId=8', {
        credentials: 'include'
      });

      if (!res.ok) {
        errors++;
        if (res.status === 403) {
          console.log('  🚫 [' + (i+1) + '] Blocked — pausing 60s');
          await sleep(60000);
        }
        continue;
      }

      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const cards = doc.querySelectorAll('[data-test="pinned-restaurant-card"],[data-test="restaurant-card"]');

      let bestMatch = null;
      let bestScore = 0;

      for (const card of Array.from(cards).slice(0, 5)) {
        const cardName = card.querySelector('a[data-test="res-card-name"]')?.textContent?.trim() || '';
        const rid = card.getAttribute('data-rid') || '';
        const score = matchScore(name, cardName);

        const slotEls = card.querySelectorAll('li[data-test^="time-slot"]');
        const slots = [];
        for (const s of slotEls) {
          const text = s.textContent.trim();
          const m = text.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
          if (m) slots.push(m[1]);
        }

        const cardText = card.innerText;
        const noAvail = cardText.includes('no online availability') || cardText.includes('No tables') || cardText.includes('fully booked');
        const notOnOT = cardText.includes('not on the OpenTable reservation network');
        const hasNotify = cardText.includes('Notify') || cardText.includes('notify');

        if (score > bestScore) {
          bestScore = score;
          bestMatch = { name: cardName, rid: rid ? parseInt(rid) : null, slots: slots.length, times: slots.slice(0, 5), noAvail, notOnOT, hasNotify, score };
        }
      }

      if (bestMatch && bestScore >= 0.7 && !bestMatch.notOnOT) {
        // Has OT page — either bookable or notify
        const bookable = bestMatch.slots > 0 || bestMatch.hasNotify;
        if (bookable || bestMatch.rid) {
          results[name] = {
            rid: bestMatch.rid,
            matched_name: bestMatch.name,
            score: bestScore,
            slots: bestMatch.slots,
            times: bestMatch.times,
            has_notify: bestMatch.hasNotify,
            bookable: bestMatch.slots > 0,
            url: bestMatch.rid ? 'https://www.opentable.com/r/' + bestMatch.rid : null
          };
          found++;
          const icon = bestMatch.slots > 0 ? '🟢' : bestMatch.hasNotify ? '🔔' : '📋';
          console.log('  ' + icon + ' [' + (i+1) + '/' + NAMES.length + '] ' + name + ' → ' + bestMatch.name + ' (rid:' + bestMatch.rid + ', ' + bestMatch.slots + ' slots)');
        } else {
          notFound++;
        }
      } else {
        notFound++;
      }
    } catch(e) {
      errors++;
    }

    // Save progress every 50
    if ((i+1) % 50 === 0) {
      window.__OT_LINKS = results;
      console.log('  💾 Progress: ' + found + ' found / ' + (i+1) + ' checked');
    }

    await sleep(1500);
  }

  window.__OT_LINKS = results;
  console.log('\n═══════════════════════════════════════');
  console.log('✅ Done! ' + found + ' found on OT out of ' + NAMES.length);
  console.log('❌ Not found: ' + notFound + '  ⚠️ Errors: ' + errors);

  const blob = new Blob([JSON.stringify(results, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ot_links_found.json';
  a.click();
})();
