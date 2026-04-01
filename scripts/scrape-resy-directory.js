const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const OUTPUT = path.join(__dirname, '..', 'data', 'resy_nyc_directory.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Resy collections and filter URLs
const SEARCHES = [
  // Collections
  { label: 'NYC Hot', url: 'https://resy.com/cities/new-york-ny' },
  { label: 'New Restaurants', url: 'https://resy.com/cities/new-york-ny/collections/new-restaurant-openings-nyc' },
  { label: 'Outdoor', url: 'https://resy.com/cities/new-york-ny/collections/best-outdoor-dining-nyc' },
  { label: 'Date Night', url: 'https://resy.com/cities/new-york-ny/collections/best-date-night-restaurants-nyc' },
  { label: 'Omakase', url: 'https://resy.com/cities/new-york-ny/collections/new-yorks-essential-omakase-spots' },
  { label: 'Michelin', url: 'https://resy.com/cities/new-york-ny/collections/new-yorks-2024-michelin-winners' },
  { label: 'Splurge', url: 'https://resy.com/cities/new-york-ny/collections/splurge-worthy-dining-in-new-york' },
  { label: 'Critically Acclaimed', url: 'https://resy.com/cities/new-york-ny/collections/the-award-winning-restaurants-of-new-york' },
  { label: 'Cocktail Bars', url: 'https://resy.com/cities/new-york-ny/collections/new-yorks-best-cocktail-bars' },
  { label: 'Brunch', url: 'https://resy.com/cities/new-york-ny/collections/brunch-restaurants-in-new-york' },
  { label: 'Happy Hour', url: 'https://resy.com/cities/new-york-ny/collections/happy-hour-restaurants-in-new-york' },
  { label: 'Late Night', url: 'https://resy.com/cities/new-york-ny/collections/late-night-restaurants-nyc' },
  { label: 'Group Dining', url: 'https://resy.com/cities/new-york-ny/collections/best-restaurants-for-groups-in-new-york' },
  { label: 'Cheap Eats', url: 'https://resy.com/cities/new-york-ny/collections/affordable-restaurants-in-new-york' },
  { label: 'Italian', url: 'https://resy.com/cities/new-york-ny/collections/best-italian-restaurants-in-new-york' },
  { label: 'Japanese', url: 'https://resy.com/cities/new-york-ny/collections/best-japanese-restaurants-in-new-york' },
  { label: 'Chinese', url: 'https://resy.com/cities/new-york-ny/collections/best-chinese-restaurants-in-new-york' },
  { label: 'Mexican', url: 'https://resy.com/cities/new-york-ny/collections/best-mexican-restaurants-in-new-york' },
  { label: 'French', url: 'https://resy.com/cities/new-york-ny/collections/best-french-restaurants-in-new-york' },
  { label: 'Thai', url: 'https://resy.com/cities/new-york-ny/collections/best-thai-restaurants-in-new-york' },
  { label: 'Indian', url: 'https://resy.com/cities/new-york-ny/collections/best-indian-restaurants-in-new-york' },
  { label: 'Korean', url: 'https://resy.com/cities/new-york-ny/collections/best-korean-restaurants-in-new-york' },
  { label: 'Steakhouse', url: 'https://resy.com/cities/new-york-ny/collections/best-steakhouses-in-new-york' },
  { label: 'Seafood', url: 'https://resy.com/cities/new-york-ny/collections/best-seafood-restaurants-in-new-york' },
  { label: 'Pizza', url: 'https://resy.com/cities/new-york-ny/collections/best-pizza-restaurants-in-new-york' },
];

async function scrapeResyPage(page) {
  // Scroll aggressively to load all content
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await sleep(400);
  }
  await sleep(1000);

  return page.evaluate(() => {
    const results = [];
    const seen = new Set();

    // Find all venue links
    const allLinks = document.querySelectorAll('a[href*="/venues/"]');
    for (const a of allLinks) {
      const match = a.href.match(/\/venues\/([^/?#]+)/);
      if (!match) continue;
      const slug = match[1];
      if (seen.has(slug)) continue;
      seen.add(slug);

      // Get name — try parent card elements
      let name = '';
      const card = a.closest('article, [class*="VenueCard"], [class*="venue-card"], [class*="Card"]');
      if (card) {
        const nameEl = card.querySelector('h2, h3, h1, [class*="VenueName"], [class*="venue-name"]');
        name = nameEl ? nameEl.textContent.trim() : '';
      }
      if (!name) name = a.textContent.trim();
      if (!name || name.length > 100 || name.length < 2) continue;

      // Skip nav/UI elements
      if (name.includes('Skip') || name.includes('Log in') || name.includes('Sign up')) continue;

      results.push({
        name,
        slug,
        url: 'https://resy.com/cities/new-york-ny/venues/' + slug,
      });
    }
    return results;
  });
}

async function main() {
  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(OUTPUT, 'utf8')); } catch {}
  const seenSlugs = new Set(existing.map(r => r.slug).filter(Boolean));
  const seenNames = new Set(existing.map(r => (r.name || '').toLowerCase()));
  console.log('Starting with ' + existing.length + ' existing\n');

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });

  let totalNew = 0;

  for (const search of SEARCHES) {
    try {
      await page.goto(search.url, { waitUntil: 'networkidle2', timeout: 25000 });
      const restaurants = await scrapeResyPage(page);

      let newCount = 0;
      for (const r of restaurants) {
        if (seenSlugs.has(r.slug) || seenNames.has(r.name.toLowerCase())) continue;
        seenSlugs.add(r.slug);
        seenNames.add(r.name.toLowerCase());
        existing.push(r);
        newCount++;
        totalNew++;
      }

      console.log(search.label + ': ' + restaurants.length + ' found, ' + newCount + ' new (total new: ' + totalNew + ')');
      fs.writeFileSync(OUTPUT, JSON.stringify(existing, null, 2));
    } catch (e) {
      console.log(search.label + ': error — ' + e.message.substring(0, 50));
    }

    await sleep(3000);
  }

  await browser.close();
  console.log('\nDone! Total: ' + existing.length + ' | New: ' + totalNew);
}

main().catch(e => { console.error(e); process.exit(1); });
