/**
 * check-ot-links.js
 *
 * Checks all OpenTable URLs in BOOKING_MASTER.json for validity.
 * Uses curl for reliable HTTP checks (Node fetch gets blocked by OT).
 *
 * RUN:   node scripts/check-ot-links.js
 * OPTIONS:
 *   --quick     Only check first 50 (for testing)
 *   --resume    Skip already-checked URLs from previous run
 *
 * OUTPUT: data/ot_link_check.json
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const RESUME = args.includes('--resume');

const MASTER_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'BOOKING_MASTER.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'ot_link_check.json');

const MASTER = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));

// Load previous results if resuming
let previous = {};
if (RESUME) {
  try {
    previous = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    console.log(`📂 Loaded ${Object.keys(previous.results || {}).length} previous results`);
  } catch (e) { /* first run */ }
}

// Build list of OT entries
const allOt = [];
for (const [name, entry] of Object.entries(MASTER)) {
  if (entry.platform !== 'opentable') continue;
  if (!entry.url || !entry.url.includes('opentable.com')) continue;
  allOt.push({ name, url: entry.url });
}

const toCheck = [];
for (const item of allOt) {
  if (RESUME && previous.results && previous.results[item.name]) continue;
  toCheck.push(item);
}

let checkList = QUICK ? toCheck.slice(0, 50) : toCheck;

console.log(`\n🔗 OpenTable Link Checker`);
console.log(`📊 Total OT in MASTER: ${allOt.length}`);
if (RESUME) console.log(`⏭️  Skipping ${allOt.length - toCheck.length} already checked`);
console.log(`🎯 Checking: ${checkList.length}`);
console.log(`⏱️  Est: ~${Math.round(checkList.length * 0.8 / 60)} minutes\n`);

function checkUrl(url) {
  try {
    // curl: follow redirects, get status code + final URL
    const out = execSync(
      `curl -s -o /dev/null -w "%{http_code}|%{url_effective}" -L --max-time 8 "${url}"`,
      { encoding: 'utf8', timeout: 12000 }
    ).trim();
    const [status, finalUrl] = out.split('|');
    const code = parseInt(status);

    const isNotFound = code === 404;
    const redirectedAway = (finalUrl === 'https://www.opentable.com/'
      || finalUrl === 'https://www.opentable.com'
      || finalUrl.includes('opentable.com/s?'))
      && !url.includes('opentable.com/s?');

    return {
      status: code,
      finalUrl: finalUrl !== url ? finalUrl : null,
      valid: !isNotFound && !redirectedAway && code >= 200 && code < 400,
      reason: isNotFound ? 'not_found' : redirectedAway ? 'redirected_away' : (code >= 400 ? `http_${code}` : 'ok')
    };
  } catch (e) {
    return { status: 0, valid: false, reason: 'error', error: e.message.substring(0, 100) };
  }
}

const results = previous.results || {};
let valid = 0, invalid = 0, errors = 0;

// Count previous
for (const v of Object.values(results)) {
  if (v.valid) valid++;
  else if (v.reason === 'error') errors++;
  else invalid++;
}

for (let i = 0; i < checkList.length; i++) {
  const { name, url } = checkList[i];
  process.stdout.write(`  [${String(i + 1).padStart(4)}/${checkList.length}] ${name.substring(0, 38).padEnd(38)} `);

  const result = checkUrl(url);
  results[name] = { url, ...result };

  if (result.valid) {
    valid++;
    console.log(`✅`);
  } else if (result.reason === 'error') {
    errors++;
    console.log(`⚠️  ${result.reason}`);
  } else {
    invalid++;
    console.log(`❌ ${result.reason}${result.status ? ' (' + result.status + ')' : ''}`);
  }

  // Save every 100
  if ((i + 1) % 100 === 0) {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ _meta: { checked: Object.keys(results).length, valid, invalid, errors, last_run: new Date().toISOString() }, results }, null, 2));
    process.stdout.write(`  💾 Saved progress (${i + 1}/${checkList.length})\n`);
  }

  // Delay to avoid rate limiting
  execSync('sleep 1');
}

// Final save
const meta = { checked: Object.keys(results).length, valid, invalid, errors, last_run: new Date().toISOString() };
fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ _meta: meta, results }, null, 2));

console.log(`\n${'═'.repeat(50)}`);
console.log(`📊 RESULTS:`);
console.log(`   ✅ Valid:   ${valid}`);
console.log(`   ❌ Invalid: ${invalid}`);
console.log(`   ⚠️  Errors:  ${errors}`);
console.log(`\n💾 Saved to: ${OUTPUT_FILE}`);
