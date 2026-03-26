/**
 * resy-sniper-captcha.js
 * 
 * Snipes a Resy reservation with 2Captcha bypass.
 * Solves captcha 30 seconds before drop so token is FRESH.
 * 
 * USAGE: node scripts/resy-sniper-captcha.js --slug <slug> --venue-id <id> --date <YYYY-MM-DD> --party <n> --earliest <HH:MM> --latest <HH:MM> --drop-time <HH:MM>
 */

const { execSync } = require('child_process');
const fs = require('fs');

// CLI args
const args = process.argv.slice(2);
function getArg(name, def) { const i = args.indexOf('--' + name); return i !== -1 && args[i + 1] ? args[i + 1] : def; }

const SLUG = getArg('slug', 'torrisi');
const VENUE_ID = parseInt(getArg('venue-id', '0'));
const DATE = getArg('date', null);
const PARTY = parseInt(getArg('party', '2'));
const EARLIEST = getArg('earliest', '17:00');
const LATEST = getArg('latest', '22:00');
const DROP_TIME = getArg('drop-time', '10:00');

if (!DATE) { console.error('❌ --date required'); process.exit(1); }

const KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const AUTH = getArg('auth', 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3NzgyNjg5NTksInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.AOmR1uzP1ooGFufA8QSk2wU4we5YI_NKYbXoHZcIhD6oCFDma3cKXqkF7ZWLfarDply3tN_SzHmUeKg6Og-8i1-pAHUO9ai-DOWmHklbfQtll4VMh7b9DRSxNXamp1MAtvhcakwb576Q-AS7X_-FLTVAt5anOpeHaF6RPh9EwPKaiNle');
const CAPTCHA_KEY = 'c9f9650dcc39ce04c40e5414c201836a';
const SITEKEY = '6Lfw-dIZAAAAAESRBH4JwdgfTXj5LlS1ewlvvCYe';

const sleep = ms => new Promise(r => setTimeout(r, ms));

const [earliestH, earliestM] = EARLIEST.split(':').map(Number);
const [latestH, latestM] = LATEST.split(':').map(Number);
const EARLIEST_MIN = earliestH * 60 + (earliestM || 0);
const LATEST_MIN = latestH * 60 + (latestM || 0);

function curl(url) {
  return JSON.parse(execSync(`curl -s '${url}' -H 'Authorization: ResyAPI api_key="${KEY}"' -H 'Origin: https://resy.com'`, { encoding: 'utf8', timeout: 10000 }));
}

async function solveCaptcha() {
  const taskResp = JSON.parse(execSync(
    `curl -s "http://2captcha.com/in.php?key=${CAPTCHA_KEY}&method=userrecaptcha&googlekey=${SITEKEY}&pageurl=https://resy.com/cities/new-york-ny/venues/${SLUG}&json=1"`,
    { encoding: 'utf8' }
  ));
  const taskId = taskResp.request;
  
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const resp = JSON.parse(execSync(
      `curl -s "http://2captcha.com/res.php?key=${CAPTCHA_KEY}&action=get&id=${taskId}&json=1"`,
      { encoding: 'utf8' }
    ));
    if (resp.status === 1) return resp.request;
  }
  return null;
}

async function main() {
  // Resolve venue ID if not provided
  let venueId = VENUE_ID;
  if (!venueId) {
    const info = curl(`https://api.resy.com/3/venue?url_slug=${SLUG}&location=new-york-ny`);
    venueId = info?.id?.resy;
    console.log(`✅ ${info.name} (ID: ${venueId}) captcha: ${info.feature_recaptcha ? 'YES' : 'no'}`);
  }

  const [dropH, dropM] = DROP_TIME.split(':').map(Number);

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  🎯 RESY CAPTCHA SNIPER`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`  Venue:  ${SLUG} (ID: ${venueId})`);
  console.log(`  Date:   ${DATE} | Party: ${PARTY}`);
  console.log(`  Window: ${EARLIEST} - ${LATEST}`);
  console.log(`  Drop:   ${DROP_TIME}`);
  console.log(`${'═'.repeat(50)}\n`);

  // Wait until 35 seconds before drop to start solving captchas
  const now = new Date();
  const drop = new Date(now);
  drop.setHours(dropH, dropM, 0, 0);
  // If drop time already passed today, it's tomorrow morning
  if (drop <= now) drop.setDate(drop.getDate() + 1);

  const solveAt = new Date(drop);
  solveAt.setSeconds(solveAt.getSeconds() - 35);

  if (solveAt > now) {
    const waitMs = solveAt - now;
    console.log(`⏰ Waiting ${Math.ceil(waitMs / 60000)} min until ${DROP_TIME} (solve at -35s)...`);
    
    const interval = setInterval(() => {
      const r = drop - new Date();
      if (r > 0) process.stdout.write(`\r   ⏳ ${Math.floor(r / 60000)}m ${Math.floor((r % 60000) / 1000)}s...     `);
    }, 15000);
    
    await sleep(waitMs);
    clearInterval(interval);
  }

  // SOLVE TWO CAPTCHAS IN PARALLEL (backup)
  console.log(`\n\n🔐 Solving 2 captchas in parallel (35s before drop)...`);
  const solveStart = Date.now();
  
  const [token1, token2] = await Promise.all([
    solveCaptcha().then(t => { console.log(`   ✅ Token 1 ready (${((Date.now() - solveStart) / 1000).toFixed(0)}s)`); return t; }),
    solveCaptcha().then(t => { console.log(`   ✅ Token 2 ready (${((Date.now() - solveStart) / 1000).toFixed(0)}s)`); return t; }),
  ]);

  if (!token1 && !token2) { console.log('❌ Both captcha solves failed'); return; }
  
  const tokens = [token1, token2].filter(Boolean);
  console.log(`🔐 ${tokens.length} captcha token(s) ready\n`);

  // Wait until 5 seconds before drop
  const msUntilDrop = drop - new Date();
  if (msUntilDrop > 5000) {
    console.log(`⏰ Waiting ${(msUntilDrop / 1000).toFixed(0)}s for drop...`);
    await sleep(msUntilDrop - 5000);
  }

  // SNIPE
  console.log(`\n🚀 SNIPING at ${new Date().toISOString()} (${((drop - new Date()) / 1000).toFixed(1)}s before drop)\n`);

  let tokenIdx = 0;

  for (let attempt = 1; attempt <= 50; attempt++) {
    process.stdout.write(`  [${attempt}/50] `);

    try {
      // Fire 3 parallel find requests, use first result with slots
      const findUrl = `https://api.resy.com/4/find?venue_id=${venueId}&day=${DATE}&party_size=${PARTY}&lat=40.7128&long=-74.006`;
      let slots = [];
      try {
        const results = await Promise.all([
          fetch(findUrl, { headers: { 'Authorization': `ResyAPI api_key="${KEY}"`, 'Origin': 'https://resy.com' } }).then(r => r.json()).catch(() => null),
          fetch(findUrl, { headers: { 'Authorization': `ResyAPI api_key="${KEY}"`, 'Origin': 'https://resy.com' } }).then(r => r.json()).catch(() => null),
          fetch(findUrl, { headers: { 'Authorization': `ResyAPI api_key="${KEY}"`, 'Origin': 'https://resy.com' } }).then(r => r.json()).catch(() => null),
        ]);
        for (const r of results) {
          const s = r?.results?.venues?.[0]?.slots || [];
          if (s.length > slots.length) slots = s;
        }
      } catch {
        // Fallback to curl
        const find = curl(findUrl);
        slots = find?.results?.venues?.[0]?.slots || [];
      }

      if (!slots.length) { console.log('— no slots'); await sleep(100); continue; }

      // Filter to time window
      const matching = slots.filter(s => {
        const m = s.date?.start?.match(/(\d{2}):(\d{2})/);
        if (!m) return false;
        const totalMin = parseInt(m[1]) * 60 + parseInt(m[2]);
        return totalMin >= EARLIEST_MIN && totalMin <= LATEST_MIN;
      });

      if (!matching.length) {
        const times = slots.slice(0, 3).map(s => s.date?.start?.match(/(\d{2}:\d{2})/)?.[1]).join(', ');
        console.log(`— ${slots.length} slots outside window (${times})`);
        await sleep(100);
        continue;
      }

      // Grab first matching slot immediately — no sorting, speed is everything
      const best = matching[0];
      const time = best.date.start.match(/(\d{2}:\d{2})/)[1];
      console.log(`🎯 ${matching.length} slots! Grabbing: ${time}`);

      // Try each token
      for (let ti = tokenIdx; ti < tokens.length; ti++) {
        console.log(`  📋 Trying token ${ti + 1}...`);
        
        const body = JSON.stringify({ config_id: best.config.token, day: DATE, party_size: PARTY, captcha_token: tokens[ti] });
        fs.writeFileSync('/tmp/resy_captcha_body.json', body);

        try {
          const details = JSON.parse(execSync(
            `curl -s -X POST 'https://api.resy.com/3/details' ` +
            `-H 'Authorization: ResyAPI api_key="${KEY}"' ` +
            `-H 'X-Resy-Auth-Token: ${AUTH}' ` +
            `-H 'X-Resy-Universal-Auth: ${AUTH}' ` +
            `-H 'Origin: https://resy.com' ` +
            `-H 'Content-Type: application/json' ` +
            `-d @/tmp/resy_captcha_body.json`,
            { encoding: 'utf8', timeout: 10000 }
          ));

          const bookToken = details?.book_token?.value;
          const paymentId = details?.user?.payment_methods?.[0]?.id;

          if (!bookToken) {
            console.log(`  ❌ Token ${ti + 1} rejected: ${details.message || details.status}`);
            tokenIdx = ti + 1; // Try next token on next attempt
            continue;
          }

          console.log(`  ✅ Book token! Payment: ${paymentId}`);
          console.log(`  🔥 BOOKING...`);

          const bookResp = JSON.parse(execSync(
            `curl -s -X POST 'https://api.resy.com/3/book' ` +
            `-H 'Authorization: ResyAPI api_key="${KEY}"' ` +
            `-H 'X-Resy-Auth-Token: ${AUTH}' ` +
            `-H 'X-Resy-Universal-Auth: ${AUTH}' ` +
            `-H 'Origin: https://resy.com' ` +
            `-H 'Content-Type: application/x-www-form-urlencoded' ` +
            `--data-urlencode 'book_token=${bookToken}' ` +
            `--data-urlencode 'struct_payment_method={"id":${paymentId}}' ` +
            `--data-urlencode 'source_id=resy.com-venue-details'`,
            { encoding: 'utf8', timeout: 10000 }
          ));

          if (bookResp.resy_token) {
            console.log(`\n  ${'🎉'.repeat(5)}`);
            console.log(`  ✅ BOOKED! ${SLUG} ${DATE} at ${time}`);
            console.log(`  Party of ${PARTY}`);
            console.log(`  Confirmation: ${bookResp.resy_token}`);
            console.log(`  ${'🎉'.repeat(5)}\n`);
            process.exit(0);
          }

          console.log(`  ❌ Book failed: ${JSON.stringify(bookResp).slice(0, 100)}`);
        } catch (e) {
          console.log(`  ❌ Error: ${(e.message || '').slice(0, 50)}`);
        }
      }

    } catch (e) {
      console.log(`❌ ${(e.message || '').slice(0, 50)}`);
    }

    await sleep(100);
  }

  console.log(`\n😔 Max attempts reached (50).`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
