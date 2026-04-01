#!/usr/bin/env node
/**
 * find-ot-from-websites.mjs
 *
 * Finds OpenTable links for restaurants that currently only have a website.
 *
 * STRATEGY:
 *   Phase 1 — Puppeteer website scraping for OT links (finds embedded booking widgets)
 *   Phase 2 — GraphQL autocomplete search (backup for sites without embedded links)
 *   Phase 3 — Validate ALL found links: curl check + fetch OT page + name match
 *
 * RUN:
 *   node scripts/find-ot-from-websites.mjs
 *   node scripts/find-ot-from-websites.mjs --quick        # first 30 only
 *   node scripts/find-ot-from-websites.mjs --limit 100    # first 100
 *   node scripts/find-ot-from-websites.mjs --resume       # skip already-checked
 *   node scripts/find-ot-from-websites.mjs --skip-puppeteer  # GraphQL only
 *
 * OUTPUT: data/ot_from_websites.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Config ──
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const QUICK = args.includes('--quick');
const LIMIT = QUICK ? 30 : parseInt(getArg('limit', '9999'), 10);
const RESUME = args.includes('--resume');
const SKIP_PUPPETEER = args.includes('--skip-puppeteer');

const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'ot_from_websites.json');

const MASTER = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));

// Load previous results if resuming
let previous = { found: [], notFound: [], errors: [] };
if (RESUME) {
  try {
    previous = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    console.log(`📂 Loaded ${previous.found?.length || 0} previous finds, ${previous.notFound?.length || 0} not-found`);
  } catch (e) { /* first run */ }
}
const previousNames = new Set([
  ...(previous.found || []).map(r => r.name),
  ...(previous.notFound || []),
  ...(previous.errors || [])
]);

// ── Build candidate list: website-only restaurants ──
const candidates = [];
for (const [name, entry] of Object.entries(MASTER)) {
  if (entry.platform !== 'website') continue;
  if (RESUME && previousNames.has(name)) continue;
  candidates.push({ name, website: entry.website || null, lat: entry.lat, lng: entry.lng });
}

const toProcess = candidates.slice(0, LIMIT);

console.log(`\n🔍 OT Link Finder from Websites`);
console.log(`${'═'.repeat(50)}`);
console.log(`📊 Website-only restaurants: ${candidates.length}`);
console.log(`🎯 Processing: ${toProcess.length}${QUICK ? ' (quick mode)' : ''}`);
if (RESUME) console.log(`⏭️  Skipping ${previousNames.size} already checked`);
console.log();

// ── Helpers ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normName(s) {
  return s.toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`'.!?,;:\-–—()\[\]{}\"]/g, '')
    .replace(/&/g, 'and')
    .replace(/\s+/g, ' ').trim();
}

function namesMatch(ourName, otName) {
  const a = normName(ourName);
  const b = normName(otName);
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const wordsA = a.split(' ').filter(w => w.length > 2);
  const wordsB = b.split(' ').filter(w => w.length > 2);
  if (wordsA.length === 0 || wordsB.length === 0) return false;
  const common = wordsA.filter(w => wordsB.includes(w));
  const overlap = common.length / Math.max(wordsA.length, wordsB.length);
  return overlap >= 0.5;
}

// NYC bounding box check
function isNYCArea(text) {
  if (!text) return true; // If we can't tell, don't reject
  const lower = text.toLowerCase();
  // Reject if clearly another city
  const otherCities = ['chicago', 'los angeles', 'san francisco', 'miami', 'boston', 'philadelphia',
    'washington', 'seattle', 'dallas', 'houston', 'atlanta', 'denver', 'las vegas',
    'london', 'paris', 'toronto', 'beverly hills', 'santa monica', 'scottsdale',
    'austin', 'nashville', 'portland', 'san diego', 'detroit', 'minneapolis'];
  for (const city of otherCities) {
    if (lower.includes(city)) return false;
  }
  return true;
}

// ── Validate OT page via Puppeteer — opens the URL, extracts name/rid/slug ──
async function validateOTPage(browser, url) {
  let page;
  try {
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
      else req.continue();
    });

    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const status = resp?.status() || 0;
    const finalUrl = page.url();

    if (finalUrl === 'https://www.opentable.com/' || finalUrl === 'https://www.opentable.com' || finalUrl.includes('opentable.com/s?')) {
      await page.close(); return { valid: false, reason: 'redirected_away' };
    }
    if (status === 404 || status >= 400) {
      await page.close(); return { valid: false, reason: status === 404 ? 'not_found' : `http_${status}` };
    }

    const info = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      let pageName = (document.querySelector('title')?.textContent || '')
        .replace(/ \| OpenTable.*/, '').replace(/ - .*$/, '').replace(/ Reservations.*/, '').trim();
      const ridPats = [/data-restaurant-id="(\d+)"/, /"rid"\s*:\s*(\d+)/, /"restaurantId"\s*:\s*(\d+)/, /"restaurant_id"\s*:\s*(\d+)/];
      let rid = null;
      for (const p of ridPats) { const m = html.match(p); if (m && parseInt(m[1]) > 0) { rid = parseInt(m[1]); break; } }
      const canon = document.querySelector('link[rel="canonical"]')?.href || document.querySelector('meta[property="og:url"]')?.content || null;
      const isRest = html.includes('RestaurantProfile') || html.includes('data-restaurant-id') || html.includes('"restaurantId"') || (canon && canon.includes('/r/'));
      const loc = (html.match(/"addressLocality"\s*:\s*"([^"]+)"/) || [])[1] || null;
      return { pageName, rid, canonicalUrl: canon, isRestaurant: isRest, locality: loc };
    });
    await page.close();

    if (!info.isRestaurant || info.pageName === 'OpenTable') return { valid: false, reason: 'not_restaurant_page' };
    const slugMatch = info.canonicalUrl?.match(/opentable\.com\/r\/([a-z0-9-]+)/);
    return {
      valid: true, pageName: info.pageName || null, rid: info.rid,
      slug: slugMatch ? slugMatch[1] : null,
      canonicalUrl: info.canonicalUrl, finalUrl, locality: info.locality, status
    };
  } catch (e) {
    if (page) try { await page.close(); } catch (_) {}
    return { valid: false, reason: 'error' };
  }
}

// ── Puppeteer website scraping for OT links ──
async function scrapeWebsiteForOT(browser, websiteUrl) {
  if (!websiteUrl) return [];

  let page;
  try {
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(websiteUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(2000);

    const otLinks = await page.evaluate(() => {
      const links = [];
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.href || '';
        if (href.includes('opentable.com')) links.push(href);
      });
      document.querySelectorAll('iframe[src]').forEach(iframe => {
        const src = iframe.src || '';
        if (src.includes('opentable.com')) links.push(src);
      });
      document.querySelectorAll('[data-src*="opentable"], [data-url*="opentable"], [data-href*="opentable"]').forEach(el => {
        links.push(el.getAttribute('data-src') || el.getAttribute('data-url') || el.getAttribute('data-href'));
      });
      document.querySelectorAll('script[src*="opentable"]').forEach(s => {
        links.push(s.src);
      });
      const html = document.documentElement.innerHTML;
      const otMatches = html.match(/https?:\/\/[^\s"'<>]*opentable\.com[^\s"'<>]*/g) || [];
      links.push(...otMatches);
      return [...new Set(links)];
    });

    await page.close();
    return otLinks;

  } catch (e) {
    if (page) try { await page.close(); } catch (_) {}
    return [];
  }
}

// Parse OT links into candidate URLs (returns array of candidates to try)
function parseOTLinks(links) {
  const candidates = [];
  const seen = new Set();

  for (const link of links) {
    // /r/slug links (best quality)
    const slugMatch = link.match(/opentable\.com\/r\/([a-z0-9-]+)/);
    if (slugMatch) {
      const url = `https://www.opentable.com/r/${slugMatch[1]}`;
      if (!seen.has(url)) { seen.add(url); candidates.push({ url, method: 'puppeteer_slug' }); }
      continue;
    }
    // rid-based links
    const ridMatch = link.match(/rid=(\d+)/);
    if (ridMatch && parseInt(ridMatch[1]) > 0) {
      const url = `https://www.opentable.com/restref/client/?rid=${ridMatch[1]}`;
      if (!seen.has(url)) { seen.add(url); candidates.push({ url, rid: parseInt(ridMatch[1]), method: 'puppeteer_rid' }); }
      continue;
    }
    // /restaurant-name style
    const restMatch = link.match(/opentable\.com\/([a-z][a-z0-9-]+(?:-reservations[a-z0-9-]*)?)\/?(?:\?|$)/i);
    if (restMatch && !['s', 'start', 'my', 'info', 'dapi', 'booking', 'restref'].includes(restMatch[1].split('-')[0])) {
      const url = `https://www.opentable.com/${restMatch[1]}`;
      if (!seen.has(url)) { seen.add(url); candidates.push({ url, method: 'puppeteer_page' }); }
    }
  }

  return candidates;
}

// ── GraphQL autocomplete search ──
async function searchGraphQL(name, lat, lng) {
  const latitude = lat || 40.7128;
  const longitude = lng || -74.006;

  try {
    const variables = JSON.stringify({ term: name, latitude, longitude, useNewVersion: true });
    const url = `https://www.opentable.com/dapi/fe/gql?operation=Autocomplete&variables=${encodeURIComponent(variables)}`;

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.opentable.com/',
      }
    });

    if (!resp.ok) return [];

    const data = await resp.json();
    const restaurants = data?.data?.autocomplete?.restaurants || [];

    const candidates = [];
    for (const r of restaurants) {
      const otName = r.name || '';
      if (!namesMatch(name, otName)) continue;

      const profileLink = r.profileLink || null;
      const slug = r.urlSlug || null;
      const rid = r.rid || r.restaurantId || null;

      let candidateUrl = null;
      if (profileLink && profileLink.includes('opentable.com')) {
        candidateUrl = profileLink.startsWith('http') ? profileLink : `https://www.opentable.com${profileLink}`;
      } else if (slug) {
        candidateUrl = `https://www.opentable.com/r/${slug}`;
      } else if (rid && rid > 0) {
        candidateUrl = `https://www.opentable.com/restref/client/?rid=${rid}`;
      }

      if (candidateUrl) {
        candidates.push({ url: candidateUrl, otName, rid, slug, method: 'graphql' });
      }
    }
    return candidates;
  } catch (e) {
    return [];
  }
}

// ── Main ──
async function main() {
  const startTime = Date.now();
  const found = [...(previous.found || [])];
  const notFound = [...(previous.notFound || [])];
  const errorList = [...(previous.errors || [])];
  let graphqlHits = 0, puppeteerHits = 0, validated = 0, invalidated = 0, nameRejected = 0;

  console.log('🚀 Launching Puppeteer...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    for (let i = 0; i < toProcess.length; i++) {
      const c = toProcess[i];
      const shortName = c.name.substring(0, 40).padEnd(40);
      process.stdout.write(`  [${String(i + 1).padStart(4)}/${toProcess.length}] ${shortName} `);

      let allCandidates = [];

      // Phase 1: Puppeteer scrape the restaurant's own website
      if (!SKIP_PUPPETEER && c.website) {
        try {
          const otLinks = await scrapeWebsiteForOT(browser, c.website);
          if (otLinks.length > 0) {
            const parsed = parseOTLinks(otLinks);
            allCandidates.push(...parsed);
            if (parsed.length > 0) process.stdout.write(`PUP(${parsed.length}) `);
          }
        } catch (e) { /* skip */ }
        // Cooldown after Puppeteer
        await sleep(3000);
      }

      // Phase 2: GraphQL if Puppeteer found nothing
      if (allCandidates.length === 0) {
        try {
          const gqlCandidates = await searchGraphQL(c.name, c.lat, c.lng);
          allCandidates.push(...gqlCandidates);
          if (gqlCandidates.length > 0) process.stdout.write(`GQL(${gqlCandidates.length}) `);
        } catch (e) { /* skip */ }
        await sleep(1000);
      }

      if (allCandidates.length === 0) {
        console.log('❌');
        notFound.push(c.name);
        await sleep(500);
        continue;
      }

      // Phase 3: Validate candidates via Puppeteer — visit OT page, check name + city
      let bestMatch = null;
      for (const candidate of allCandidates.slice(0, 3)) {
        const info = await validateOTPage(browser, candidate.url);
        await sleep(3000); // cooldown between OT page visits

        if (!info.valid) {
          process.stdout.write(`[${info.reason}] `);
          continue;
        }

        // Name match check — critical to avoid wrong restaurant
        if (info.pageName && !namesMatch(c.name, info.pageName)) {
          process.stdout.write(`[name:"${info.pageName?.substring(0, 25)}"] `);
          nameRejected++;
          continue;
        }

        // NYC area check — check both locality and URL slug for other cities
        if (!isNYCArea(info.locality) || !isNYCArea(info.canonicalUrl) || !isNYCArea(info.finalUrl)) {
          process.stdout.write(`[city:${info.locality}] `);
          nameRejected++;
          continue;
        }

        // Build proper URL — prefer /r/slug canonical URL
        const finalUrl = info.canonicalUrl && info.canonicalUrl.includes('/r/')
          ? info.canonicalUrl
          : info.slug
            ? `https://www.opentable.com/r/${info.slug}`
            : info.finalUrl || candidate.url;

        bestMatch = {
          name: c.name,
          otName: info.pageName || candidate.otName || null,
          otUrl: finalUrl,
          slug: info.slug || null,
          rid: info.rid || candidate.rid || null,
          method: candidate.method,
          website: c.website,
          validationStatus: info.status
        };
        break; // Take the first valid match
      }

      if (bestMatch) {
        validated++;
        if (bestMatch.method.startsWith('puppeteer')) puppeteerHits++;
        else graphqlHits++;
        found.push(bestMatch);
        console.log(`✅ ${bestMatch.method} → ${bestMatch.otUrl}`);
      } else {
        invalidated++;
        console.log(`🚫 all ${allCandidates.length} candidates failed validation`);
        notFound.push(c.name);
      }

      // Cooldown after validation
      await sleep(1500);

      // Save progress every 25 restaurants
      if ((i + 1) % 25 === 0) {
        saveResults(found, notFound, errorList, toProcess.length, i + 1);
        console.log(`  💾 Progress saved (${i + 1}/${toProcess.length})`);
      }
    }
  } finally {
    await browser.close();
  }

  // Final save
  saveResults(found, notFound, errorList, toProcess.length, toProcess.length);

  const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`🎉 Done in ${elapsed} min`);
  console.log(`  ✅ Found & validated: ${found.length} (${previous.found?.length || 0} previous + ${validated} new)`);
  console.log(`  🔍 GraphQL hits: ${graphqlHits}`);
  console.log(`  🌐 Puppeteer hits: ${puppeteerHits}`);
  console.log(`  🚫 Name/city mismatch rejected: ${nameRejected}`);
  console.log(`  🚫 Invalid (404/redirect): ${invalidated - nameRejected}`);
  console.log(`  ❌ Not found: ${notFound.length}`);
  console.log(`  💾 Saved to: ${OUTPUT_FILE}\n`);
}

function saveResults(found, notFound, errors, _total, processed) {
  const output = {
    _meta: {
      last_run: new Date().toISOString(),
      total_website_restaurants: candidates.length + previousNames.size,
      processed: (previous.found?.length || 0) + (previous.notFound?.length || 0) + processed,
      found: found.length,
      not_found: notFound.length,
      errors: errors.length
    },
    found,
    notFound,
    errors
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
