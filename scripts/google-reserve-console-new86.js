(async () => {
  const DATE = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const PARTY_SIZE = 2;
  const TIMES = ['T173000', 'T193000', 'T210000'];
  const ENTRIES = [["carmine's - 44th street", "7GynP_85yjg"], ["1885 Grill", "bXYkT49ttYU"], ["Peter's Steakhouse", "kPP1klaV_8o"], ["ha's \u0111\u1eb7c bi\u1ec7t", "Bm4ouXME5rw"], ["kaizen flushing", "QkjsD05j23A"], ["shaw-na\u00e9\u2019s house", "U5fkjmNP82M"], ["saul", "g-xk7wW7uEg"], ["southern spice", "MCWj2_rgazo"], ["avra 48th street", "V7_1VPjPABc"], ["Rare Chelsea", "WvEbPIonQHQ"], ["antique garage tribeca", "MBvdtO5ArjA"], ["ayada thai restaurant", "rci10zdOhBc"], ["BG - Bergdorf Goodman", "NWjodmYHhjA"], ["Cecconi's Mayfair", "gT5-YrmNKT0"], ["Crab House Seafood All You Can Eat", "nTLnBsa9zgk"], ["don giovanni ristorante", "ADBBfj1pGEk"], ["el coyote restaurant", "o-jkaJOF16c"], ["el patron mexican grill", "3c9YWE7nVpU"], ["famous sichuan", "PhU9oQRFahQ"], ["gina la fornarina", "4H5uK41puOs"], ["giovanni restaurant", "ADBBfj1pGEk"], ["hibachi express", "4cQFTasq6JM"], ["FAMILI", "7GynP_85yjg"], ["noches de colombia", "o0Y77jl5bQE"], ["one star", "fzT-GF13i04"], ["press room", "LIL7rCA59AE"], ["turntable chicken & rock", "dr9cPkIWq_M"], ["mictlan mexico", "cbEQVpDmeK8"], ["geisha asian fusion", "ZAzwc0HnNdM"], ["geisha japanese grill", "ZAzwc0HnNdM"], ["our new place", "gXbfwCPkUdA"], ["curry house", "bYUp0ICdKkE"], ["Harlemite Peruvian Cuisine", "UuyV8l4YJU0"], ["gotham burger social club", "xy4-VwCIAMk"], ["Gotham Restaurants Llc", "xy4-VwCIAMk"], ["go sushi", "nZlTtmULzH4"], ["n/a", "MrZ0EKO7kL8"], ["ming men", "UbVhmhznOVg"], ["arianas cucina", "wK4TxdpdbhA"], ["ki sushi", "4ieFxM3GTHc"], ["dim sum palace", "n9NikRu2hds"], ["golden thai", "BlMRSLipK6U"], ["club please", "p9mtYbC75_o"], ["Hiroshi Japanese Asian Fusion", "w-YTrdEQYsk"], ["olivia's", "SS0Y6ermhA0"], ["sora", "VF0KPdVCD8U"], ["tillie's x wsa", "TnEAnDnawTU"], ["Southern Charm Restaurant", "f7pDksRJn8A"], ["Thailicious", "pyrwcZ4A25Y"], ["The Best Sichuan", "PhU9oQRFahQ"], ["Ayat", "NZK5nGXbkXY"], ["Pollen Street Social", "fc2uSdNgMuk"], ["Patiala Indian Grill", "Q3gUSdtE3eM"], ["The Butcher And Bottle", "YeV3fagq6Yw"], ["Agave", "CZGgSdAB1XA"], ["Rickard Ridge BBQ", "0ITeb4eiFHE"], ["Anand Indian Cuisine", "MrZ0EKO7kL8"], ["Spice 55 Thai & Sushi", "acjsULDl7kQ"], ["The Spice Of Life", "acjsULDl7kQ"], ["JR Restaurant", "ZnweKsUYE5k"], ["El Toro mexican grill", "QRkgvANhFmo"], ["Kawa Sushi", "XEaZUC6gcXI"], ["Simply Noodles", "AwZyNDa7xXo"], ["Clove", "cpsmdW2SZwo"], ["pierres", "Sp3RCuYDeu0"], ["100 FUN", "6XZcmWrItPg"], ["BAHT", "24I_zb8xnb4"], ["FILIPINIANA", "TE8qZYPW_z0"], ["NEW MIYABI", "0lvUn3BD1l0"], ["SIZZLING SQUID", "pyrwcZ4A25Y"], ["THE GOAT", "ck9WCH_uKk0"], ["bar", "G8WCLWqgiyc"], ["EDO", "ebrBrwkq1wQ"], ["5ive Spice LES", "opUbplqdURk"], ["Desi Grill", "u0dF4z7xTGE"], ["Yemen Cafe", "DcEkyJVpBMQ"], ["Sushi by Bou Ani Ramen", "H_nUhrvKREQ"], ["Don Patron Bar & Grill", "3c9YWE7nVpU"], ["Golden Dove", "YQpqS2k46rs"], ["Little Sheep Hot Pot & Bar", "W1GLdLJrHYM"], ["the great indian kitchen", "m7jQZVd2HKA"], ["bar kabawa", "89ZqOD_x-Q8"], ["kura revolving sushi bar", "RKUKnHw3d4M"], ["broadway comedy club", "j0vxCnrsQCE"], ["Vegan Grill", "7usBoBtyods"], ["Tempura NYC", "8IRNvkGCoLQ"]];
  const BATCH = 3;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const results = {};
  window.__GOOGLE_AVAIL_NEW = results;

  console.log('[Google Reserve] ' + ENTRIES.length + ' restaurants x 3 times');

  function parseSlots(html) {
    const slotSection = html.match(/DINING[\s\S]*?(?=Booking times|partnership|Continue|$)/i);
    const section = slotSection ? slotSection[0] : html;
    const raw = section.match(/\d{1,2}:\d{2}\s*[AP]M/gi) || [];
    const unique = [...new Set(raw)];
    const dinner = [];
    for (const t of unique) {
      const m = t.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
      if (!m) continue;
      let h = parseInt(m[1]);
      if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
      if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
      const hour = h + parseInt(m[2]) / 60;
      if (hour >= 17 && hour <= 23) dinner.push(t);
    }
    return dinner;
  }

  for (let i = 0; i < ENTRIES.length; i += BATCH) {
    const batch = ENTRIES.slice(i, i + BATCH);

    const promises = batch.map(async ([name, rid]) => {
      const allTimes = new Set();

      for (const timeCode of TIMES) {
        const url = "https://www.google.com/maps/reserve/v/dine/c/" + rid + "?hl=en-US&ps=" + PARTY_SIZE + "&ld=" + DATE + timeCode;
        try {
          const resp = await fetch(url);
          const html = await resp.text();
          const slots = parseSlots(html);
          slots.forEach(t => allTimes.add(t));
        } catch(e) {}
      }

      const parsed = [...allTimes];
      let early = 0, prime = 0, late = 0;
      const dinnerTimes = [];

      for (const t of parsed) {
        const m = t.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
        if (!m) continue;
        let h = parseInt(m[1]);
        if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
        if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
        const hour = h + parseInt(m[2]) / 60;
        if (hour < 17) continue;
        dinnerTimes.push(t);
        if (hour < 18.75) early++;
        else if (hour >= 19.0 && hour < 20.5) prime++;
        else if (hour >= 20.5) late++;
      }

      // 0=booked, 1-2=limited, 3+=available
      function ws(c) { return c === 0 ? "booked" : c <= 2 ? "limited" : "available"; }
      const e = ws(early), p = ws(prime), l = ws(late);

      let tier;
      if (e === "booked" && p === "booked" && l === "booked") tier = "booked";
      else if (e === "available" && p === "available" && l === "available") tier = "open";
      else tier = "limited";

      dinnerTimes.sort((a, b) => {
        const pa = a.match(/(\d+):(\d+)\s*([AP]M)/i);
        const pb = b.match(/(\d+):(\d+)\s*([AP]M)/i);
        let ha = parseInt(pa[1]); if(pa[3].toUpperCase()==="PM"&&ha!==12)ha+=12;
        let hb = parseInt(pb[1]); if(pb[3].toUpperCase()==="PM"&&hb!==12)hb+=12;
        return (ha+parseInt(pa[2])/60)-(hb+parseInt(pb[2])/60);
      });

      results[name] = {
        tier, early: e, prime: p, late: l,
        has_early: early > 0, has_prime: prime > 0, has_late: late > 0,
        dinner_slots: dinnerTimes.length,
        sample_times: dinnerTimes.slice(0, 12),
        platform: "google_reserve",
        checked_date: new Date().toISOString()
      };

      const icon = tier === "open" ? "🟢" : tier === "limited" ? "🟡" : "🔴";
      return icon + " " + name + ": E=" + e + " P=" + p + " L=" + l + " (" + dinnerTimes.length + ")";
    });

    const logs = await Promise.all(promises);
    logs.forEach((log, j) => console.log("[" + (i+j+1) + "/" + ENTRIES.length + "] " + log));
    await sleep(1000);
  }

  console.log("[Done] " + Object.keys(results).length + " restaurants");
  const tiers = {};
  Object.values(results).forEach(v => { tiers[v.tier] = (tiers[v.tier]||0) + 1; });
  console.log("🟢" + (tiers.open||0) + " 🟡" + (tiers.limited||0) + " 🔴" + (tiers.booked||0));

  const d = JSON.stringify(results, null, 2);
  const b = new Blob([d], {type: "application/json"});
  const _a = document.createElement("a");
  _a.href = URL.createObjectURL(b);
  _a.download = "google_reserve_avail_new.json";
  _a.click();
})();