const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const NAMES = ["bamboo walk caribbean restaurant", "nino's 46", "sushi by scratch restaurants", "what the fish", "ainslie", "alwaha restaurant", "puerto plata restaurant", "sayori", "shanghai chinese restaurant", "the little one", "harlem breakfast club", "sally's caribbean restaurant", "sauced up", "castell's", "pavin86", "sips", "bombay's", "bread & butter", "la mela", "p.f. chang's", "bite", "la fusta", "the evergreen", "café d'anvers", "drift restaurant and bar", "patiala indian grill & bar", "pico de gallo bar & kitchen", "route bar restaurant", "yuca bar & restaurant", "gu japanese fusion sushi & bar", "west end bar & grill", "knickerbocker bar & grill", "bar san miguel carroll gardens", "numero 28 pizzeria - west village", "palladino's steak & seafood", "golden dragon restaurant", "puerta del sol", "taste of italy", "eatzy thai", "cô lạc", "l'angeletto", "il carino restaurant", "crane club restaurant", "giano", "white oak tavern", "ploume", "cheeseboat - williamsburg", "love and dough", "the brooklyn deli - times square", "cibar lounge", "morton's the steakhouse - midtown manhattan", "joe & pat\u2019s nyc", "golden steer steakhouse nyc", "pappas - new york", "the argyle", "elea", "estiatorio milos \u2013 midtown new york", "quality italian - new york", "carnegie diner & café \u2013 205 w 57th st, new york, ny", "kings of kobe - wagyu kitchen & bar", "serafina broadway", "carnegie diner & café \u2013 1185 6th ave, new york ny", "blue fin - new york", "pig n whistle - rockefeller center", "the elgin", "toloache - upper east side", "island", "oda house - upper east side", "zoi mediterranean ues", "serafina upper west", "bustan", "the consulate upper west side", "5 napkin burger - upper west side", "playa betty's", "gazala\u2019s", "saperavi uws", "native harlem", "community food & juice", "l' artista", "vida nyc", "bar contra", "piccola cucina osteria - spring st.", "kabin", "the paris cafe", "friedman's - 72nd st", "broadway lounge", "mapo asian restaurant & bar", "gyu-kaku japanese bbq - new york, ny | times square manhattan", "jams - nyc", "palermo argentinian bistro nyc", "russian tea room - nyc", "the parisian tea room- nyc", "rosa mexicano - second avenue", "atlantic grill at lincoln center", "arco cafe", "azara kitchen", "ikyu", "saperavi ues", "silver lining lounge", "dough by licastri silver lake", "lumen dining & rooftop", "the corner chinese", "the ivy room", "glass ceiling rooftop", "tiny tapas and bites", "chef papa vietnamese kitchen lic", "rosemary's midtown", "ocean prime - new york", "match 65 brasserie (formerly paris match)", "brasserie cognac central park south", "empellon midtown", "vida verde", "mr chow - 57th", "shun lee west", "chalong southern thai", "zaab zaab - queens", "spice symphony \u2013 50th st.", "musaafer - new york", "smith & wollensky - new york", "a la turka restaurant", "sammy's smokehouse bbq & grill", "sultan mediterranean cuisine nyc", "celon bar and lounge", "fogo de chão - new york", "empire burger house", "corrado's cucina", "holiday cocktail lounge", "warique - williamsburg", "creatures rooftop", "private room", "savvy bistro & bar", "da raffaele - nyc", "tony's di napoli - upper east side", "bocca di bacco (theatre district - 45th st.)", "haven rooftop", "gyu-kaku japanese bbq - new york, ny | midtown manhattan", "roberta's - bushwick", "serafina long island city", "shun lee cafe", "moonstone modern asian cuisine & bar", "kid pizza", "the east pole - kitchen and bar", "5 acres", "fernando's hideaway", "the dickens", "bonsaii tapas & wine bar", "interlude rooftop lounge", "langan's", "haswell green's", "westland roe", "jasper's tap house", "the rabbit hole astoria", "richmond republic", "the smith- lincoln square", "the fleur room nyc", "ophelia", "grand salon & bar at baccarat hotel new york", "sushi by bou - jersey city nj @ ani ramen", "red lobster - brooklyn", "red lobster - bronx", "majorelle at the lowell", "refinery rooftop", "sally's waterfront dining", "platform by the james beard foundation", "cheeseboat - hell's kitchen", "russian samovar & tolstoy's lounge", "kween", "sol de colombia", "porteno restaurant", "la gran uruguaya restaurant", "john's pizzeria", "violette's restaurant", "mythos authentic greek cuisine", "don rique", "cafe luxembourg", "carnegie diner & cafe, 711 7th avenue", "bar goyana", "dolly varden", "mission ceviche"];

const DATE = '2026-04-12';
const PARTY_SIZE = 2;
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'ot-review', 'ot_puppeteer_179.json');
const PROGRESS_PATH = path.join(__dirname, '..', 'data', 'ot-review', 'ot_puppeteer_179_progress.json');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const randomDelay = (min, max) => sleep(min + Math.random() * (max - min));

function nameToSlug(name) {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[&]/g, 'and')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function nameToSlugs(name) {
  const base = nameToSlug(name);
  const cleaned = name
    .replace(/\s*[-–—]\s*(new york|nyc|ny|brooklyn|queens|manhattan|midtown|upper east side|upper west side|hell's kitchen|times square|williamsburg|bushwick|astoria|jersey city|long island city|bronx|midtown manhattan|theatre district.*|formerly.*|45th st.*|spring st.*|72nd st.*|50th st.*)$/i, '')
    .replace(/\s*\(.*?\)/g, '')
    .replace(/\s*[|,].*$/, '')
    .trim();
  const short = nameToSlug(cleaned);

  const slugs = new Set();
  slugs.add(base + '-new-york');
  slugs.add(base);
  if (short !== base) {
    slugs.add(short + '-new-york');
    slugs.add(short);
  }
  slugs.add(short + '-brooklyn');
  slugs.add(short + '-queens');
  return [...slugs];
}

(async () => {
  const results = {};

  if (fs.existsSync(PROGRESS_PATH)) {
    const prev = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
    Object.assign(results, prev);
    console.log(`Resuming from ${Object.keys(prev).length} previously checked`);
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1440,900',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36');

  let found = 0, notFound = 0, errors = 0;

  for (let i = 0; i < NAMES.length; i++) {
    const name = NAMES[i];

    if (results[name]) {
      if (results[name].rid) found++;
      else notFound++;
      continue;
    }

    // Pause every 20 to avoid detection
    if (i > 0 && i % 20 === 0) {
      console.log(`⏸️  Pausing 60s at ${i}/${NAMES.length}`);
      await sleep(60000);
    }

    const slugs = nameToSlugs(name);
    let foundRid = null;
    let matchedSlug = null;

    for (const slug of slugs) {
      try {
        const url = `https://www.opentable.com/r/${slug}`;
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

        if (response.status() === 404) continue;
        if (response.status() !== 200) continue;

        await randomDelay(1000, 2000);

        const rid = await page.evaluate(() => {
          const html = document.documentElement.innerHTML;
          if (html.length < 5000) return null;

          const patterns = [/"rid"\s*:\s*(\d+)/g, /"restaurantId"\s*:\s*(\d+)/g];
          for (const pat of patterns) {
            let m;
            while ((m = pat.exec(html)) !== null) {
              const v = parseInt(m[1]);
              if (v > 0) return v;
            }
          }
          return null;
        });

        if (rid) {
          foundRid = rid;
          matchedSlug = slug;
          break;
        }
      } catch (e) {
        // timeout or navigation error, try next slug
      }
      await randomDelay(2000, 4000);
    }

    if (foundRid) {
      results[name] = { rid: foundRid, slug: matchedSlug, checked_date: DATE, source: 'puppeteer' };
      found++;
      console.log(`[${i + 1}/${NAMES.length}] ✓ ${name} → ${foundRid} (${matchedSlug})`);
    } else {
      results[name] = { rid: null, not_found: true, slugs_tried: slugs, checked_date: DATE, source: 'puppeteer' };
      notFound++;
      console.log(`[${i + 1}/${NAMES.length}] ✗ ${name} (tried ${slugs.length} slugs)`);
    }

    if ((i + 1) % 10 === 0) {
      fs.writeFileSync(PROGRESS_PATH, JSON.stringify(results, null, 2));
      console.log(`  💾 Progress saved (${found} found, ${notFound} not found)`);
    }

    await randomDelay(5000, 10000);
  }

  await browser.close();

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
  console.log(`\n[Done] ✓${found} ✗${notFound} ⚠️${errors}`);
  console.log(`Results saved to ${OUTPUT_PATH}`);
})();
