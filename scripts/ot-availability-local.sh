#!/bin/bash
# OT Availability Check — runs locally, parallel with Resy
set -e
cd /Users/mauricedweck/Desktop/01-Projects/hot-restaurants-
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
LOG1="data/ot-availability.log"
LOG2="data/ot-availability-half2.log"

echo "$(date) — Starting OT availability check (2 halves in parallel)" >> "$LOG1"

# Step 1: Run OT tonight check — split into 2 halves in parallel
node netlify/functions/ot-tonight-check.js --all --split 2 --half 1 > "$LOG1" 2>&1 &
PID1=$!
node netlify/functions/ot-tonight-check.js --all --split 2 --half 2 > "$LOG2" 2>&1 &
PID2=$!

echo "Started half 1 (PID $PID1) and half 2 (PID $PID2)"
wait $PID1
echo "Half 1 done"
wait $PID2
echo "Half 2 done"

# Step 2: Merge OT results into main tonight_availability.json
echo "$(date) — Merging OT into main availability..."
node -e "
const fs = require('fs');
const mainFile = 'netlify/functions/tonight_availability.json';
const otFile = 'netlify/functions/tonight_availability_ot.json';
const main = JSON.parse(fs.readFileSync(mainFile, 'utf8'));
const ot = JSON.parse(fs.readFileSync(otFile, 'utf8'));
let merged = 0;
for (const [key, val] of Object.entries(ot)) {
  main[key] = val;
  merged++;
}
fs.writeFileSync(mainFile, JSON.stringify(main, null, 2));
console.log('Merged ' + merged + ' OT entries into tonight_availability.json');
"

# Step 3: Regenerate slim
echo "$(date) — Generating slim file..."
node netlify/functions/slim-availability.js

# Step 4: Commit and push
echo "$(date) — Committing OT update..."
git add netlify/functions/tonight_availability.json netlify/functions/tonight_availability_slim.json netlify/functions/tonight_availability_ot.json
git diff --staged --quiet || git commit -m "🍽️ OT availability update $(date +'%Y-%m-%d')"
git push

echo "$(date) — Done!"
