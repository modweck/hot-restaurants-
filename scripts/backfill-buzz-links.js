#!/usr/bin/env node
// Backfill missing direct URLs in netlify/functions/buzz_lookup.json (and the
// mirrored inline BUZZ_LINKS in index.html) so press chips can 1-click deep-link
// to each restaurant's page on Eater / Infatuation / Time Out / GrubStreet.
//
//   Dry run (default):  node scripts/backfill-buzz-links.js
//   Apply:              node scripts/backfill-buzz-links.js --apply
//   Limit publications: node scripts/backfill-buzz-links.js --only=Infatuation,Eater
//
// Strategy per publication:
//   Infatuation  →  parse sitemap-1.xml (7818 NY review URLs), fuzzy slug match
//   Time Out     →  parse all NY sub-sitemaps, filter /newyork/restaurants/, fuzzy match
//   Eater        →  slug-guess + HEAD-check ny.eater.com/venue/<slug>
//   GrubStreet   →  slug-guess + HEAD-check grubstreet.com/listings/<slug>.html

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MASTER_PATH = path.join(ROOT, 'netlify/functions/BOOKING_MASTER.json');
const LOOKUP_PATH = path.join(ROOT, 'netlify/functions/buzz_lookup.json');
const INDEX_PATH = path.join(ROOT, 'index.html');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const onlyArg = args.find(a => a.startsWith('--only='));
const ONLY = onlyArg ? new Set(onlyArg.slice(7).split(',').map(s => s.trim())) : null;
const VERBOSE = args.includes('--verbose');

const PUBS = ['Eater', 'Infatuation', 'Time Out', 'GrubStreet'];
const SOURCE_LABELS = {
  Eater: 'Eater',
  Infatuation: 'Infatuation',
  'Time Out': 'Time Out',
  GrubStreet: 'Grub Street',
};
const STOPWORDS = new Set(['the','a','an','and','of','at','in','on','to','by','for','de','la','le','les','el']);

function normalizeSource(s) {
  const m = { 'the infatuation':'Infatuation', infatuation:'Infatuation', timeout:'Time Out', 'time out':'Time Out', eater:'Eater', grubstreet:'GrubStreet', 'grub street':'GrubStreet' };
  return m[(s||'').toLowerCase()] || s;
}

function slugify(name) {
  return (name||'')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function tokensFromName(name) {
  return slugify(name).split('-').filter(t => t && t.length > 1 && !STOPWORDS.has(t));
}
function tokensFromSlug(slug) {
  return (slug||'').split('-').filter(t => t && t.length > 1 && !STOPWORDS.has(t));
}

// Score: F1 between name-token set and slug-token set, with a strong recall bonus.
// Exact-slug equality returns 1.0 outright.
function scoreMatch(nameTokens, slugTokens) {
  if (!nameTokens.length || !slugTokens.length) return 0;
  const nSet = new Set(nameTokens);
  const sSet = new Set(slugTokens);
  let hits = 0;
  for (const t of nSet) if (sSet.has(t)) hits++;
  const recall = hits / nSet.size;
  const precision = hits / sSet.size;
  if (recall === 0) return 0;
  // Hard requirement: every name token must appear in the slug
  if (recall < 1) return 0;
  return 2 * recall * precision / (recall + precision);
}

// Best match given a name + sitemap index { slug → url }
function bestMatch(name, index) {
  const nameSlug = slugify(name);
  if (index.has(nameSlug)) return { url: index.get(nameSlug), slug: nameSlug, score: 1, exact: true };
  const nTokens = tokensFromName(name);
  if (!nTokens.length) return null;
  let best = null;
  for (const [slug, url] of index) {
    const sTokens = tokensFromSlug(slug);
    const score = scoreMatch(nTokens, sTokens);
    if (score > 0 && (!best || score > best.score || (score === best.score && slug.length < best.slug.length))) {
      best = { url, slug, score, exact: false };
    }
  }
  return best;
}

async function fetchText(url, timeout = 15000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeout);
  try {
    const res = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'Mozilla/5.0 (hot-restaurants-backfill)' } });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
  finally { clearTimeout(t); }
}

async function head(url, timeout = 8000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeout);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: c.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (hot-restaurants-backfill)' } });
    return res.status >= 200 && res.status < 400;
  } catch { return false; }
  finally { clearTimeout(t); }
}

async function pLimit(concurrency, items, worker) {
  const results = new Array(items.length);
  let i = 0;
  async function runOne() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, runOne));
  return results;
}

// ── Sitemap loaders ────────────────────────────────────────────────────────
async function loadInfatuationIndex() {
  const xml = await fetchText('https://www.theinfatuation.com/sitemap-1.xml');
  if (!xml) return new Map();
  const urls = xml.match(/https:\/\/www\.theinfatuation\.com\/new-york\/reviews\/[^<\s]+/g) || [];
  const idx = new Map();
  for (const url of urls) {
    const slug = url.split('/').pop();
    if (slug && !idx.has(slug)) idx.set(slug, url);
  }
  return idx;
}

async function loadTimeOutIndex() {
  const indexXml = await fetchText('https://www.timeout.com/newyork/sitemap.xml.gz');
  if (!indexXml) return new Map();
  const subSitemaps = (indexXml.match(/https:\/\/www\.timeout\.com\/newyork\/sitemap_\d+\.xml\.gz/g) || []);
  const idx = new Map();
  let scanned = 0, restos = 0;
  await pLimit(8, subSitemaps, async (smUrl) => {
    const xml = await fetchText(smUrl, 20000);
    scanned++;
    if (!xml) return;
    const urls = xml.match(/https:\/\/www\.timeout\.com\/newyork\/restaurants\/[^<\s]+/g) || [];
    for (const url of urls) {
      const slug = url.replace(/^.*\/newyork\/restaurants\//, '').split(/[?#]/)[0].replace(/\/$/, '');
      if (slug && !idx.has(slug)) { idx.set(slug, url); restos++; }
    }
  });
  if (VERBOSE) console.error(`  Time Out: scanned ${scanned}/${subSitemaps.length} sub-sitemaps, indexed ${restos} restaurants`);
  return idx;
}

// Candidate slug list for HEAD-check publications
function eaterCandidates(name) {
  const base = slugify(name);
  const noStop = base.split('-').filter(t => !STOPWORDS.has(t)).join('-');
  const set = new Set([base]);
  if (noStop && noStop !== base) set.add(noStop);
  // strip common qualifiers ("nyc", "new york", "manhattan", "ny", "downtown", "uptown")
  const stripped = base.replace(/-(nyc|new-york|manhattan|ny|downtown|uptown|brooklyn|queens)$/, '');
  if (stripped !== base) set.add(stripped);
  return [...set];
}
function grubstreetCandidates(name) {
  return eaterCandidates(name); // same heuristic
}

async function tryEater(name) {
  const cands = eaterCandidates(name);
  for (const slug of cands) {
    const url = `https://ny.eater.com/venue/${slug}`;
    if (await head(url)) return { url, slug };
  }
  return null;
}
async function tryGrubstreet(name) {
  const cands = grubstreetCandidates(name);
  for (const slug of cands) {
    const url = `https://www.grubstreet.com/listings/${slug}.html`;
    if (await head(url)) return { url, slug };
  }
  return null;
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'));
  const lookup = JSON.parse(fs.readFileSync(LOOKUP_PATH, 'utf8'));

  // Build (name, publication) work list — only where buzz_sources mentions it
  // and lookup doesn't already have a URL for that source.
  const work = []; // { name, pub }
  for (const [name, r] of Object.entries(master)) {
    if (!r.buzz_sources || !r.buzz_sources.length) continue;
    const want = new Set(r.buzz_sources.map(normalizeSource).filter(s => PUBS.includes(s)));
    if (ONLY) for (const p of [...want]) if (!ONLY.has(p)) want.delete(p);
    if (!want.size) continue;
    const existing = lookup[name];
    const haveSources = new Set((existing?.links || []).filter(l => l.url).map(l => normalizeSource(l.source)));
    for (const pub of want) if (!haveSources.has(pub)) work.push({ name, pub });
  }

  console.error(`Backfill targets: ${work.length} (restaurant, publication) pairs`);
  const byPub = Object.fromEntries(PUBS.map(p => [p, work.filter(w => w.pub === p).length]));
  for (const p of PUBS) if (byPub[p]) console.error(`  ${p}: ${byPub[p]}`);

  // Load sitemaps in parallel for sitemap-driven pubs
  console.error('\nLoading sitemaps…');
  const [infatIdx, toIdx] = await Promise.all([
    (!ONLY || ONLY.has('Infatuation')) && byPub.Infatuation ? loadInfatuationIndex() : Promise.resolve(new Map()),
    (!ONLY || ONLY.has('Time Out')) && byPub['Time Out']     ? loadTimeOutIndex()    : Promise.resolve(new Map()),
  ]);
  console.error(`  Infatuation index: ${infatIdx.size} URLs`);
  console.error(`  Time Out index:    ${toIdx.size} URLs`);

  // Resolve each work item → URL (or null)
  const results = []; // { name, pub, url, method, slug }
  console.error('\nResolving…');

  // Group by publication so we can batch HEAD-check ones with concurrency
  const byPubItems = Object.fromEntries(PUBS.map(p => [p, work.filter(w => w.pub === p)]));

  for (const w of byPubItems.Infatuation) {
    const m = bestMatch(w.name, infatIdx);
    if (m) results.push({ ...w, url: m.url, method: m.exact ? 'sitemap-exact' : `sitemap-fuzzy(${m.score.toFixed(2)})`, slug: m.slug });
    else results.push({ ...w, url: null, method: 'no-match' });
  }
  for (const w of byPubItems['Time Out']) {
    const m = bestMatch(w.name, toIdx);
    if (m) results.push({ ...w, url: m.url, method: m.exact ? 'sitemap-exact' : `sitemap-fuzzy(${m.score.toFixed(2)})`, slug: m.slug });
    else results.push({ ...w, url: null, method: 'no-match' });
  }
  // HEAD-checks — concurrency 6
  if (byPubItems.Eater.length) {
    let n = 0;
    await pLimit(6, byPubItems.Eater, async (w) => {
      const m = await tryEater(w.name);
      n++;
      if (n % 25 === 0) console.error(`  Eater HEAD: ${n}/${byPubItems.Eater.length}`);
      if (m) results.push({ ...w, url: m.url, method: 'head-200', slug: m.slug });
      else results.push({ ...w, url: null, method: 'head-404' });
    });
  }
  if (byPubItems.GrubStreet.length) {
    let n = 0;
    await pLimit(6, byPubItems.GrubStreet, async (w) => {
      const m = await tryGrubstreet(w.name);
      n++;
      if (n % 10 === 0) console.error(`  GrubStreet HEAD: ${n}/${byPubItems.GrubStreet.length}`);
      if (m) results.push({ ...w, url: m.url, method: 'head-200', slug: m.slug });
      else results.push({ ...w, url: null, method: 'head-404' });
    });
  }

  // Stats
  const summary = {};
  for (const p of PUBS) summary[p] = { found: 0, missed: 0, items: [] };
  for (const r of results) {
    if (r.url) summary[r.pub].found++; else summary[r.pub].missed++;
    summary[r.pub].items.push(r);
  }
  console.error('\nResults:');
  for (const p of PUBS) {
    if (!summary[p].items.length) continue;
    const total = summary[p].found + summary[p].missed;
    console.error(`  ${p}: ${summary[p].found}/${total} found (${(summary[p].found/total*100).toFixed(0)}%)`);
  }

  // Write a sample log for review
  const sampleLines = [];
  for (const p of PUBS) {
    if (!summary[p].items.length) continue;
    sampleLines.push(`\n# ${p} — found ${summary[p].found}/${summary[p].found + summary[p].missed}`);
    const found = summary[p].items.filter(r => r.url);
    const missed = summary[p].items.filter(r => !r.url);
    sampleLines.push(`# --- FOUND (sample 12) ---`);
    for (const r of found.slice(0, 12)) sampleLines.push(`  ${r.name}  →  ${r.url}  [${r.method}]`);
    if (missed.length) {
      sampleLines.push(`# --- MISSED (sample 12) ---`);
      for (const r of missed.slice(0, 12)) sampleLines.push(`  ${r.name}  [${r.method}]`);
    }
  }
  const logPath = path.join(ROOT, 'scripts/backfill-buzz-links.last-run.log');
  fs.writeFileSync(logPath, sampleLines.join('\n') + '\n');
  console.error(`\nSample log:  ${path.relative(ROOT, logPath)}`);

  // Build the patch on buzz_lookup. Accumulate across results — earlier
  // pubs for the same restaurant must carry forward, not be overwritten.
  const updates = {}; // name → new links array (full, replaces existing)
  for (const r of results) {
    if (!r.url) continue;
    const baseLinks = updates[r.name]
      ? [...updates[r.name]]
      : (lookup[r.name]?.links ? [...lookup[r.name].links] : []);
    const haveSources = new Set(baseLinks.map(l => normalizeSource(l.source)));
    if (haveSources.has(r.pub)) continue;
    baseLinks.push({ source: SOURCE_LABELS[r.pub] || r.pub, label: SOURCE_LABELS[r.pub] || r.pub, url: r.url });
    updates[r.name] = baseLinks;
  }
  const updateCount = Object.keys(updates).length;
  console.error(`\nLookup entries to update/insert: ${updateCount}`);

  if (!APPLY) {
    console.error('\nDRY RUN — pass --apply to write changes to buzz_lookup.json and index.html');
    return;
  }

  // Apply: update buzz_lookup.json
  for (const [name, links] of Object.entries(updates)) {
    if (!lookup[name]) lookup[name] = { tier: null, links };
    else lookup[name].links = links;
  }
  // Preserve original minified style so the diff is small and the file stays compact
  fs.writeFileSync(LOOKUP_PATH, JSON.stringify(lookup));
  console.error(`Wrote ${path.relative(ROOT, LOOKUP_PATH)}`);

  // Apply: rewrite inline BUZZ_LINKS in index.html (single-line JSON, matches existing style)
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const re = /(const BUZZ_LINKS = )(\{[\s\S]*?\})(;)/;
  const m = html.match(re);
  if (!m) {
    console.error('ERROR: could not locate const BUZZ_LINKS literal in index.html');
    process.exit(1);
  }
  const newLiteral = JSON.stringify(lookup);
  const updated = html.slice(0, m.index) + m[1] + newLiteral + m[3] + html.slice(m.index + m[0].length);
  fs.writeFileSync(INDEX_PATH, updated);
  console.error(`Updated inline BUZZ_LINKS in ${path.relative(ROOT, INDEX_PATH)}`);
  console.error('\nDone.');
})();
