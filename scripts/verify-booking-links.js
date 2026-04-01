const fs = require('fs');
const path = require('path');

const RESULTS_FILE = path.join(__dirname, '..', 'data', 'website_booking_links_found.json');
const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const VERIFIED_FILE = path.join(__dirname, '..', 'data', 'website_booking_verified.json');
const REJECTED_FILE = path.join(__dirname, '..', 'data', 'website_booking_rejected.json');

const AUTH = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3Nzg0OTgyMTksInVpZCI6Mzk4MTc5NDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxMzE1NzU1OTh9fQ.ATA70GJaKhFagX1Gp22JvXmOQOt4jn93nqenmNTJI53JrCb7fukcXykqrn9AJ1dzLBzvVnWbWt4gdRVgY-Vh6vo4Ac6IH0XvAebptK-iTb0MqvfKMx1t0vUAeCLk43iiZ0tle5UaPthjph0f-9f-J3PruLprzEOE8rX_v9OnYjBs5NC_';
const KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isNYC(lat, lng) {
  if (!lat || !lng) return false;
  return lat >= 40.48 && lat <= 40.95 && lng >= -74.27 && lng <= -73.68;
}

async function main() {
  const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  const master = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));

  const verified = [];
  const rejected = [];

  for (const r of results) {
    const key = Object.keys(master).find(k => k.toLowerCase() === r.name.toLowerCase());
    const ourLat = key ? master[key].lat : null;
    const ourLng = key ? master[key].lng : null;

    if (r.platform === 'resy') {
      const slugMatch = r.link.match(/venues?\/([^?&#"]+)/) || r.link.match(/cities\/[^/]+\/([^?&#"]+)/);
      const slug = slugMatch ? slugMatch[1] : null;
      if (!slug) { rejected.push({ name: r.name, reason: 'no slug' }); continue; }

      try {
        const res = await fetch('https://api.resy.com/3/venue?url_slug=' + slug + '&location=ny', {
          headers: { 'Authorization': 'ResyAPI api_key="' + KEY + '"', 'X-Resy-Auth-Token': AUTH, 'Origin': 'https://resy.com', 'Accept': 'application/json' }
        });
        const d = await res.json();
        if (!d.name) { rejected.push({ name: r.name, reason: 'slug not found: ' + slug }); continue; }

        const resyLat = d.location?.latitude;
        const resyLng = d.location?.longitude;
        if (!isNYC(resyLat, resyLng)) { rejected.push({ name: r.name, reason: 'not NYC: ' + (d.location?.locality || '?'), resyName: d.name }); continue; }

        let dist = null;
        if (ourLat && resyLat) {
          dist = Math.round(Math.sqrt(Math.pow(ourLat - resyLat, 2) + Math.pow(ourLng - resyLng, 2)) * 111000);
        }
        if (dist && dist > 2000) { rejected.push({ name: r.name, reason: dist + 'm away', resyName: d.name }); continue; }

        verified.push({ name: r.name, platform: 'resy', url: 'https://resy.com/cities/new-york-ny/venues/' + d.url_slug, resyName: d.name, dist });
        console.log('✅ ' + r.name + ' → ' + d.name + ' (' + d.url_slug + ')' + (dist ? ' ' + dist + 'm' : ''));
      } catch (e) {
        rejected.push({ name: r.name, reason: 'error: ' + e.message.substring(0, 30) });
      }
      await sleep(800);

    } else if (r.platform === 'opentable') {
      if (r.link.includes('restaurant-search.aspx') || r.link.includes('####') || r.link.includes('${')) {
        rejected.push({ name: r.name, reason: 'generic/template link' }); continue;
      }
      if (r.link.includes('chicago') || r.link.includes('miami') || r.link.includes('los-angeles')) {
        rejected.push({ name: r.name, reason: 'wrong city in URL' }); continue;
      }
      let otUrl = 'https://www.' + r.link.split('?')[0].split('#')[0];
      verified.push({ name: r.name, platform: 'opentable', url: otUrl });
      console.log('✅ ' + r.name + ' → OT: ' + otUrl.substring(0, 60));

    } else if (r.platform === 'tock') {
      if (r.link === 'exploretock.com/tock.js') { rejected.push({ name: r.name, reason: 'just tock.js script' }); continue; }
      let tockUrl = 'https://www.' + r.link.split('?')[0];
      verified.push({ name: r.name, platform: 'tock', url: tockUrl });
      console.log('✅ ' + r.name + ' → Tock: ' + tockUrl);
    }
  }

  fs.writeFileSync(VERIFIED_FILE, JSON.stringify(verified, null, 2));
  fs.writeFileSync(REJECTED_FILE, JSON.stringify(rejected, null, 2));

  console.log('\n=== RESULTS ===');
  console.log('Verified:', verified.length);
  console.log('Rejected:', rejected.length);
  console.log('\nRejected:');
  rejected.forEach(r => console.log('  ❌ ' + r.name + ' — ' + r.reason + (r.resyName ? ' (matched: ' + r.resyName + ')' : '')));
}

main().catch(e => { console.error(e); process.exit(1); });
