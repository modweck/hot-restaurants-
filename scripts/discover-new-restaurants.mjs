/**
 * discover-new-restaurants.mjs
 *
 * Scrapes Eater NYC, NYT Dining, and GrubStreet RSS feeds for new restaurant
 * mentions. Cross-checks against BOOKING_MASTER to find ones we don't have.
 * Then enriches with Google Places data (rating, reviews, coords).
 *
 * RUN:   node scripts/discover-new-restaurants.mjs
 * FLAGS: --skip-enrich   Skip Google Places enrichment
 *        --add           Auto-add qualifying restaurants to BOOKING_MASTER
 *
 * COST: ~$0.01-0.05 per run (few Google Places lookups for new finds only)
 * CAN RUN: Daily — very lightweight
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BM_PATH = resolve(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const DISCOVERIES_PATH = resolve(__dirname, '..', 'data', 'press_discoveries.json');

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY || 'AIzaSyCWop5FPwG4DtTXP5M3B3M8vrAQFctQJoY';
const SKIP_ENRICH = process.argv.includes('--skip-enrich');
const AUTO_ADD = process.argv.includes('--add');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeName(name) {
  return name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`]/g, '').replace(/&/g, 'and')
    .replace(/[-–—]/g, ' ').replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

// ── RSS Feed Parsing ────────────────────────────────────────────────────────
function parseAtomFeed(xml) {
  const entries = [];
  const entryMatches = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
  for (const entry of entryMatches) {
    const title = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() || '';
    const link = entry.match(/<link[^>]*href="([^"]+)"/)?.[1] || '';
    const published = entry.match(/<published>([^<]+)/)?.[1] || entry.match(/<updated>([^<]+)/)?.[1] || '';
    const summary = entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1]?.replace(/<[^>]+>/g, '').trim() || '';
    const content = entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1]?.replace(/<[^>]+>/g, '').trim() || '';
    entries.push({ title, link, published, summary, content: content || summary });
  }
  return entries;
}

function parseRssFeed(xml) {
  const entries = [];
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  for (const item of items) {
    const title = item.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() || '';
    const link = item.match(/<link[^>]*>([\s\S]*?)<\/link>/)?.[1]?.trim() || item.match(/<link>([^<]+)/)?.[1]?.trim() || '';
    const published = item.match(/<pubDate>([^<]+)/)?.[1] || '';
    const desc = item.match(/<description[^>]*>([\s\S]*?)<\/description>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim() || '';
    entries.push({ title, link, published, summary: desc, content: desc });
  }
  return entries;
}

// ── Extract restaurant names from article text ──────────────────────────────
function extractRestaurantNames(text, title) {
  const names = new Set();

  // Common patterns in food articles:
  // "Restaurant Name, located at..." / "Restaurant Name (123 Main St)" / "...at Restaurant Name"
  // "Restaurant Name is now open" / "Restaurant Name has opened" / "the new Restaurant Name"

  // Pattern 1: Capitalized phrases that look like restaurant names (2-4 words, title case)
  const titleCase = text.match(/(?:at |from |visit |try |called |named |opens?: |opened |opening )((?:[A-Z][a-z''\-]+\s*){1,5})/g) || [];
  for (const m of titleCase) {
    const name = m.replace(/^(?:at |from |visit |try |called |named |opens?: |opened |opening )/, '').trim();
    if (name.length >= 3 && name.length <= 50 && !name.match(/^(The New|New York|East Village|West Village|Lower East|Upper)/)) {
      names.add(name);
    }
  }

  // Pattern 2: Bold/strong text often contains restaurant names in articles
  const bolds = text.match(/\*\*([^*]+)\*\*/g) || [];
  for (const b of bolds) {
    const name = b.replace(/\*\*/g, '').trim();
    if (name.length >= 3 && name.length <= 40) names.add(name);
  }

  // Pattern 3: Title often contains the restaurant name directly
  // "Restaurant Name Is the Hottest New Spot" / "Inside Restaurant Name"
  const titleName = title
    .replace(/^(Where to Eat|Best New|NYC's|New York's|Inside|Review:?\s*)/i, '')
    .replace(/\s*(Is|Has|Opens|Now|Will|The Best|in NYC|in New York|Restaurant|Review).*/i, '')
    .trim();
  if (titleName.length >= 3 && titleName.length <= 50) {
    names.add(titleName);
  }

  return [...names];
}

// ── Fetch feeds ─────────────────────────────────────────────────────────────
async function fetchFeeds() {
  const feeds = [
    { name: 'Eater NYC', url: 'https://ny.eater.com/rss/index.xml', type: 'atom', source: 'Eater' },
    { name: 'Eater Openings', url: 'https://ny.eater.com/rss/restaurant-openings/index.xml', type: 'atom', source: 'Eater' },
    { name: 'Eater Openings Alt', url: 'https://ny.eater.com/rss/openings/index.xml', type: 'atom', source: 'Eater' },
    { name: 'NYT Food', url: 'https://rss.nytimes.com/services/xml/rss/nyt/DiningandWine.xml', type: 'rss', source: 'NYT' },
    { name: 'GrubStreet', url: 'https://feeds.feedburner.com/GrubStreet', type: 'rss', source: 'GrubStreet' },
  ];

  const allArticles = [];

  for (const feed of feeds) {
    try {
      const resp = await fetch(feed.url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) { console.log(`  ❌ ${feed.name}: HTTP ${resp.status}`); continue; }
      const xml = await resp.text();

      const entries = feed.type === 'atom' ? parseAtomFeed(xml) : parseRssFeed(xml);

      // Filter to articles about restaurants/food/openings
      const relevant = entries.filter(e => {
        const t = (e.title + ' ' + e.summary).toLowerCase();
        return t.includes('restaurant') || t.includes('open') || t.includes('dining') ||
               t.includes('eat') || t.includes('chef') || t.includes('menu') ||
               t.includes('reservation') || t.includes('brunch') || t.includes('dinner') ||
               t.includes('kitchen') || t.includes('bistro') || t.includes('trattoria');
      });

      console.log(`  ✅ ${feed.name}: ${entries.length} articles, ${relevant.length} food-related`);

      for (const entry of relevant) {
        allArticles.push({ ...entry, source: feed.source });
      }
    } catch (e) {
      console.log(`  ❌ ${feed.name}: ${e.message?.slice(0, 50)}`);
    }
  }

  return allArticles;
}

// ── Scrape Eater "new openings" page directly ───────────────────────────────
async function scrapeEaterOpenings() {
  const names = [];
  try {
    // Eater's "Where to Eat" / "New Restaurants" page
    const urls = [
      'https://ny.eater.com/maps/best-new-restaurants-nyc',
      'https://ny.eater.com/maps/nyc-restaurant-openings',
    ];

    for (const url of urls) {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) continue;
      const html = await resp.text();

      // Extract restaurant names from Eater list pages
      // They typically use h2/h3 tags with restaurant names
      const headingMatches = html.match(/<h[23][^>]*>([^<]+)<\/h[23]>/gi) || [];
      for (const h of headingMatches) {
        const name = h.replace(/<[^>]+>/g, '').trim();
        if (name.length >= 3 && name.length <= 50 && !name.match(/^(The |Where|Best|New|NYC|Eater|Map|Related)/i)) {
          names.push({ name, source: 'Eater' });
        }
      }

      // Also look for data-venue-name or similar attributes
      const venueMatches = html.match(/data-(?:venue|restaurant)-name="([^"]+)"/gi) || [];
      for (const v of venueMatches) {
        const name = v.match(/"([^"]+)"/)?.[1];
        if (name) names.push({ name, source: 'Eater' });
      }
    }

    console.log(`  ✅ Eater openings pages: ${names.length} restaurant names`);
  } catch (e) {
    console.log(`  ❌ Eater openings: ${e.message?.slice(0, 50)}`);
  }
  return names;
}

// ── Google Places enrichment ────────────────────────────────────────────────
async function enrichWithGoogle(name) {
  try {
    const searchUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(name + ' restaurant NYC')}&inputtype=textquery&fields=place_id,name,formatted_address&key=${GOOGLE_API_KEY}`;
    const searchResp = await fetch(searchUrl);
    const searchData = await searchResp.json();

    if (!searchData.candidates?.length) return null;
    const placeId = searchData.candidates[0].place_id;

    const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,rating,user_ratings_total,geometry,types,website,price_level&key=${GOOGLE_API_KEY}`;
    const detailResp = await fetch(detailUrl);
    const { result: r } = await detailResp.json();
    if (!r) return null;

    // Must be a food establishment
    const foodTypes = ['restaurant', 'food', 'meal_delivery', 'meal_takeaway', 'cafe', 'bakery', 'bar'];
    if (!r.types?.some(t => foodTypes.includes(t))) return null;

    return {
      place_id: placeId,
      google_name: r.name,
      google_rating: r.rating || 0,
      google_reviews: r.user_ratings_total || 0,
      lat: r.geometry?.location?.lat,
      lng: r.geometry?.location?.lng,
      website: r.website || null,
      price_level: r.price_level || null,
    };
  } catch { return null; }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  🔍 NEW RESTAURANT DISCOVERY — Press Feeds`);
  console.log(`${'═'.repeat(50)}\n`);

  // Load BOOKING_MASTER
  const bm = JSON.parse(readFileSync(BM_PATH, 'utf8'));
  const bmNorms = new Set(Object.keys(bm).map(k => normalizeName(k)));
  console.log(`📗 BOOKING_MASTER: ${Object.keys(bm).length} restaurants\n`);

  // Load previous discoveries
  let previous = [];
  if (existsSync(DISCOVERIES_PATH)) {
    previous = JSON.parse(readFileSync(DISCOVERIES_PATH, 'utf8'));
  }
  const prevNorms = new Set(previous.map(d => normalizeName(d.name)));

  // Step 1: Fetch RSS feeds
  console.log('📡 Fetching RSS feeds...');
  const articles = await fetchFeeds();
  console.log(`   ${articles.length} food-related articles\n`);

  // Step 2: Scrape Eater openings pages
  console.log('🌐 Scraping Eater openings pages...');
  const eaterNames = await scrapeEaterOpenings();

  // Step 3: Extract restaurant names from articles
  console.log('\n🔍 Extracting restaurant names from articles...');
  const allMentions = new Map(); // name → { sources, articles }

  for (const article of articles) {
    const names = extractRestaurantNames(article.content || article.summary, article.title);
    // Also add the title itself as a potential restaurant name
    for (const name of names) {
      const norm = normalizeName(name);
      if (norm.length < 3) continue;
      if (!allMentions.has(norm)) {
        allMentions.set(norm, { name, sources: new Set(), articles: [] });
      }
      allMentions.get(norm).sources.add(article.source);
      allMentions.get(norm).articles.push(article.title.slice(0, 60));
    }
  }

  // Add Eater page scrapes
  for (const { name, source } of eaterNames) {
    const norm = normalizeName(name);
    if (norm.length < 3) continue;
    if (!allMentions.has(norm)) {
      allMentions.set(norm, { name, sources: new Set(), articles: [] });
    }
    allMentions.get(norm).sources.add(source);
  }

  console.log(`   ${allMentions.size} unique restaurant names mentioned\n`);

  // Step 4: Cross-check against BOOKING_MASTER
  const newFinds = [];
  let alreadyInBM = 0;
  let alreadyDiscovered = 0;

  for (const [norm, data] of allMentions) {
    if (bmNorms.has(norm)) { alreadyInBM++; continue; }
    if (prevNorms.has(norm)) { alreadyDiscovered++; continue; }
    newFinds.push({
      name: data.name,
      sources: [...data.sources],
      articleCount: data.articles.length,
      articles: data.articles.slice(0, 3),
    });
  }

  console.log(`📊 Results:`);
  console.log(`   Already in BOOKING_MASTER: ${alreadyInBM}`);
  console.log(`   Already discovered before: ${alreadyDiscovered}`);
  console.log(`   ✨ New finds: ${newFinds.length}\n`);

  if (newFinds.length === 0) {
    console.log('💤 No new restaurants found this run.\n');
    return;
  }

  // Step 5: Enrich with Google Places
  if (!SKIP_ENRICH) {
    console.log('🔍 Enriching with Google Places...');
    for (let i = 0; i < newFinds.length; i++) {
      const find = newFinds[i];
      process.stdout.write(`  [${i + 1}/${newFinds.length}] ${find.name.slice(0, 35).padEnd(35)} `);

      const google = await enrichWithGoogle(find.name);
      if (google) {
        find.google = google;
        console.log(`✅ ${google.google_rating}★ ${google.google_reviews} reviews`);
      } else {
        console.log(`❌ not found on Google`);
      }

      await sleep(300);
    }
    console.log();
  }

  // Step 6: Filter to qualifying restaurants
  const qualifying = newFinds.filter(f => {
    if (!f.google) return true; // keep non-enriched ones for manual review
    return f.google.google_rating >= 4.0 && f.google.google_reviews <= 200;
  });

  // Sort: multi-source mentions first, then by rating
  qualifying.sort((a, b) => {
    if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
    return (b.google?.google_rating || 0) - (a.google?.google_rating || 0);
  });

  // Step 7: Save discoveries
  const newDiscoveries = qualifying.map(f => ({
    name: f.name,
    sources: f.sources,
    discovered_at: new Date().toISOString(),
    ...(f.google || {}),
  }));

  const merged = [...previous, ...newDiscoveries];
  writeFileSync(DISCOVERIES_PATH, JSON.stringify(merged, null, 2));

  // Step 8: Auto-add to BOOKING_MASTER if --add flag
  let addedToBM = 0;
  if (AUTO_ADD) {
    for (const d of newDiscoveries) {
      if (!d.place_id || !d.lat) continue;
      const key = d.name.toLowerCase().trim();
      if (bm[key]) continue;

      bm[key] = {
        platform: '',
        url: '',
        lat: d.lat,
        lng: d.lng,
        google_rating: d.google_rating,
        google_reviews: d.google_reviews,
        place_id: d.place_id,
        website: d.website || '',
        cuisine: '',
        buzz_sources: d.sources,
        new_rising: true,
      };
      addedToBM++;
    }

    if (addedToBM > 0) {
      writeFileSync(BM_PATH, JSON.stringify(bm, null, 2));
      console.log(`📗 Added ${addedToBM} new restaurants to BOOKING_MASTER`);
    }
  }

  // Print results
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✨ NEW RESTAURANT DISCOVERIES (${qualifying.length})`);
  console.log(`${'═'.repeat(50)}`);
  for (const f of qualifying.slice(0, 25)) {
    const g = f.google;
    const rating = g ? `${g.google_rating}★ ${g.google_reviews} reviews` : 'no Google data';
    console.log(`  ${f.name} [${f.sources.join(', ')}] — ${rating}`);
  }
  if (qualifying.length > 25) console.log(`  ... and ${qualifying.length - 25} more`);

  console.log(`\n💾 Saved ${newDiscoveries.length} discoveries to ${DISCOVERIES_PATH}`);
  if (AUTO_ADD) console.log(`📗 Added ${addedToBM} to BOOKING_MASTER`);
  console.log(`\nRun with --add to auto-add qualifying restaurants to BOOKING_MASTER\n`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
