/**
 * slim-availability.js
 *
 * Strips tonight_availability.json down to only the 5 fields
 * the frontend needs, reducing size from ~2.5MB to ~260KB.
 *
 * RUN: node slim-availability.js
 *
 * INPUT:  tonight_availability.json
 * OUTPUT: tonight_availability_slim.json
 */

const fs = require('fs');
const path = require('path');

const INPUT  = path.join(__dirname, 'tonight_availability.json');
const OUTPUT = path.join(__dirname, 'tonight_availability_slim.json');

let raw = {};
try {
  raw = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  console.log(`✅ Loaded tonight_availability.json`);
} catch(e) {
  console.error('❌ Cannot load tonight_availability.json:', e.message);
  process.exit(1);
}

const slim = {};

for (const [key, v] of Object.entries(raw)) {
  if (key.startsWith('_')) { slim[key] = v; continue; }

  const tier = v.tier || null;
  let has_early = v.has_early || false;
  let has_prime = v.has_prime || false;
  let has_late  = v.has_late  || false;

  if (!has_early && !has_prime && !has_late && v.time_windows) {
    has_early = (v.time_windows.early?.count || 0) > 0;
    has_prime = (v.time_windows.prime?.count || 0) > 0;
    has_late  = (v.time_windows.late?.count  || 0) > 0;
  }

  slim[key] = {
    tier,
    dinner_slots: v.dinner_slots || 0,
    has_early,
    has_prime,
    has_late
  };
  if (v.fully_locked) slim[key].fully_locked = true;
  if (v.opens_in) slim[key].opens_in = v.opens_in;
}

const keys = Object.keys(slim).filter(k => !k.startsWith('_'));
fs.writeFileSync(OUTPUT, JSON.stringify(slim));

const inputSize  = fs.statSync(INPUT).size;
const outputSize = fs.statSync(OUTPUT).size;

console.log(`✅ Done: ${keys.length} restaurants`);
console.log(`📦 Input:  ${(inputSize  / 1024).toFixed(0)} KB`);
console.log(`📦 Output: ${(outputSize / 1024).toFixed(0)} KB`);
