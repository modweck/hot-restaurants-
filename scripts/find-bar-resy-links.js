const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const BARS_PATH = path.join(__dirname, '..', 'netlify', 'functions', 'BARS_MERGED_V15.json');
const KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';

const bars = JSON.parse(fs.readFileSync(BARS_PATH, 'utf8'));
const noResy = bars.filter(b => !b.resy_url);

console.log(`Total bars: ${bars.length}`);
console.log(`Already have Resy: ${bars.length - noResy.length}`);
console.log(`Checking: ${noResy.length}\n`);

let found = 0, checked = 0;

for (const b of noResy) {
  const slug = b.name.toLowerCase()
    .replace(/[''""]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  for (const loc of ['new-york-ny']) {
    try {
      const cmd = `curl -s 'https://api.resy.com/3/venue?url_slug=${slug}&location=${loc}' -H 'Authorization: ResyAPI api_key="${KEY}"' -H 'Origin: https://resy.com'`;
      const result = execSync(cmd, { encoding: 'utf8', timeout: 8000 });
      const d = JSON.parse(result);

      if (d.name && !d.status && !d.error) {
        const idx = bars.indexOf(b);
        bars[idx].resy_url = `https://resy.com/cities/${loc}/venues/${d.url_slug || slug}`;
        found++;
        console.log(`  ✅ ${b.name} → ${d.name} (${d.url_slug || slug})`);
        break;
      }
    } catch {}
  }

  checked++;
  if (checked % 200 === 0) {
    console.log(`  [${checked}/${noResy.length}] found: ${found}`);
    fs.writeFileSync(BARS_PATH, JSON.stringify(bars, null, 2));
  }
}

fs.writeFileSync(BARS_PATH, JSON.stringify(bars, null, 2));
console.log(`\nChecked: ${checked} | Found: ${found}`);
console.log(`Total with Resy now: ${bars.filter(b => b.resy_url).length}`);
