const fs = require('fs');
const path = require('path');

const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const GOOGLE_KEY = 'AIzaSyDrtbSIA_BvJIzq1_-3pfQ_RgP2DiM_TKo';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function findPlace(name) {
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(name + ' restaurant New York')}&inputtype=textquery&fields=place_id,name,business_status&key=${GOOGLE_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.candidates || data.candidates.length === 0) return null;
  return data.candidates[0];
}

async function getDetails(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,rating,user_ratings_total,formatted_address,geometry,website,price_level,business_status&key=${GOOGLE_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.result || null;
}

async function main() {
  const master = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));

  const missing = Object.entries(master).filter(([_, v]) => !v.google_rating || !v.google_reviews);
  console.log('Enriching ' + missing.length + ' restaurants with Google data\n');

  let enriched = 0, notFound = 0, closed = 0, errors = 0, skippedFind = 0;

  for (let i = 0; i < missing.length; i++) {
    const [name, info] = missing[i];

    try {
      // If we already have a cached place_id, skip the FindPlace call (saves 1 API call)
      let placeId = info.place_id || null;
      if (!placeId) {
        const place = await findPlace(name);
        if (!place) { notFound++; continue; }
        if (place.business_status === 'CLOSED_PERMANENTLY') { closed++; console.log('💀 [' + (i+1) + '] ' + name); continue; }
        placeId = place.place_id;
      } else {
        skippedFind++;
      }

      const details = await getDetails(placeId);
      if (!details) { notFound++; continue; }
      if (details.business_status === 'CLOSED_PERMANENTLY') { closed++; console.log('💀 [' + (i+1) + '] ' + name); continue; }

      master[name].google_rating = details.rating || null;
      master[name].google_reviews = details.user_ratings_total || 0;
      if (!master[name].place_id) master[name].place_id = placeId;
      if (!master[name].address && details.formatted_address) master[name].address = details.formatted_address;
      if (!master[name].lat && details.geometry?.location) {
        master[name].lat = details.geometry.location.lat;
        master[name].lng = details.geometry.location.lng;
      }
      if (!master[name].website && details.website) master[name].website = details.website;
      if (!master[name].price && details.price_level) master[name].price = details.price_level;

      enriched++;
      if (enriched % 50 === 0) {
        console.log('   ... ' + (i+1) + '/' + missing.length + ' | enriched: ' + enriched);
        fs.writeFileSync(MASTER_FILE, JSON.stringify(master, null, 2));
      }
    } catch (e) {
      errors++;
    }

    await sleep(100);
  }

  fs.writeFileSync(MASTER_FILE, JSON.stringify(master, null, 2));
  console.log('\nDone! Enriched: ' + enriched + ' | Not found: ' + notFound + ' | Closed: ' + closed + ' | Errors: ' + errors);
}

main().catch(e => { console.error(e); process.exit(1); });
