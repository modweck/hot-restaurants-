/**
 * monitor-drop-times.js — Check venues every 15 min to find when new dates appear
 *
 * RUN: node scripts/monitor-drop-times.js
 */

const fs = require('fs');
const path = require('path');

const API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const AUTH_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3ODI0MDgxNzMsInVpZCI6OTQ5MjYzNiwiZ3QiOiJjb25zdW1lciIsImdzIjpbXSwibGFuZyI6ImVuLXVzIiwiZXh0cmEiOnsiZ3Vlc3RfaWQiOjQzODU3OTk1fX0.ANww5inK9AJl-Nizvi1O9G0Sii8ZHmbvCLR9aaB01IC-K_qN1flFqSVXbCiGAMb_234sj9mRcNeirKBnw2u9M_GoADNwsa078Kx0sZn4Ml5D99R7Cln914qZobk7tXn6wS3HvUeXlIFIUikdKETX70we7K-q5MFrvUPmD3_wgIPUBMBE';

const HEADERS = {
  'Authorization': `ResyAPI api_key="${API_KEY}"`,
  'X-Resy-Auth-Token': AUTH_TOKEN,
  'X-Resy-Universal-Auth': AUTH_TOKEN,
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  'Origin': 'https://resy.com',
  'Referer': 'https://resy.com/',
};

const VENUES = [
  { name: 'Shion 69 Leonard', venue_id: 888, slug: '69leonardstreet', window: 30 },
  { name: 'I Sodi', venue_id: 443, slug: 'i-sodi', window: 14 },
];

const LOG_FILE = path.join(__dirname, '..', 'monitor-drop-times.log');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(msg) {
  const now = new Date();
  const ts = now.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch(e) {}
}

// Track the furthest available date per venue
const lastFurthest = {};

async function checkCalendar(venue) {
  try {
    // Check what dates have availability using the calendar endpoint
    const today = new Date();
    const month = today.toISOString().slice(0, 7); // YYYY-MM
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1).toISOString().slice(0, 7);
    const month3 = new Date(today.getFullYear(), today.getMonth() + 2, 1).toISOString().slice(0, 7);

    // Check current + next 2 months
    const dates = [];
    for (const m of [month, nextMonth, month3]) {
      const resp = await fetch(
        `https://api.resy.com/4/venue/calendar?venue_id=${venue.venue_id}&num_seats=2&start_date=${m}-01&end_date=${m}-28`,
        { headers: HEADERS }
      );
      if (resp.ok) {
        const data = await resp.json();
        const scheduled = (data?.scheduled || []).filter(d => d.inventory && d.inventory.reservation !== 'sold-out');
        dates.push(...scheduled.map(d => d.date));
      }
    }

    dates.sort();
    const furthest = dates.length ? dates[dates.length - 1] : 'none';
    const available = dates.length;

    const prev = lastFurthest[venue.name];
    let change = '';
    if (prev && prev !== furthest) {
      change = ` *** CHANGED from ${prev} ***`;
      if (furthest > prev) {
        change = ` *** NEW DATE DROPPED! Was ${prev}, now ${furthest} ***`;
      }
    }
    lastFurthest[venue.name] = furthest;

    log(`${venue.name}: ${available} dates avail, furthest=${furthest}${change}`);
    if (dates.length > 0) {
      log(`   Dates: ${dates.join(', ')}`);
    }
  } catch (e) {
    log(`${venue.name}: ERROR — ${e.message}`);
  }
}

async function main() {
  log('=== DROP TIME MONITOR ===');
  log(`Checking ${VENUES.map(v => v.name).join(', ')} every 15 min`);
  log(`Log file: ${LOG_FILE}`);
  log('');

  while (true) {
    log('--- Check ---');
    for (const v of VENUES) {
      await checkCalendar(v);
      await sleep(1000); // space out requests
    }
    log('Next check in 15 min...');
    log('');
    await sleep(15 * 60 * 1000); // 15 min
  }
}

main().catch(e => { log('Fatal: ' + e.message); });
