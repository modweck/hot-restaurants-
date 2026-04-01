const fs = require('fs');
const path = require('path');

const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'website_booking_links_found.json');

const master = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
const websites = Object.entries(master).filter(([_, v]) => v.platform === 'website' && v.url && v.url.startsWith('http'));

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('Scanning ' + websites.length + ' website restaurants for booking links...\n');

  let found = 0, checked = 0, errors = 0;
  const results = [];

  for (const [name, info] of websites) {
    checked++;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(info.url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        redirect: 'follow'
      });
      clearTimeout(timeout);

      const html = await res.text();

      const resyMatch = html.match(/resy\.com\/cities\/[^"'\s>]+/i);
      const otMatch = html.match(/opentable\.com\/r[^"'\s>]*/i);
      const tockMatch = html.match(/exploretock\.com\/[^"'\s>]+/i);

      if (resyMatch || otMatch || tockMatch) {
        found++;
        const platform = resyMatch ? 'resy' : otMatch ? 'opentable' : 'tock';
        const rawLink = resyMatch ? resyMatch[0] : otMatch ? otMatch[0] : tockMatch[0];
        const link = rawLink.replace(/["'>].*/g, '');
        results.push({ name, platform, link });
        console.log('✅ [' + checked + '] ' + name + ' → ' + platform + ': ' + link.substring(0, 70));
      }
    } catch (e) {
      errors++;
    }

    if (checked % 100 === 0) {
      console.log('   ... ' + checked + '/' + websites.length + ' | found: ' + found + ' | errors: ' + errors);
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    }

    await sleep(500);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log('\nDone! Checked: ' + checked + ' | Found booking links: ' + found + ' | Errors: ' + errors);
  console.log('Saved to ' + OUTPUT_FILE);
}

main().catch(e => { console.error(e); process.exit(1); });
